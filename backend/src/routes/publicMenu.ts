import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import {
  beans,
  brewers,
  ingredients,
  drinkCategories,
  drinkIngredients,
  drinks,
  workspaces,
  type Bean,
  type MethodKind,
  type Workspace,
} from "@barista/shared/schema";
import { SLUG_PATTERN } from "../validation.js";

export interface PublicMenuResponse {
  workspace: Pick<Workspace, "name" | "slug">;
  beans: Array<
    Pick<
      Bean,
      | "id" | "roasterName" | "beanName" | "process" | "roastDate" | "inventoryWeightGrams"
      | "roastLevel" | "detailedRoastLevel" | "roastType" | "blendType" | "decaf"
      | "flavorProfile" | "region" | "altitudeMasl" | "producer"
    >
  >; // price, website, notes, rating, purchase date and supplier stay private (docs/api/public-menu.md §7)
  // docs/api/public-menu.md §7: plain brews and drinks, in category sections.
  sections: MenuSection[];
}

const METHOD_LABELS: Record<MethodKind, string> = { filter: "Filter", espresso: "Espresso" };

export interface MenuItem {
  kind: "brewer" | "drink";
  id: string;
  name: string;
  description: string | null;
  method: string; // how it's made: "Pour over", "Immersion", "Espresso"
  variantOf: string | null;
  ingredients: string[];
}
export interface MenuSection {
  category: string | null;
  items: MenuItem[];
}

// Mounted at /api/public/menu. Unauthenticated: only expose explicitly public data.
export const publicMenuRouter = Router();

publicMenuRouter.get(
  "/:slug",
  async (req: Request<{ slug: string }>, res: Response<PublicMenuResponse>) => {
    if (!SLUG_PATTERN.test(req.params.slug)) {
      sendError(res, 404, "Menu not found");
      return;
    }

    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(and(eq(workspaces.slug, req.params.slug), eq(workspaces.isPublicMenuEnabled, true)))
      .limit(1);

    // Same 404 whether the slug is unknown or the menu is disabled.
    if (!workspace) {
      sendError(res, 404, "Menu not found");
      return;
    }

    // A brewer shows under its menu name ("Espresso", not the machine's model).
    const menuName = sql<string>`COALESCE(${brewers.menuName}, ${brewers.name})`;
    const [menuBeans, categories, menuBrewers, menuDrinks] = await Promise.all([
      db
        .select({
          id: beans.id,
          roasterName: beans.roasterName,
          beanName: beans.beanName,
          process: beans.process,
          roastDate: beans.roastDate,
          inventoryWeightGrams: beans.inventoryWeightGrams,
          roastLevel: beans.roastLevel,
          detailedRoastLevel: beans.detailedRoastLevel,
          roastType: beans.roastType,
          blendType: beans.blendType,
          decaf: beans.decaf,
          flavorProfile: beans.flavorProfile,
          region: beans.region,
          altitudeMasl: beans.altitudeMasl,
          producer: beans.producer,
        })
        .from(beans)
        .where(and(eq(beans.workspaceId, workspace.id), eq(beans.showOnPublicMenu, true), isNull(beans.archivedAt)))
        .orderBy(asc(beans.roasterName), asc(beans.beanName)),
      db
        .select({ id: drinkCategories.id, name: drinkCategories.name })
        .from(drinkCategories)
        .where(eq(drinkCategories.workspaceId, workspace.id))
        .orderBy(asc(drinkCategories.position), asc(drinkCategories.name)),
      db
        .select({ id: brewers.id, name: menuName, description: brewers.description, categoryId: brewers.categoryId, brewerKind: brewers.kind })
        .from(brewers)
        .where(and(eq(brewers.workspaceId, workspace.id), eq(brewers.showOnPublicMenu, true), isNull(brewers.retiredAt)))
        .orderBy(asc(menuName)),
      db
        .select({
          id: drinks.id,
          name: drinks.name,
          description: drinks.description,
          categoryId: drinks.categoryId,
          parentDrinkId: drinks.parentDrinkId,
          drinkKind: drinks.kind,
        })
        .from(drinks)
        .where(and(eq(drinks.workspaceId, workspace.id), eq(drinks.showOnPublicMenu, true)))
        .orderBy(asc(drinks.name)),
    ]);

    const ids = menuDrinks.map((d) => d.id);
    const ingredientRows = ids.length
      ? await db
          .select({ drinkId: drinkIngredients.drinkId, name: ingredients.name })
          .from(drinkIngredients)
          .innerJoin(ingredients, eq(drinkIngredients.ingredientId, ingredients.id))
          .where(inArray(drinkIngredients.drinkId, ids))
          .orderBy(asc(drinkIngredients.position))
      : [];

    // Only name a parent that's on the menu too, so hidden drinks stay hidden.
    const shownNames = new Map(menuDrinks.map((d) => [d.id, d.name]));
    const items: Array<MenuItem & { categoryId: string | null }> = [
      ...menuBrewers.map(({ brewerKind, ...b }) => ({ ...b, kind: "brewer" as const, method: METHOD_LABELS[brewerKind], variantOf: null, ingredients: [] })),
      ...menuDrinks.map(({ parentDrinkId, drinkKind, ...d }) => ({
        ...d,
        kind: "drink" as const,
        method: METHOD_LABELS[drinkKind],
        variantOf: (parentDrinkId && shownNames.get(parentDrinkId)) ?? null,
        ingredients: ingredientRows.filter((c) => c.drinkId === d.id).map((c) => c.name),
      })),
    ];
    const sections: MenuSection[] = [...categories, { id: null, name: null }]
      .map((c) => ({
        category: c.name,
        items: items.filter((i) => i.categoryId === c.id).map(({ categoryId: _category, ...item }) => item),
      }))
      .filter((s) => s.items.length > 0);

    res.json({
      workspace: { name: workspace.name, slug: workspace.slug },
      beans: menuBeans,
      sections,
    });
  }
);

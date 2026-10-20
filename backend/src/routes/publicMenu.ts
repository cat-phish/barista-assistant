import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import {
  beans,
  brewMethods,
  components,
  drinkCategories,
  drinkComponents,
  drinks,
  workspaces,
  type Bean,
  type Workspace,
} from "@barista/shared/schema";
import { SLUG_PATTERN } from "../validation.js";

export interface PublicMenuResponse {
  workspace: Pick<Workspace, "name" | "slug">;
  beans: Array<
    Pick<Bean, "id" | "roasterName" | "beanName" | "process" | "roastDate" | "inventoryWeightGrams">
  >;
  // docs/api_spec.md §7: plain methods and drinks, in category sections.
  sections: MenuSection[];
}

export interface MenuItem {
  kind: "method" | "drink";
  id: string;
  name: string;
  description: string | null;
  method: string;
  variantOf: string | null;
  components: string[];
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

    const [menuBeans, categories, menuMethods, menuDrinks] = await Promise.all([
      db
        .select({
          id: beans.id,
          roasterName: beans.roasterName,
          beanName: beans.beanName,
          process: beans.process,
          roastDate: beans.roastDate,
          inventoryWeightGrams: beans.inventoryWeightGrams,
        })
        .from(beans)
        .where(and(eq(beans.workspaceId, workspace.id), eq(beans.showOnPublicMenu, true)))
        .orderBy(asc(beans.roasterName), asc(beans.beanName)),
      db
        .select({ id: drinkCategories.id, name: drinkCategories.name })
        .from(drinkCategories)
        .where(eq(drinkCategories.workspaceId, workspace.id))
        .orderBy(asc(drinkCategories.position), asc(drinkCategories.name)),
      db
        .select({ id: brewMethods.id, name: brewMethods.name, description: brewMethods.description, categoryId: brewMethods.categoryId })
        .from(brewMethods)
        .where(and(eq(brewMethods.workspaceId, workspace.id), eq(brewMethods.showOnPublicMenu, true)))
        .orderBy(asc(brewMethods.name)),
      db
        .select({
          id: drinks.id,
          name: drinks.name,
          description: drinks.description,
          categoryId: drinks.categoryId,
          parentDrinkId: drinks.parentDrinkId,
          method: brewMethods.name,
        })
        .from(drinks)
        .innerJoin(brewMethods, eq(drinks.methodId, brewMethods.id))
        .where(and(eq(drinks.workspaceId, workspace.id), eq(drinks.showOnPublicMenu, true)))
        .orderBy(asc(drinks.name)),
    ]);

    const ids = menuDrinks.map((d) => d.id);
    const componentRows = ids.length
      ? await db
          .select({ drinkId: drinkComponents.drinkId, name: components.name })
          .from(drinkComponents)
          .innerJoin(components, eq(drinkComponents.componentId, components.id))
          .where(inArray(drinkComponents.drinkId, ids))
          .orderBy(asc(drinkComponents.position))
      : [];

    // Only name a parent that's on the menu too, so hidden drinks stay hidden.
    const shownNames = new Map(menuDrinks.map((d) => [d.id, d.name]));
    const items: Array<MenuItem & { categoryId: string | null }> = [
      ...menuMethods.map((m) => ({ ...m, kind: "method" as const, method: m.name, variantOf: null, components: [] })),
      ...menuDrinks.map(({ parentDrinkId, ...d }) => ({
        ...d,
        kind: "drink" as const,
        variantOf: (parentDrinkId && shownNames.get(parentDrinkId)) ?? null,
        components: componentRows.filter((c) => c.drinkId === d.id).map((c) => c.name),
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

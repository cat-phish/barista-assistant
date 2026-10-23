import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import { beans, drinkIngredients, drinks, ingredients, workspaces, type Bean, type MethodKind, type Workspace } from "@barista/shared/schema";
import { SLUG_PATTERN } from "../validation.js";
import { loadMenu } from "./menu.js";

// docs/api/public-menu.md §7: the menu as arranged in the builder (§7b).
export type PublicBean = Pick<
  Bean,
  | "id" | "roasterName" | "beanName" | "process" | "roastDate" | "inventoryWeightGrams"
  | "roastLevel" | "detailedRoastLevel" | "roastType" | "blendType" | "decaf"
  | "flavorProfile" | "originArea" | "country" | "region" | "altitudeMasl" | "producer"
>; // price, website, notes, rating, purchase date and supplier stay private

export interface PublicMenuItem {
  type: "drink" | "brewer";
  id: string; // the drink or brewer
  name: string;
  description: string | null;
  method: string; // how it's made: "Filter", "Espresso"
  variantOf: string | null;
  ingredients: string[];
  price: number | null;
  available: boolean;
}
export interface PublicBeansBlock {
  type: "beans";
  beans: PublicBean[];
}
export interface PublicMenuSection {
  name: string;
  description: string | null;
  items: Array<PublicMenuItem | PublicBeansBlock>;
}
export interface PublicMenuResponse {
  workspace: Pick<Workspace, "name" | "slug">;
  currency: string | null;
  sections: PublicMenuSection[];
}

const METHOD_LABELS: Record<MethodKind, string> = { filter: "Filter", espresso: "Espresso", stovetop: "Stovetop", other: "Other" };

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

    const menu = await loadMenu(workspace.id);
    const allItems = menu.sections.flatMap((s) => s.items);
    const drinkIds = allItems.flatMap((i) => (i.drinkId ? [i.drinkId] : []));
    const hasBeans = allItems.some((i) => i.itemType === "beans");

    const [drinkRows, ingredientRows, menuBeans] = await Promise.all([
      drinkIds.length
        ? db.select({ id: drinks.id, parentDrinkId: drinks.parentDrinkId }).from(drinks).where(inArray(drinks.id, drinkIds))
        : Promise.resolve([]),
      drinkIds.length
        ? db
            .select({ drinkId: drinkIngredients.drinkId, name: ingredients.name })
            .from(drinkIngredients)
            .innerJoin(ingredients, eq(drinkIngredients.ingredientId, ingredients.id))
            .where(inArray(drinkIngredients.drinkId, drinkIds))
            .orderBy(asc(drinkIngredients.position))
        : Promise.resolve([]),
      hasBeans
        ? db
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
              originArea: beans.originArea,
              country: beans.country,
              region: beans.region,
              altitudeMasl: beans.altitudeMasl,
              producer: beans.producer,
            })
            .from(beans)
            .where(and(eq(beans.workspaceId, workspace.id), eq(beans.showOnPublicMenu, true), isNull(beans.archivedAt)))
            .orderBy(asc(beans.roasterName), asc(beans.beanName))
        : Promise.resolve([]),
    ]);

    // Name a parent drink only if it's on the menu too, so hidden drinks stay hidden.
    const parentOf = new Map(drinkRows.map((d) => [d.id, d.parentDrinkId]));
    const menuNameOf = new Map<string, string>();
    for (const i of allItems) if (i.drinkId && i.source) menuNameOf.set(i.drinkId, i.name ?? i.source.name);

    const sections: PublicMenuSection[] = menu.sections
      .map((s) => ({
        name: s.name,
        description: s.description,
        items: s.items.flatMap((i): Array<PublicMenuItem | PublicBeansBlock> => {
          if (i.itemType === "beans") return menuBeans.length ? [{ type: "beans", beans: menuBeans }] : [];
          // A retired brewer, or a source that's gone, is left off.
          if (!i.source || i.source.retired) return [];
          const id = (i.drinkId ?? i.brewerId)!;
          const parent = i.drinkId ? parentOf.get(i.drinkId) : null;
          return [
            {
              type: i.itemType,
              id,
              name: i.name ?? i.source.name,
              description: i.description ?? i.source.description,
              method: METHOD_LABELS[i.source.kind],
              variantOf: (parent && menuNameOf.get(parent)) ?? null,
              ingredients: i.drinkId ? ingredientRows.filter((r) => r.drinkId === i.drinkId).map((r) => r.name) : [],
              price: i.price,
              available: i.available,
            },
          ];
        }),
      }))
      .filter((s) => s.items.length > 0);

    res.json({ workspace: { name: workspace.name, slug: workspace.slug }, currency: menu.currency, sections });
  }
);

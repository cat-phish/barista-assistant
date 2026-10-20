import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import {
  beans,
  brewMethods,
  components,
  drinkComponents,
  drinkRecipes,
  drinks,
  recipes,
  workspaces,
  type Bean,
  type Drink,
  type Workspace,
} from "@barista/shared/schema";
import { SLUG_PATTERN } from "../validation.js";

export interface PublicMenuResponse {
  workspace: Pick<Workspace, "name" | "slug">;
  beans: Array<
    Pick<Bean, "id" | "roasterName" | "beanName" | "process" | "roastDate" | "inventoryWeightGrams">
  >;
  // docs/api_spec.md §7: drinks, with their methods and components by name.
  drinks: Array<Pick<Drink, "id" | "name" | "description" | "category"> & { methods: string[]; components: string[] }>;
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

    const [menuBeans, menuDrinks] = await Promise.all([
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
        .select({ id: drinks.id, name: drinks.name, description: drinks.description, category: drinks.category })
        .from(drinks)
        .where(and(eq(drinks.workspaceId, workspace.id), eq(drinks.showOnPublicMenu, true)))
        // By category (uncategorised last), then name: menu sections.
        .orderBy(sql`${drinks.category} IS NULL`, asc(drinks.category), asc(drinks.name)),
    ]);

    const ids = menuDrinks.map((d) => d.id);
    const [methodRows, componentRows] = ids.length
      ? await Promise.all([
          db
            .selectDistinct({ drinkId: drinkRecipes.drinkId, name: brewMethods.name })
            .from(drinkRecipes)
            .innerJoin(recipes, eq(drinkRecipes.recipeId, recipes.id))
            .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
            .where(inArray(drinkRecipes.drinkId, ids))
            .orderBy(asc(brewMethods.name)),
          db
            .select({ drinkId: drinkComponents.drinkId, name: components.name })
            .from(drinkComponents)
            .innerJoin(components, eq(drinkComponents.componentId, components.id))
            .where(inArray(drinkComponents.drinkId, ids))
            .orderBy(asc(drinkComponents.position)),
        ])
      : [[], []];

    res.json({
      workspace: { name: workspace.name, slug: workspace.slug },
      beans: menuBeans,
      drinks: menuDrinks.map((d) => ({
        ...d,
        methods: methodRows.filter((m) => m.drinkId === d.id).map((m) => m.name),
        components: componentRows.filter((c) => c.drinkId === d.id).map((c) => c.name),
      })),
    });
  }
);

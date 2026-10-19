import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import {
  beans,
  brewMethods,
  recipes,
  workspaces,
  type Bean,
  type Recipe,
  type Workspace,
} from "@barista/shared/schema";
import { SLUG_PATTERN } from "../validation.js";

export interface PublicMenuResponse {
  workspace: Pick<Workspace, "name" | "slug">;
  beans: Array<
    Pick<Bean, "id" | "roasterName" | "beanName" | "process" | "roastDate" | "inventoryWeightGrams">
  >;
  recipes: Array<
    Pick<Recipe, "id" | "name" | "targetDoseGrams" | "targetWaterGrams"> & { method: string }
  >;
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

    const [menuBeans, menuRecipes] = await Promise.all([
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
        .select({
          id: recipes.id,
          name: recipes.name,
          method: brewMethods.name,
          targetDoseGrams: recipes.targetDoseGrams,
          targetWaterGrams: recipes.targetWaterGrams,
        })
        .from(recipes)
        .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
        .where(and(eq(recipes.workspaceId, workspace.id), eq(recipes.showOnPublicMenu, true)))
        .orderBy(asc(recipes.name)),
    ]);

    res.json({
      workspace: { name: workspace.name, slug: workspace.slug },
      beans: menuBeans,
      recipes: menuRecipes,
    });
  }
);

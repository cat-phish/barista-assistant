import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewMethods, recipes, recipeSteps, type BrewMethod, type Recipe, type RecipeStep } from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

export interface RecipeDetails extends Omit<Recipe, "methodId"> {
  method: Pick<BrewMethod, "id" | "name">;
  steps: Array<Omit<RecipeStep, "recipeId">>;
}

export interface RecipeListResponse {
  recipes: RecipeDetails[];
}

export interface RecipeResponse {
  recipe: RecipeDetails;
}

interface WorkspaceParams {
  workspaceId: string;
}

const stepSchema = z.object({
  actionName: z.string().trim().min(1).max(255),
  targetTimeSec: z.number().int().min(0).max(24 * 60 * 60),
  targetWaterGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMax: true }),
});

const stepsSchema = z
  .array(stepSchema)
  .max(20)
  .superRefine((steps, ctx) => {
    // Times and weights are cumulative.
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1]!;
      const step = steps[i]!;
      if (step.targetTimeSec <= prev.targetTimeSec) {
        ctx.addIssue({ code: "custom", path: [i, "targetTimeSec"], message: "must be greater than the previous step's" });
      }
      if (step.targetWaterGrams < prev.targetWaterGrams) {
        ctx.addIssue({ code: "custom", path: [i, "targetWaterGrams"], message: "must not be less than the previous step's" });
      }
    }
  });

const recipeFields = {
  name: z.string().trim().min(1).max(255),
  methodId: z.uuid(),
  targetDoseGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  targetYieldGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  targetTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
  targetGrindSetting: optionalText(100),
  showOnPublicMenu: z.boolean(),
  steps: stepsSchema,
};

const createRecipeSchema = z.object({
  ...recipeFields,
  showOnPublicMenu: recipeFields.showOnPublicMenu.default(true),
  steps: recipeFields.steps.default([]),
});

const updateRecipeSchema = updateSchema(recipeFields);

interface RecipeParams extends WorkspaceParams {
  recipeId: string;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The FK only proves the method exists; it must also belong to this workspace.
// Locks the method row (MariaDB has no FOR SHARE) so a concurrent brew-method
// DELETE either finishes first (we see no row -> 400) or waits for us and then
// sees this recipe (-> 409). Without it the insert hit an FK error -> 500.
async function methodInWorkspace(tx: Tx, methodId: string, workspaceId: string): Promise<boolean> {
  const [method] = await tx
    .select({ id: brewMethods.id })
    .from(brewMethods)
    .where(and(eq(brewMethods.id, methodId), eq(brewMethods.workspaceId, workspaceId)))
    .for("update");
  return Boolean(method);
}

async function insertSteps(tx: Tx, recipeId: string, steps: z.infer<typeof stepsSchema>): Promise<void> {
  if (steps.length === 0) return;
  await tx
    .insert(recipeSteps)
    .values(steps.map((step, i) => ({ id: randomUUID(), recipeId, stepOrder: i + 1, ...step })));
}

async function loadRecipes(workspaceId: string, recipeId?: string): Promise<RecipeDetails[]> {
  const conditions: SQL[] = [eq(recipes.workspaceId, workspaceId)];
  if (recipeId) conditions.push(eq(recipes.id, recipeId));

  const rows = await db
    .select({
      id: recipes.id,
      workspaceId: recipes.workspaceId,
      name: recipes.name,
      method: { id: brewMethods.id, name: brewMethods.name },
      targetDoseGrams: recipes.targetDoseGrams,
      targetYieldGrams: recipes.targetYieldGrams,
      targetTempC: recipes.targetTempC,
      targetGrindSetting: recipes.targetGrindSetting,
      showOnPublicMenu: recipes.showOnPublicMenu,
    })
    .from(recipes)
    .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
    .where(and(...conditions))
    .orderBy(asc(recipes.name));

  if (rows.length === 0) return [];

  const steps = await db
    .select()
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, rows.map((r) => r.id)))
    .orderBy(asc(recipeSteps.stepOrder));

  const stepsByRecipe = new Map<string, RecipeDetails["steps"]>();
  for (const { recipeId: owner, ...step } of steps) {
    const list = stepsByRecipe.get(owner) ?? [];
    list.push(step);
    stepsByRecipe.set(owner, list);
  }

  return rows.map((row) => ({ ...row, steps: stepsByRecipe.get(row.id) ?? [] }));
}

// Mounted at /api/workspaces/:workspaceId/recipes
export const recipesRouter = Router({ mergeParams: true });
recipesRouter.use(requireAuth);

recipesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<RecipeListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;

  res.json({ recipes: await loadRecipes(workspaceId) });
});

recipesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<RecipeResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

  const body = parseBody(createRecipeSchema, req, res);
  if (!body) return;

  const { steps, ...recipeFields } = body;
  const recipeId = randomUUID();

  const created = await db.transaction(async (tx) => {
    if (!(await methodInWorkspace(tx, body.methodId, workspaceId))) return false;
    await tx.insert(recipes).values({ id: recipeId, workspaceId, ...recipeFields });
    await insertSteps(tx, recipeId, steps);
    return true;
  });

  if (!created) {
    sendError(res, 400, "methodId: not a brew method in this workspace");
    return;
  }

  const [recipe] = await loadRecipes(workspaceId, recipeId);
  if (!recipe) {
    throw new Error(`Recipe ${recipeId} missing after insert`);
  }
  res.status(201).json({ recipe });
});

recipesRouter.patch("/:recipeId", async (req: Request<RecipeParams>, res: Response<RecipeResponse>) => {
  const { workspaceId, recipeId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

  const body = parseBody(updateRecipeSchema, req, res);
  if (!body) return;

  const { steps, ...recipeFields } = body;

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, workspaceId)))
      .for("update");
    if (!existing) return "not_found" as const;

    if (recipeFields.methodId && !(await methodInWorkspace(tx, recipeFields.methodId, workspaceId))) {
      return "bad_method" as const;
    }

    if (Object.keys(recipeFields).length > 0) {
      await tx.update(recipes).set(recipeFields).where(eq(recipes.id, recipeId));
    }
    // A provided step list replaces the old one entirely.
    if (steps) {
      await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
      await insertSteps(tx, recipeId, steps);
    }
    return "updated" as const;
  });

  if (outcome === "not_found") {
    sendError(res, 404, "Recipe not found");
    return;
  }
  if (outcome === "bad_method") {
    sendError(res, 400, "methodId: not a brew method in this workspace");
    return;
  }

  const [recipe] = await loadRecipes(workspaceId, recipeId);
  if (!recipe) {
    sendError(res, 404, "Recipe not found");
    return;
  }
  res.json({ recipe });
});

// Steps cascade; brew logs keep their history with recipeId set to null.
recipesRouter.delete("/:recipeId", async (req: Request<RecipeParams>, res: Response) => {
  const { workspaceId, recipeId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

  const [result] = await db
    .delete(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, workspaceId)));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Recipe not found");
    return;
  }
  res.status(204).end();
});

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  brewMethods,
  grinders,
  RECIPE_STEP_TYPES,
  recipeGrindSettings,
  recipes,
  recipeSteps,
  WATER_STEP_TYPES,
  type BrewMethod,
  type Recipe,
  type RecipeStep,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §5
export interface RecipeDetails extends Omit<Recipe, "methodId"> {
  method: Pick<BrewMethod, "id" | "name">;
  grindSettings: Array<{ grinderId: string; grinderName: string; setting: string }>;
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

const MAX_SEC = 24 * 60 * 60;
const seconds = z.number().int().min(0).max(MAX_SEC);
const waterGrams = decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true });
const isWaterType = (t: string) => (WATER_STEP_TYPES as readonly string[]).includes(t);

const stepSchema = z
  .object({
    stepType: z.enum(RECIPE_STEP_TYPES),
    label: optionalText(255),
    startSec: seconds,
    endSec: seconds,
    targetWaterGrams: waterGrams.nullable().optional(),
  })
  .superRefine((step, ctx) => {
    if (step.endSec < step.startSec) {
      ctx.addIssue({ code: "custom", path: ["endSec"], message: "must not be before startSec" });
    }
    const hasWater = step.targetWaterGrams != null;
    if (isWaterType(step.stepType) && !hasWater) {
      ctx.addIssue({ code: "custom", path: ["targetWaterGrams"], message: `is required for a ${step.stepType} step` });
    }
    if (!isWaterType(step.stepType) && step.stepType !== "other" && hasWater) {
      ctx.addIssue({ code: "custom", path: ["targetWaterGrams"], message: `isn't allowed for a ${step.stepType} step` });
    }
  });

const stepsSchema = z
  .array(stepSchema)
  .max(20)
  .superRefine((steps, ctx) => {
    let lastWater: number | null = null;
    steps.forEach((step, i) => {
      const prev = steps[i - 1];
      // Steps don't overlap; gaps between them are waiting time.
      if (prev && step.startSec < prev.endSec) {
        ctx.addIssue({ code: "custom", path: [i, "startSec"], message: "must not be before the previous step's end" });
      }
      // "Pour to" targets are cumulative scale weights.
      if (step.targetWaterGrams != null) {
        if (lastWater !== null && step.targetWaterGrams < lastWater) {
          ctx.addIssue({ code: "custom", path: [i, "targetWaterGrams"], message: "must not be less than an earlier step's" });
        }
        lastWater = step.targetWaterGrams;
      }
    });
  });

const grindSettingsSchema = z
  .array(z.object({ grinderId: z.uuid(), setting: z.string().trim().min(1).max(100) }))
  .max(50)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((g, i) => {
      if (seen.has(g.grinderId)) ctx.addIssue({ code: "custom", path: [i, "grinderId"], message: "appears more than once" });
      seen.add(g.grinderId);
    });
  });

const recipeFields = {
  name: z.string().trim().min(1).max(255),
  methodId: z.uuid(),
  targetDoseGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  targetWaterGrams: waterGrams,
  expectedYieldGrams: waterGrams.nullable().optional(),
  expectedFinishMinSec: seconds.nullable().optional(),
  expectedFinishMaxSec: seconds.nullable().optional(),
  targetTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
  showOnPublicMenu: z.boolean(),
  grindSettings: grindSettingsSchema,
  steps: stepsSchema,
};

const createRecipeSchema = z.object({
  ...recipeFields,
  showOnPublicMenu: recipeFields.showOnPublicMenu.default(true),
  grindSettings: recipeFields.grindSettings.default([]),
  steps: recipeFields.steps.default([]),
});

const updateRecipeSchema = updateSchema(recipeFields);

interface RecipeParams extends WorkspaceParams {
  recipeId: string;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const FINISH_DEFAULT_SPREAD_SEC = 15;

// The finish window is a pair (docs/api_spec.md §5): one end alone gets the
// other at ±15 s; null on either clears both; both must be in order.
// Returns undefined when neither end was sent (leave unchanged).
function finishWindow(
  min: number | null | undefined,
  max: number | null | undefined
): { expectedFinishMinSec: number | null; expectedFinishMaxSec: number | null } | { error: string } | undefined {
  if (min === undefined && max === undefined) return undefined;
  if (min === null || max === null) return { expectedFinishMinSec: null, expectedFinishMaxSec: null };
  if (min !== undefined && max !== undefined) {
    if (min > max) return { error: "expectedFinishMinSec: must not be after expectedFinishMaxSec" };
    return { expectedFinishMinSec: min, expectedFinishMaxSec: max };
  }
  if (min !== undefined) return { expectedFinishMinSec: min, expectedFinishMaxSec: Math.min(MAX_SEC, min + FINISH_DEFAULT_SPREAD_SEC) };
  const end = max as number;
  return { expectedFinishMinSec: Math.max(0, end - FINISH_DEFAULT_SPREAD_SEC), expectedFinishMaxSec: end };
}

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

// Same idea for grind starting points: every grinder must be in this workspace
// (retired ones allowed), locked so a concurrent grinder delete can't race us.
async function grindersInWorkspace(tx: Tx, grinderIds: string[], workspaceId: string): Promise<boolean> {
  if (grinderIds.length === 0) return true;
  const found = await tx
    .select({ id: grinders.id })
    .from(grinders)
    .where(and(inArray(grinders.id, grinderIds), eq(grinders.workspaceId, workspaceId)))
    .for("update");
  return found.length === new Set(grinderIds).size;
}

async function insertSteps(tx: Tx, recipeId: string, steps: z.infer<typeof stepsSchema>): Promise<void> {
  if (steps.length === 0) return;
  await tx.insert(recipeSteps).values(
    steps.map((step, i) => ({
      id: randomUUID(),
      recipeId,
      stepOrder: i + 1,
      stepType: step.stepType,
      label: step.label ?? null,
      startSec: step.startSec,
      endSec: step.endSec,
      targetWaterGrams: step.targetWaterGrams ?? null,
    }))
  );
}

async function insertGrindSettings(tx: Tx, recipeId: string, list: z.infer<typeof grindSettingsSchema>): Promise<void> {
  if (list.length === 0) return;
  await tx.insert(recipeGrindSettings).values(list.map((g) => ({ id: randomUUID(), recipeId, ...g })));
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
      targetWaterGrams: recipes.targetWaterGrams,
      expectedYieldGrams: recipes.expectedYieldGrams,
      expectedFinishMinSec: recipes.expectedFinishMinSec,
      expectedFinishMaxSec: recipes.expectedFinishMaxSec,
      targetTempC: recipes.targetTempC,
      showOnPublicMenu: recipes.showOnPublicMenu,
    })
    .from(recipes)
    .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
    .where(and(...conditions))
    .orderBy(asc(recipes.name));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [steps, grindRows] = await Promise.all([
    db.select().from(recipeSteps).where(inArray(recipeSteps.recipeId, ids)).orderBy(asc(recipeSteps.stepOrder)),
    db
      .select({ recipeId: recipeGrindSettings.recipeId, grinderId: grinders.id, grinderName: grinders.name, setting: recipeGrindSettings.setting })
      .from(recipeGrindSettings)
      .innerJoin(grinders, eq(recipeGrindSettings.grinderId, grinders.id))
      .where(inArray(recipeGrindSettings.recipeId, ids))
      .orderBy(asc(grinders.name)),
  ]);

  const stepsByRecipe = new Map<string, RecipeDetails["steps"]>();
  for (const { recipeId: owner, ...step } of steps) {
    stepsByRecipe.set(owner, [...(stepsByRecipe.get(owner) ?? []), step]);
  }
  const grindByRecipe = new Map<string, RecipeDetails["grindSettings"]>();
  for (const { recipeId: owner, ...g } of grindRows) {
    grindByRecipe.set(owner, [...(grindByRecipe.get(owner) ?? []), g]);
  }

  return rows.map((row) => ({
    ...row,
    grindSettings: grindByRecipe.get(row.id) ?? [],
    steps: stepsByRecipe.get(row.id) ?? [],
  }));
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

  const { steps, grindSettings, expectedFinishMinSec, expectedFinishMaxSec, ...rest } = body;
  const window = finishWindow(expectedFinishMinSec, expectedFinishMaxSec);
  if (window && "error" in window) {
    sendError(res, 400, window.error);
    return;
  }
  const recipeFields = { ...rest, ...(window ?? {}) };
  const recipeId = randomUUID();

  const error = await db.transaction(async (tx) => {
    if (!(await methodInWorkspace(tx, body.methodId, workspaceId))) return "methodId: not a brew method in this workspace";
    if (!(await grindersInWorkspace(tx, grindSettings.map((g) => g.grinderId), workspaceId))) {
      return "grindSettings: grinderId not a grinder in this workspace";
    }
    await tx.insert(recipes).values({ id: recipeId, workspaceId, ...recipeFields });
    await insertGrindSettings(tx, recipeId, grindSettings);
    await insertSteps(tx, recipeId, steps);
    return null;
  });

  if (error) {
    sendError(res, 400, error);
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

  const { steps, grindSettings, expectedFinishMinSec, expectedFinishMaxSec, ...rest } = body;
  const window = finishWindow(expectedFinishMinSec, expectedFinishMaxSec);
  if (window && "error" in window) {
    sendError(res, 400, window.error);
    return;
  }
  const recipeFields = { ...rest, ...(window ?? {}) };

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, workspaceId)))
      .for("update");
    if (!existing) return { status: 404, error: "Recipe not found" } as const;

    if (recipeFields.methodId && !(await methodInWorkspace(tx, recipeFields.methodId, workspaceId))) {
      return { status: 400, error: "methodId: not a brew method in this workspace" } as const;
    }
    if (grindSettings && !(await grindersInWorkspace(tx, grindSettings.map((g) => g.grinderId), workspaceId))) {
      return { status: 400, error: "grindSettings: grinderId not a grinder in this workspace" } as const;
    }

    if (Object.keys(recipeFields).length > 0) {
      await tx.update(recipes).set(recipeFields).where(eq(recipes.id, recipeId));
    }
    // Provided lists replace the old ones entirely.
    if (grindSettings) {
      await tx.delete(recipeGrindSettings).where(eq(recipeGrindSettings.recipeId, recipeId));
      await insertGrindSettings(tx, recipeId, grindSettings);
    }
    if (steps) {
      await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
      await insertSteps(tx, recipeId, steps);
    }
    return { status: 200 } as const;
  });

  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error);
    return;
  }

  const [recipe] = await loadRecipes(workspaceId, recipeId);
  if (!recipe) {
    sendError(res, 404, "Recipe not found");
    return;
  }
  res.json({ recipe });
});

// Steps and grind starting points cascade; brew logs keep their history with
// recipeId set to null.
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

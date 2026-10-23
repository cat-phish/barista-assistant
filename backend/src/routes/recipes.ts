import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, recipeUsage } from "../usage.js";
import {
  brewers,
  ESPRESSO_STEP_TYPES,
  FLOW_UNITS,
  grinders,
  RECIPE_STEP_TYPES,
  RECIPE_STYLES,
  STEP_ADVANCE,
  STYLES_BY_KIND,
  recipeGrindSettings,
  recipes,
  recipeSteps,
  WATER_STEP_TYPES,
  type Brewer,
  type MethodKind,
  type Recipe,
  type RecipeStep,
  type RecipeStyle,
} from "@barista/shared/schema";
import { archiveUpdate } from "../archive.js";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api/recipes.md §5
export interface RecipeDetails extends Omit<Recipe, "brewerId"> {
  brewer: Pick<Brewer, "id" | "name" | "kind">;
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
const isEspressoType = (t: string) => (ESPRESSO_STEP_TYPES as readonly string[]).includes(t);
// Pressure / flow values allowed per type (docs/api/recipes.md §5); "required" = must have it.
const PRESSURE: Partial<Record<string, "required" | "optional">> = { pressure: "required", preinfusion: "optional", other: "optional" };
const FLOW: Partial<Record<string, "required" | "optional">> = { flow: "required", preinfusion: "optional", other: "optional" };
const profileValue = decimalSchema({ min: 0, max: 20, scale: 1 }).nullable().optional();

const stepSchema = z
  .object({
    stepType: z.enum(RECIPE_STEP_TYPES),
    label: optionalText(255),
    // null = open-ended: last step only (stepsSchema).
    durationSec: seconds.nullable().optional(),
    advance: z.enum(STEP_ADVANCE).default("auto"),
    targetWaterGrams: waterGrams.nullable().optional(),
    targetTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
    pressureBar: profileValue,
    pressureEndBar: profileValue,
    flowRate: profileValue,
    flowEndRate: profileValue,
  })
  .superRefine((step, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const hasWater = step.targetWaterGrams != null;
    if (isWaterType(step.stepType) && !hasWater) issue("targetWaterGrams", `is required for a ${step.stepType} step`);
    if (!isWaterType(step.stepType) && step.stepType !== "other" && hasWater) issue("targetWaterGrams", `isn't allowed for a ${step.stepType} step`);
    for (const [start, end, rule] of [
      ["pressureBar", "pressureEndBar", PRESSURE[step.stepType]],
      ["flowRate", "flowEndRate", FLOW[step.stepType]],
    ] as const) {
      if (rule === "required" && step[start] == null) issue(start, `is required for a ${step.stepType} step`);
      if (!rule && (step[start] != null || step[end] != null)) issue(start, `isn't allowed for a ${step.stepType} step`);
      if (step[end] != null && step[start] == null) issue(end, `needs ${start} (a ramp goes from one to the other)`);
    }
    if (step.pressureBar != null && step.flowRate != null) issue("flowRate", "a step targets pressure or flow, not both");
    if ((step.advance === "auto" || step.advance === "auto_log") && step.durationSec === undefined) {
      issue("durationSec", "is required for a step that moves on by itself (null = until you finish, last step only)");
    }
    if (step.advance === "auto_log" && step.durationSec === null) issue("durationSec", "is required for an auto_log step");
  });

const stepsSchema = z
  .array(stepSchema)
  .max(20)
  .superRefine((steps, ctx) => {
    let lastWater: number | null = null;
    steps.forEach((step, i) => {
      // Open-ended ("until you finish") only makes sense for the last step.
      if (step.advance === "auto" && step.durationSec === null && i < steps.length - 1) {
        ctx.addIssue({ code: "custom", path: [i, "durationSec"], message: "only the last step can run until you finish" });
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
  brewerId: z.uuid(),
  targetDoseGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  // Required or forbidden depending on the method's kind (kindError).
  targetWaterGrams: waterGrams.nullable().optional(),
  expectedYieldGrams: waterGrams.nullable().optional(),
  expectedFinishMinSec: seconds.nullable().optional(),
  expectedFinishMaxSec: seconds.nullable().optional(),
  firstDropMinSec: seconds.nullable().optional(),
  firstDropMaxSec: seconds.nullable().optional(),
  flowUnit: z.enum(FLOW_UNITS),
  targetTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
  // How the cup is brewed; must be one of the brewer's method's (styleError).
  style: z.enum(RECIPE_STYLES).nullable().optional(),
  // Preselected when brewing this recipe (docs/api/recipes.md §5).
  defaultGrinderId: z.uuid().nullable().optional(),
  grindSettings: grindSettingsSchema,
  steps: stepsSchema,
};

const createRecipeSchema = z.object({
  ...recipeFields,
  flowUnit: recipeFields.flowUnit.default("g_s"),
  grindSettings: recipeFields.grindSettings.default([]),
  steps: recipeFields.steps.default([]),
});

const updateRecipeSchema = updateSchema({ ...recipeFields, archived: z.boolean() });

interface RecipeParams extends WorkspaceParams {
  recipeId: string;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const FINISH_DEFAULT_SPREAD_SEC = 15;
const FIRST_DROP_DEFAULT_SPREAD_SEC = 3;

// Time windows are pairs (docs/api/recipes.md §5): one end alone gets the other
// at ±spread; null on either clears both; both must be in order. Returns
// undefined when neither end was sent (leave unchanged).
function timeWindow(
  min: number | null | undefined,
  max: number | null | undefined,
  spread: number,
  names: { min: string; max: string }
): { min: number | null; max: number | null } | { error: string } | undefined {
  if (min === undefined && max === undefined) return undefined;
  if (min === null || max === null) return { min: null, max: null };
  if (min !== undefined && max !== undefined) {
    if (min > max) return { error: `${names.min}: must not be after ${names.max}` };
    return { min, max };
  }
  if (min !== undefined) return { min, max: Math.min(MAX_SEC, min + spread) };
  const end = max as number;
  return { min: Math.max(0, end - spread), max: end };
}

type WindowFields = Partial<
  Pick<Recipe, "expectedFinishMinSec" | "expectedFinishMaxSec" | "firstDropMinSec" | "firstDropMaxSec">
>;

// Both windows from a request body, as recipe columns, or the first error.
function windows(body: {
  expectedFinishMinSec?: number | null;
  expectedFinishMaxSec?: number | null;
  firstDropMinSec?: number | null;
  firstDropMaxSec?: number | null;
}): WindowFields | { error: string } {
  const finish = timeWindow(body.expectedFinishMinSec, body.expectedFinishMaxSec, FINISH_DEFAULT_SPREAD_SEC, {
    min: "expectedFinishMinSec",
    max: "expectedFinishMaxSec",
  });
  if (finish && "error" in finish) return finish;
  const drop = timeWindow(body.firstDropMinSec, body.firstDropMaxSec, FIRST_DROP_DEFAULT_SPREAD_SEC, {
    min: "firstDropMinSec",
    max: "firstDropMaxSec",
  });
  if (drop && "error" in drop) return drop;
  return {
    ...(finish ? { expectedFinishMinSec: finish.min, expectedFinishMaxSec: finish.max } : {}),
    ...(drop ? { firstDropMinSec: drop.min, firstDropMaxSec: drop.max } : {}),
  };
}

// A recipe's style must be one of its brewer's method's (docs/api/recipes.md §5):
// pour over, immersion… for filter; standard, soup… for espresso.
function styleError(kind: MethodKind, style: RecipeStyle | null | undefined): string | null {
  return style && !STYLES_BY_KIND[kind].includes(style) ? `style: not a style for ${kind} recipes` : null;
}

// What a recipe must look like for its method's kind (docs/api/recipes.md §5),
// checked against the recipe as it is after the request.
interface KindCheck {
  targetWaterGrams: number | null;
  expectedYieldGrams: number | null;
  firstDropMinSec: number | null;
  steps: ReadonlyArray<{
    stepType: string;
    advance: string;
    targetWaterGrams?: number | null;
    pressureBar?: number | null;
    flowRate?: number | null;
  }>;
}
function kindError(kind: MethodKind, r: KindCheck): string | null {
  if (kind === "espresso") {
    if (r.targetWaterGrams !== null) return "targetWaterGrams: must be null for an espresso recipe";
    if (r.expectedYieldGrams === null) return "expectedYieldGrams: is required for an espresso recipe (the target shot weight)";
    const i = r.steps.findIndex((step) => !isEspressoType(step.stepType) || step.targetWaterGrams != null);
    if (i >= 0) return `steps.${i}: espresso steps are pre-infusion, soak, pressure, flow or other, without pour-to targets`;
    if (r.steps.filter((step) => step.advance === "first_drop").length > 1) return "steps: at most one step can end at first drop";
    return null;
  }
  const p = r.steps.findIndex((step) => (isEspressoType(step.stepType) && step.stepType !== "other") || step.pressureBar != null || step.flowRate != null);
  if (p >= 0) return `steps.${p}: pre-infusion, soak, pressure and flow steps are for espresso recipes`;
  const d = r.steps.findIndex((step) => step.advance === "first_drop");
  if (d >= 0) return `steps.${d}: only espresso steps can end at first drop`;
  if (r.targetWaterGrams === null) return "targetWaterGrams: is required";
  if (r.firstDropMinSec !== null) return "firstDropMinSec: only applies to espresso recipes";
  return null;
}

// The FK only proves the method exists; it must also belong to this workspace.
// Locks the method row (MariaDB has no FOR SHARE) so a concurrent brew-method
// DELETE (or kind change) either finishes first or waits for us and then sees
// this recipe (-> 409). Without it the insert hit an FK error -> 500.
// Returns the method's kind, or null if it isn't in this workspace.
async function methodKindInWorkspace(tx: Tx, brewerId: string, workspaceId: string): Promise<MethodKind | null> {
  const [method] = await tx
    .select({ kind: brewers.kind })
    .from(brewers)
    .where(and(eq(brewers.id, brewerId), eq(brewers.workspaceId, workspaceId)))
    .for("update");
  return method?.kind ?? null;
}

// Same idea for grind starting points: every grinder must be in this workspace
// (archived ones allowed), locked so a concurrent grinder delete can't race us.
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
      durationSec: step.durationSec ?? null,
      advance: step.advance,
      targetWaterGrams: step.targetWaterGrams ?? null,
      targetTempC: step.targetTempC ?? null,
      pressureBar: step.pressureBar ?? null,
      pressureEndBar: step.pressureEndBar ?? null,
      flowRate: step.flowRate ?? null,
      flowEndRate: step.flowEndRate ?? null,
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
      brewer: { id: brewers.id, name: brewers.name, kind: brewers.kind },
      targetDoseGrams: recipes.targetDoseGrams,
      targetWaterGrams: recipes.targetWaterGrams,
      expectedYieldGrams: recipes.expectedYieldGrams,
      expectedFinishMinSec: recipes.expectedFinishMinSec,
      expectedFinishMaxSec: recipes.expectedFinishMaxSec,
      firstDropMinSec: recipes.firstDropMinSec,
      firstDropMaxSec: recipes.firstDropMaxSec,
      flowUnit: recipes.flowUnit,
      style: recipes.style,
      targetTempC: recipes.targetTempC,
      defaultGrinderId: recipes.defaultGrinderId,
      archivedAt: recipes.archivedAt,
      createdAt: recipes.createdAt,
    })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
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
addUsageRoute(recipesRouter, "recipeId", "recipes", recipeUsage, "Recipe not found");

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

  const { steps, grindSettings, expectedFinishMinSec, expectedFinishMaxSec, firstDropMinSec, firstDropMaxSec, ...rest } = body;
  const window = windows(body);
  if ("error" in window) {
    sendError(res, 400, window.error);
    return;
  }
  const recipeFields = { ...rest, ...window };
  const recipeId = randomUUID();

  const error = await db.transaction(async (tx) => {
    const kind = await methodKindInWorkspace(tx, body.brewerId, workspaceId);
    if (!kind) return "brewerId: not a brewer in this workspace";
    const wrongForKind = kindError(kind, {
      targetWaterGrams: recipeFields.targetWaterGrams ?? null,
      expectedYieldGrams: recipeFields.expectedYieldGrams ?? null,
      firstDropMinSec: recipeFields.firstDropMinSec ?? null,
      steps,
    });
    if (wrongForKind) return wrongForKind;
    const wrongStyle = styleError(kind, recipeFields.style);
    if (wrongStyle) return wrongStyle;
    if (!(await grindersInWorkspace(tx, grindSettings.map((g) => g.grinderId), workspaceId))) {
      return "grindSettings: grinderId not a grinder in this workspace";
    }
    if (body.defaultGrinderId && !(await grindersInWorkspace(tx, [body.defaultGrinderId], workspaceId))) {
      return "defaultGrinderId: not a grinder in this workspace";
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

  const parsed = parseBody(updateRecipeSchema, req, res);
  if (!parsed) return;
  const { archived, ...body } = parsed;

  // Archiving alone changes nothing the recipe rules check (docs/api/recipes.md §5).
  if (Object.keys(body).length === 0) {
    await db.update(recipes).set(archiveUpdate(recipes.archivedAt, archived)).where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, workspaceId)));
    const [recipe] = await loadRecipes(workspaceId, recipeId);
    if (!recipe) {
      sendError(res, 404, "Recipe not found");
      return;
    }
    res.json({ recipe });
    return;
  }

  const { steps, grindSettings, expectedFinishMinSec, expectedFinishMaxSec, firstDropMinSec, firstDropMaxSec, ...rest } = body;
  const window = windows(body);
  if ("error" in window) {
    sendError(res, 400, window.error);
    return;
  }
  const recipeFields = { ...rest, ...window };

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        brewerId: recipes.brewerId,
        targetWaterGrams: recipes.targetWaterGrams,
        expectedYieldGrams: recipes.expectedYieldGrams,
        firstDropMinSec: recipes.firstDropMinSec,
        style: recipes.style,
      })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, workspaceId)))
      .for("update");
    if (!existing) return { status: 404, error: "Recipe not found" } as const;

    const kind = await methodKindInWorkspace(tx, recipeFields.brewerId ?? existing.brewerId, workspaceId);
    if (!kind) return { status: 400, error: "brewerId: not a brewer in this workspace" } as const;
    // Kind rules apply to the recipe as it will be after this change (fields
    // not sent keep their current values).
    const after = { ...existing, ...recipeFields };
    const wrongForKind = kindError(kind, {
      targetWaterGrams: after.targetWaterGrams ?? null,
      expectedYieldGrams: after.expectedYieldGrams ?? null,
      firstDropMinSec: after.firstDropMinSec ?? null,
      steps:
        steps ??
        (await tx
          .select({
            stepType: recipeSteps.stepType,
            advance: recipeSteps.advance,
            targetWaterGrams: recipeSteps.targetWaterGrams,
            pressureBar: recipeSteps.pressureBar,
            flowRate: recipeSteps.flowRate,
          })
          .from(recipeSteps)
          .where(eq(recipeSteps.recipeId, recipeId))),
    });
    if (wrongForKind) return { status: 400, error: wrongForKind } as const;
    // A sent style must fit; moving to a brewer of the other method clears a
    // style that no longer does.
    const wrongStyle = styleError(kind, recipeFields.style);
    if (wrongStyle) return { status: 400, error: wrongStyle } as const;
    const styleUpdate = recipeFields.style === undefined && styleError(kind, existing.style) ? { style: null } : {};
    if (grindSettings && !(await grindersInWorkspace(tx, grindSettings.map((g) => g.grinderId), workspaceId))) {
      return { status: 400, error: "grindSettings: grinderId not a grinder in this workspace" } as const;
    }
    if (recipeFields.defaultGrinderId && !(await grindersInWorkspace(tx, [recipeFields.defaultGrinderId], workspaceId))) {
      return { status: 400, error: "defaultGrinderId: not a grinder in this workspace" } as const;
    }

    const archive = archiveUpdate(recipes.archivedAt, archived);
    if (Object.keys(recipeFields).length > 0 || Object.keys(archive).length > 0) {
      await tx.update(recipes).set({ ...recipeFields, ...styleUpdate, ...archive }).where(eq(recipes.id, recipeId));
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

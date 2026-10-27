import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { enqueueParameterSuggestion, QueueUnavailableError } from "../queue.js";
import {
  beans,
  brewers,
  DEFAULT_WORKSPACE_SETTINGS,
  grinders,
  MAX_SUGGEST_BREWS,
  parameterSuggestions,
  recipes,
  SUGGEST_SOURCES,
  withDefaults,
  workspaces,
  type ParameterSuggestion,
  type SuggestSource,
} from "@barista/shared/schema";

// "Suggest parameters" (docs/api/analysis.md §8b): starting values for the
// brew about to be made, from the earlier brews the caller picks.
export interface ParameterSuggestionResponse {
  suggestion: ParameterSuggestion;
}

interface WorkspaceParams {
  workspaceId: string;
}
interface SuggestionParams extends WorkspaceParams {
  suggestionId: string;
}

// Grams, within (0, max]; saved to the column's 1 decimal.
const grams = (max: number) => z.number().positive().max(max).nullable().optional();

const createSchema = z
  .object({
    beanId: z.uuid(),
    recipeId: z.uuid().nullable().optional(),
    grinderId: z.uuid().nullable().optional(),
    brewerId: z.uuid().nullable().optional(), // without a recipe; else the recipe's
    source: z.enum(SUGGEST_SOURCES).optional(), // default: the workspace's
    maxBrews: z.number().int().min(1).max(MAX_SUGGEST_BREWS).optional(),
    // The batch as planned: kept as it is, the AI suggests a ratio for it.
    batch: z
      .object({ doseGrams: grams(1000), waterGrams: grams(10000), iceGrams: grams(10000), yieldGrams: grams(10000) })
      .strict()
      .optional(),
  })
  .strict();
const tenth = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 10) / 10);

// What each source needs to pick brews by.
const NEEDS_RECIPE: readonly SuggestSource[] = ["beanRecipe", "recipe"];
const NEEDS_BREWER: readonly SuggestSource[] = ["beanBrewer", "brewer"];

// Mounted at /api/workspaces/:workspaceId/parameter-suggestions
export const parameterSuggestionsRouter = Router({ mergeParams: true });
parameterSuggestionsRouter.use(requireAuth);

parameterSuggestionsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<ParameterSuggestionResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;

  const [bean] = await db.select({ id: beans.id }).from(beans).where(and(eq(beans.id, body.beanId), eq(beans.workspaceId, workspaceId)));
  if (!bean) {
    sendError(res, 400, "beanId: not a bean in this workspace");
    return;
  }
  let brewerId = body.brewerId ?? null;
  if (body.recipeId) {
    const [recipe] = await db
      .select({ brewerId: recipes.brewerId })
      .from(recipes)
      .where(and(eq(recipes.id, body.recipeId), eq(recipes.workspaceId, workspaceId)));
    if (!recipe) {
      sendError(res, 400, "recipeId: not a recipe in this workspace");
      return;
    }
    brewerId = recipe.brewerId;
  } else if (brewerId) {
    const [brewer] = await db.select({ id: brewers.id }).from(brewers).where(and(eq(brewers.id, brewerId), eq(brewers.workspaceId, workspaceId)));
    if (!brewer) {
      sendError(res, 400, "brewerId: not a brewer in this workspace");
      return;
    }
  }
  if (body.grinderId) {
    // Archived grinders are accepted, as on a brew (docs/api/brew-logs.md §6).
    const [grinder] = await db.select({ id: grinders.id }).from(grinders).where(and(eq(grinders.id, body.grinderId), eq(grinders.workspaceId, workspaceId)));
    if (!grinder) {
      sendError(res, 400, "grinderId: not a grinder in this workspace");
      return;
    }
  }

  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null);
  const source = body.source ?? settings.suggestSource;
  if (NEEDS_RECIPE.includes(source) && !body.recipeId) {
    sendError(res, 400, "source: pick a recipe to compare its brews");
    return;
  }
  if (NEEDS_BREWER.includes(source) && !brewerId) {
    sendError(res, 400, "source: pick a brewer to compare its brews");
    return;
  }

  const id = randomUUID();
  await db.insert(parameterSuggestions).values({
    id,
    beanId: body.beanId,
    recipeId: body.recipeId ?? null,
    brewerId,
    grinderId: body.grinderId ?? null,
    source,
    maxBrews: body.maxBrews ?? settings.suggestMaxBrews,
    batchDoseGrams: tenth(body.batch?.doseGrams),
    batchWaterGrams: tenth(body.batch?.waterGrams),
    batchIceGrams: tenth(body.batch?.iceGrams),
    batchYieldGrams: tenth(body.batch?.yieldGrams),
  });
  try {
    await enqueueParameterSuggestion(id);
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      console.error("Could not queue parameter suggestion:", err.message);
      await db.delete(parameterSuggestions).where(eq(parameterSuggestions.id, id));
      sendError(res, 503, "Suggestions are temporarily unavailable. Try again shortly.");
      return;
    }
    throw err;
  }
  const [suggestion] = await db.select().from(parameterSuggestions).where(eq(parameterSuggestions.id, id));
  if (!suggestion) throw new Error(`Parameter suggestion ${id} missing after insert`);
  res.status(202).json({ suggestion });
});

// Polled until it's done or failed (any member can read it).
parameterSuggestionsRouter.get("/:suggestionId", async (req: Request<SuggestionParams>, res: Response<ParameterSuggestionResponse>) => {
  const { workspaceId, suggestionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const [row] = await db
    .select({ suggestion: parameterSuggestions })
    .from(parameterSuggestions)
    .innerJoin(beans, eq(parameterSuggestions.beanId, beans.id))
    .where(and(eq(parameterSuggestions.id, suggestionId), eq(beans.workspaceId, workspaceId)));
  if (!row) {
    sendError(res, 404, "Suggestion not found");
    return;
  }
  res.json({ suggestion: row.suggestion });
});

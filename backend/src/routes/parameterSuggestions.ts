import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { enqueueParameterSuggestion, QueueUnavailableError } from "../queue.js";
import { sendPreview } from "../preview.js";
import { noteSchema } from "./aiPrompt.js";
import type { SuggestionPreview } from "@barista/shared/jobs";
import { SUGGESTION_COLUMNS, type SuggestionRow } from "../aiRequest.js";
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
  type AiRequest,
  type SuggestSource,
} from "@barista/shared/schema";

// "Suggest parameters" (docs/api/analysis.md §8b): starting values for the
// brew about to be made, from the earlier brews the caller picks.
export interface ParameterSuggestionResponse {
  suggestion: SuggestionRow;
}
export interface AiRequestResponse {
  request: AiRequest | null; // null: not saved (pending, failed, or from before it was)
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
    note: noteSchema, // a one-off note (docs/api/auth.md §1c)
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

// The request as it would be saved: ids checked against the workspace, the
// brewer from the recipe, the workspace's defaults filled in; or null once an
// error is sent. Shared by POST and the preview, so they can't differ.
async function resolveRequest(req: Request<WorkspaceParams>, res: Response): Promise<SuggestionPreview | null> {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return null;
  const body = parseBody(createSchema, req, res);
  if (!body) return null;

  const [bean] = await db.select({ id: beans.id }).from(beans).where(and(eq(beans.id, body.beanId), eq(beans.workspaceId, workspaceId)));
  if (!bean) {
    sendError(res, 400, "beanId: not a bean in this workspace");
    return null;
  }
  let brewerId = body.brewerId ?? null;
  if (body.recipeId) {
    const [recipe] = await db
      .select({ brewerId: recipes.brewerId })
      .from(recipes)
      .where(and(eq(recipes.id, body.recipeId), eq(recipes.workspaceId, workspaceId)));
    if (!recipe) {
      sendError(res, 400, "recipeId: not a recipe in this workspace");
      return null;
    }
    brewerId = recipe.brewerId;
  } else if (brewerId) {
    const [brewer] = await db.select({ id: brewers.id }).from(brewers).where(and(eq(brewers.id, brewerId), eq(brewers.workspaceId, workspaceId)));
    if (!brewer) {
      sendError(res, 400, "brewerId: not a brewer in this workspace");
      return null;
    }
  }
  if (body.grinderId) {
    // Archived grinders are accepted, as on a brew (docs/api/brew-logs.md §6).
    const [grinder] = await db.select({ id: grinders.id }).from(grinders).where(and(eq(grinders.id, body.grinderId), eq(grinders.workspaceId, workspaceId)));
    if (!grinder) {
      sendError(res, 400, "grinderId: not a grinder in this workspace");
      return null;
    }
  }

  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null);
  const source = body.source ?? settings.suggestSource;
  if (NEEDS_RECIPE.includes(source) && !body.recipeId) {
    sendError(res, 400, "source: pick a recipe to compare its brews");
    return null;
  }
  if (NEEDS_BREWER.includes(source) && !brewerId) {
    sendError(res, 400, "source: pick a brewer to compare its brews");
    return null;
  }
  return {
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
    requestedBy: userId, // their own AI prompt is used
    note: body.note || null,
  };
}

parameterSuggestionsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<ParameterSuggestionResponse>) => {
  const values = await resolveRequest(req, res);
  if (!values) return;
  const id = randomUUID();
  await db.insert(parameterSuggestions).values({ id, ...values });
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
  const [suggestion] = await db.select(SUGGESTION_COLUMNS).from(parameterSuggestions).where(eq(parameterSuggestions.id, id));
  if (!suggestion) throw new Error(`Parameter suggestion ${id} missing after insert`);
  res.status(202).json({ suggestion });
});

// What asking would send (docs/api/analysis.md §8d), without asking: the
// same body as POST, nothing saved.
parameterSuggestionsRouter.post("/preview", async (req: Request<WorkspaceParams>, res: Response<AiRequestResponse>) => {
  const suggestion = await resolveRequest(req, res);
  if (!suggestion) return;
  await sendPreview(res, { kind: "suggest", suggestion });
});

// Polled until it's done or failed (any member can read it).
parameterSuggestionsRouter.get("/:suggestionId", async (req: Request<SuggestionParams>, res: Response<ParameterSuggestionResponse>) => {
  const { workspaceId, suggestionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const [row] = await db
    .select({ suggestion: SUGGESTION_COLUMNS })
    .from(parameterSuggestions)
    .innerJoin(beans, eq(parameterSuggestions.beanId, beans.id))
    .where(and(eq(parameterSuggestions.id, suggestionId), eq(beans.workspaceId, workspaceId)));
  if (!row) {
    sendError(res, 404, "Suggestion not found");
    return;
  }
  res.json({ suggestion: row.suggestion });
});

// What was sent to the AI (docs/api/analysis.md §8c), any member.
parameterSuggestionsRouter.get("/:suggestionId/request", async (req: Request<SuggestionParams>, res: Response<AiRequestResponse>) => {
  const { workspaceId, suggestionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const [row] = await db
    .select({ request: parameterSuggestions.request })
    .from(parameterSuggestions)
    .innerJoin(beans, eq(parameterSuggestions.beanId, beans.id))
    .where(and(eq(parameterSuggestions.id, suggestionId), eq(beans.workspaceId, workspaceId)));
  if (!row) {
    sendError(res, 404, "Suggestion not found");
    return;
  }
  res.json({ request: row.request });
});

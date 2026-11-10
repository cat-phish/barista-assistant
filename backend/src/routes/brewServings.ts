// docs/api/brew-servings.md §6c: glasses taken from a finished long cold brew
// batch (cold brew, Kyoto drip), and marking the batch finished. Any owner or
// barista can pour from a batch (it's the workspace's stock); a serving is
// changed by whoever logged it, or an owner.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { LEXICON_KEY, LEXICON_LIMITS, type FlavorPick } from "@barista/shared/flavors";
import { brewLogs, brewServingFlavors, brewServings, DILUTION_WITH, LONG_STYLES, recipes, recipeStyles, users, type DilutionWith } from "@barista/shared/schema";
import { requireMembership, WRITE_ROLES, type Role } from "../auth/membership.js";
import { db } from "../db.js";
import { flavorPicks, resolveSaved, type SavedPick } from "../flavorPicks.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { decimalSchema, optionalText, ratingSchema, updateSchema } from "../validation.js";
import { loadBrewLogs, type BrewLogResponse } from "./brewLogs.js";

export interface BrewServingDetails {
  id: string;
  brewLogId: string;
  userId: string | null;
  loggedBy: { id: string; email: string } | null; // null once they deleted their account
  timestamp: Date;
  utcOffsetMinutes: number | null;
  concentrateGrams: number;
  diluentGrams: number | null;
  dilutedWith: DilutionWith | null;
  dilutionRatio: number | null; // 1 : this, diluent ÷ concentrate; null when neat
  rating: number | null;
  tastingNotes: string | null;
  flavors: FlavorPick[];
  createdAt: Date;
}

interface BatchParams {
  workspaceId: string;
  brewLogId: string;
}
interface ServingParams extends BatchParams {
  servingId: string;
}

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const grams = decimalSchema({ min: 0, max: 10000, scale: 1, exclusiveMin: true, exclusiveMax: true });
const servingFields = {
  timestamp: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() <= Date.now() + FUTURE_SKEW_MS, "can't be more than 5 minutes in the future")
    .optional(),
  utcOffsetMinutes: z.number().int().min(-720).max(840).nullable().optional(),
  concentrateGrams: grams,
  diluentGrams: decimalSchema({ min: 0, max: 10000, scale: 1, exclusiveMax: true }).nullable().optional(),
  dilutedWith: z.enum(DILUTION_WITH).nullable().optional(),
  rating: ratingSchema.nullable().optional(),
  tastingNotes: optionalText(5000),
  flavors: z
    .array(z.string().max(LEXICON_LIMITS.key).regex(LEXICON_KEY, "not a flavor key"))
    .max(LEXICON_LIMITS.flavors)
    .refine((keys) => new Set(keys).size === keys.length, "each flavor once")
    .optional(),
};
const createSchema = z.object(servingFields).strict();
const updateServingSchema = updateSchema(servingFields);
const batchSchema = z.object({ finished: z.boolean() }).strict();

// A diluent defaults to water; neat (no or 0 g diluent) has nothing it's diluted with.
function dilution(diluentGrams: number | null | undefined, dilutedWith: DilutionWith | null | undefined): { diluentGrams: number | null; dilutedWith: DilutionWith | null } {
  const g = diluentGrams ?? null;
  return g ? { diluentGrams: g, dilutedWith: dilutedWith ?? "water" } : { diluentGrams: g, dilutedWith: null };
}

type BatchState = "not_found" | "not_batch" | "steeping" | { finishedAt: Date | null };
async function batchState(params: BatchParams): Promise<BatchState> {
  const [row] = await db
    .select({ steeping: brewLogs.steeping, finishedAt: brewLogs.batchFinishedAt, brewsLike: recipeStyles.brewsLike })
    .from(brewLogs)
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
    .where(and(eq(brewLogs.id, params.brewLogId), eq(brewLogs.workspaceId, params.workspaceId)));
  if (!row) return "not_found";
  if (!row.brewsLike || !LONG_STYLES.includes(row.brewsLike)) return "not_batch";
  if (row.steeping) return "steeping";
  return { finishedAt: row.finishedAt };
}

// Sends the error for a brew that can't be poured from; true when it can.
function batchOk(res: Response, state: BatchState, needOpen: boolean): state is { finishedAt: Date | null } {
  if (state === "not_found") sendError(res, 404, "Brew log not found");
  else if (state === "not_batch") sendError(res, 409, "Only a cold brew or Kyoto drip batch has servings");
  else if (state === "steeping") sendError(res, 409, "Still steeping: finish the brew first");
  else if (needOpen && state.finishedAt) sendError(res, 409, "This batch is finished: reopen it to log a serving");
  else return true;
  return false;
}

async function loadServings(brewLogId: string, workspaceId: string, servingId?: string): Promise<BrewServingDetails[]> {
  const rows = await db
    .select({ serving: brewServings, email: users.email })
    .from(brewServings)
    .leftJoin(users, eq(brewServings.userId, users.id))
    .where(and(eq(brewServings.brewLogId, brewLogId), servingId ? eq(brewServings.id, servingId) : undefined))
    .orderBy(asc(brewServings.timestamp), asc(brewServings.createdAt));
  const ids = rows.map((r) => r.serving.id);
  const picks: SavedPick[] =
    ids.length === 0 ? [] : (await db.select().from(brewServingFlavors).where(inArray(brewServingFlavors.servingId, ids))).map(({ servingId: ownerId, ...r }) => ({ ownerId, ...r }));
  const flavors = await resolveSaved(ids.map((id) => ({ id, workspaceId })), picks);
  return rows.map(({ serving: s, email }) => ({
    ...s,
    loggedBy: s.userId && email ? { id: s.userId, email } : null,
    dilutionRatio: s.diluentGrams ? Math.round((s.diluentGrams / s.concentrateGrams) * 100) / 100 : null,
    flavors: flavors.get(s.id) ?? [],
  }));
}

const canChange = (role: Role, callerId: string, servingUserId: string | null) => role === "owner" || (role === "barista" && servingUserId === callerId);

// Mounted at /api/workspaces/:workspaceId/brew-logs/:brewLogId
export const brewServingsRouter = Router({ mergeParams: true });
brewServingsRouter.use(requireAuth);

brewServingsRouter.get("/servings", async (req: Request<BatchParams>, res: Response<{ servings: BrewServingDetails[] }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId))) return;
  const state = await batchState(req.params);
  if (state === "not_found") return sendError(res, 404, "Brew log not found");
  res.json({ servings: await loadServings(req.params.brewLogId, req.params.workspaceId) });
});

brewServingsRouter.post("/servings", async (req: Request<BatchParams>, res: Response<{ serving: BrewServingDetails }>) => {
  const userId = authedUserId(req);
  const { workspaceId, brewLogId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  if (!batchOk(res, await batchState(req.params), true)) return;

  const { flavors = [], diluentGrams, dilutedWith, ...fields } = body;
  const id = randomUUID();
  const error = await db.transaction(async (tx) => {
    const picks = await flavorPicks(tx, workspaceId, flavors);
    if (typeof picks === "string") return picks;
    await tx.insert(brewServings).values({ id, brewLogId, userId, ...fields, ...dilution(diluentGrams, dilutedWith) });
    if (picks.length) await tx.insert(brewServingFlavors).values(picks.map((p) => ({ servingId: id, flavorKey: p.key, label: p.label, place: p.place ?? null })));
    return null;
  });
  if (error) return sendError(res, 400, error);
  const [serving] = await loadServings(brewLogId, workspaceId, id);
  res.status(201).json({ serving: serving! });
});

brewServingsRouter.patch("/servings/:servingId", async (req: Request<ServingParams>, res: Response<{ serving: BrewServingDetails }>) => {
  const userId = authedUserId(req);
  const { workspaceId, brewLogId, servingId } = req.params;
  const role = await requireMembership(res, userId, workspaceId, WRITE_ROLES);
  if (!role) return;
  const body = parseBody(updateServingSchema, req, res);
  if (!body) return;
  if (!batchOk(res, await batchState(req.params), false)) return;
  const [existing] = await db.select().from(brewServings).where(and(eq(brewServings.id, servingId), eq(brewServings.brewLogId, brewLogId)));
  if (!existing) return sendError(res, 404, "Serving not found");
  if (!canChange(role, userId, existing.userId)) return sendError(res, 403, "Baristas can only change servings they logged");

  const { flavors, diluentGrams, dilutedWith, ...fields } = body;
  const diluted = "diluentGrams" in body || "dilutedWith" in body ? dilution("diluentGrams" in body ? diluentGrams : existing.diluentGrams, "dilutedWith" in body ? dilutedWith : existing.dilutedWith) : {};
  const error = await db.transaction(async (tx) => {
    let picks: FlavorPick[] | null = null;
    if (flavors) {
      const had = (await tx.select().from(brewServingFlavors).where(eq(brewServingFlavors.servingId, servingId))).map(({ servingId: ownerId, ...r }) => ({ ownerId, ...r }));
      const result = await flavorPicks(tx, workspaceId, flavors, had);
      if (typeof result === "string") return result;
      picks = result;
    }
    const set = { ...fields, ...diluted };
    if (Object.keys(set).length) await tx.update(brewServings).set(set).where(eq(brewServings.id, servingId));
    if (picks) {
      await tx.delete(brewServingFlavors).where(eq(brewServingFlavors.servingId, servingId));
      if (picks.length) await tx.insert(brewServingFlavors).values(picks.map((p) => ({ servingId, flavorKey: p.key, label: p.label, place: p.place ?? null })));
    }
    return null;
  });
  if (error) return sendError(res, 400, error);
  const [serving] = await loadServings(brewLogId, workspaceId, servingId);
  res.json({ serving: serving! });
});

brewServingsRouter.delete("/servings/:servingId", async (req: Request<ServingParams>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId, brewLogId, servingId } = req.params;
  const role = await requireMembership(res, userId, workspaceId, WRITE_ROLES);
  if (!role) return;
  if ((await batchState(req.params)) === "not_found") return sendError(res, 404, "Brew log not found");
  const [existing] = await db.select().from(brewServings).where(and(eq(brewServings.id, servingId), eq(brewServings.brewLogId, brewLogId)));
  if (!existing) return sendError(res, 404, "Serving not found");
  if (!canChange(role, userId, existing.userId)) return sendError(res, 403, "Baristas can only delete servings they logged");
  await db.delete(brewServings).where(eq(brewServings.id, servingId));
  res.status(204).end();
});

// Batch finished (or reopened): no more servings while it's finished.
brewServingsRouter.put("/batch", async (req: Request<BatchParams>, res: Response<BrewLogResponse>) => {
  const { workspaceId, brewLogId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(batchSchema, req, res);
  if (!body) return;
  const state = await batchState(req.params);
  if (!batchOk(res, state, false)) return;
  const finishedAt = body.finished ? (state.finishedAt ?? new Date()) : null;
  await db.update(brewLogs).set({ batchFinishedAt: finishedAt }).where(eq(brewLogs.id, brewLogId));
  const [brewLog] = await loadBrewLogs(and(eq(brewLogs.id, brewLogId), eq(brewLogs.workspaceId, workspaceId)));
  res.json({ brewLog: brewLog! });
});

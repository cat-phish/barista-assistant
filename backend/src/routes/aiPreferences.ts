import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  applyProposal,
  MAX_PREFERENCE_TEXT,
  MAX_PREFERENCES,
  PREFERENCE_APPLY,
  PREFERENCE_LEARN,
  withPreferenceDefaults,
  type AiPreference,
  type AiPreferences,
} from "@barista/shared/aiPreferences";
import { DEFAULT_PREFERENCES, DEFAULT_WORKSPACE_SETTINGS, users, withDefaults, workspaces } from "@barista/shared/schema";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { requireAi } from "../aiConfig.js";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { enqueueLearnPreferences, QueueUnavailableError } from "../queue.js";

// Learned preferences (docs/api/auth.md §1d): the person's own list, the
// proposals the AI made for it, and Update now for one workspace.

export interface AiPreferencesResponse {
  aiPreferences: AiPreferences;
  limits: { items: number; text: number };
}
const respond = (p: AiPreferences | null): AiPreferencesResponse => ({
  aiPreferences: withPreferenceDefaults(p),
  limits: { items: MAX_PREFERENCES, text: MAX_PREFERENCE_TEXT },
});

const putSchema = z
  .object({
    learn: z.enum(PREFERENCE_LEARN),
    apply: z.enum(PREFERENCE_APPLY),
    items: z
      .array(z.object({ id: z.string().max(36).optional(), text: z.string().trim().min(1).max(MAX_PREFERENCE_TEXT) }).strict())
      .max(MAX_PREFERENCES),
  })
  .strict();

async function load(userId: string): Promise<AiPreferences | null | undefined> {
  const [row] = await db.select({ p: users.aiPreferences }).from(users).where(eq(users.id, userId));
  return row ? row.p : undefined;
}
async function save(userId: string, p: AiPreferences): Promise<void> {
  await db.update(users).set({ aiPreferences: p }).where(eq(users.id, userId));
}

export const aiPreferencesRouter = Router();
aiPreferencesRouter.use(requireAuth);

aiPreferencesRouter.get("/", async (req: Request, res: Response<AiPreferencesResponse>) => {
  const p = await load(authedUserId(req));
  if (p === undefined) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json(respond(p));
});

aiPreferencesRouter.put("/", async (req: Request, res: Response<AiPreferencesResponse>) => {
  const body = parseBody(putSchema, req, res);
  if (!body) return;
  const userId = authedUserId(req);
  const stored = await load(userId);
  if (stored === undefined) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  const prefs = withPreferenceDefaults(stored);
  const byId = new Map(prefs.items.map((i) => [i.id, i]));
  if (body.items.some((i) => i.id !== undefined && !byId.has(i.id))) {
    sendError(res, 400, "items: no such preference");
    return;
  }
  const now = new Date().toISOString();
  const items: AiPreference[] = body.items.map((i) => {
    const old = i.id ? byId.get(i.id) : undefined;
    if (old && old.text === i.text) return old;
    return { id: old?.id ?? randomUUID(), text: i.text, basis: 0, source: "person", updatedAt: now };
  });
  const kept = new Set(items.map((i) => i.id));
  const next: AiPreferences = { ...prefs, learn: body.learn, apply: body.apply, items, proposals: prefs.proposals.filter((p) => p.targetId === null || kept.has(p.targetId)) };
  await save(userId, next);
  res.json(respond(next));
});

type ProposalParams = { proposalId: string; action: string };
aiPreferencesRouter.post("/proposals/:proposalId/:action", async (req: Request<ProposalParams>, res: Response<AiPreferencesResponse>) => {
  const { proposalId, action } = req.params;
  if (action !== "accept" && action !== "dismiss") {
    sendError(res, 404, "Not found");
    return;
  }
  const userId = authedUserId(req);
  const stored = await load(userId);
  if (stored === undefined) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  const prefs = withPreferenceDefaults(stored);
  const proposal = prefs.proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    sendError(res, 404, "Proposal not found");
    return;
  }
  let items = prefs.items;
  if (action === "accept") {
    const applied = applyProposal(items, proposal, "ai", new Date().toISOString(), randomUUID);
    if (!applied) {
      sendError(res, 409, `You already have ${MAX_PREFERENCES} preferences`);
      return;
    }
    items = applied;
  }
  const next: AiPreferences = { ...prefs, items, proposals: prefs.proposals.filter((p) => p.id !== proposalId) };
  await save(userId, next);
  res.json(respond(next));
});

// Whether the workspace keeps learned preferences from the AI.
async function learningOff(workspaceId: string): Promise<boolean> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null).aiHidden.includes("learnedPreferences");
}

// Learn about me (docs/api/auth.md §1d): the person's own switch.
export async function learnsAboutMe(userId: string): Promise<boolean> {
  const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  return withDefaults(DEFAULT_PREFERENCES, row?.preferences ?? null).learnAboutMe;
}
export const LEARN_OFF = "Learn about me is off (Settings → Learned preferences)";

// After a like or dislike (docs/api/llm-contract.md §9g): queued when the
// person learns automatically. Never fails the request it follows.
export async function learnAfterSignal(userId: string, workspaceId: string): Promise<void> {
  try {
    const p = await load(userId);
    if (withPreferenceDefaults(p).learn !== "auto" || !(await learnsAboutMe(userId)) || (await learningOff(workspaceId))) return;
    await enqueueLearnPreferences({ userId, workspaceId });
  } catch (err) {
    console.error("Couldn't queue learning preferences:", err instanceof Error ? err.message : err);
  }
}

// POST /api/workspaces/:workspaceId/ai-preferences/update
export const workspaceAiPreferencesRouter = Router({ mergeParams: true });
workspaceAiPreferencesRouter.use(requireAuth);
workspaceAiPreferencesRouter.post("/update", async (req: Request<{ workspaceId: string }>, res: Response<{ queued: true }>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  if (!(await learnsAboutMe(userId))) {
    sendError(res, 409, LEARN_OFF);
    return;
  }
  if (await learningOff(workspaceId)) {
    sendError(res, 409, "This workspace keeps learned preferences from the AI (Settings → AI)");
    return;
  }
  if (!(await requireAi(res, workspaceId))) return;
  try {
    await enqueueLearnPreferences({ userId, workspaceId }, 0);
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      sendError(res, 503, "The AI queue isn't available right now");
      return;
    }
    throw err;
  }
  res.status(202).json({ queued: true });
});

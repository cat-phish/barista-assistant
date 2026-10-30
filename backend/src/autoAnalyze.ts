// Auto-analyze (docs/api/analysis.md §8): when a workspace has it on, a rated
// brew is analyzed autoAnalyzeDelayMinutes after it's saved, and an unrated
// (or still steeping) one as soon as it's first rated. Queueing never fails
// the save: if Redis is down the brew just isn't analyzed automatically.
import { analysisRequests, DEFAULT_WORKSPACE_SETTINGS, withDefaults, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { enqueueBrewAnalysis } from "./queue.js";

interface BrewState {
  id: string;
  workspaceId: string;
  rating: number | null;
  drinkRating: number | null;
  steeping: boolean;
  analyzed: boolean;
}

const ready = (b: Omit<BrewState, "id" | "workspaceId" | "analyzed">) => !b.steeping && (b.rating !== null || b.drinkRating !== null);

async function settingsOf(workspaceId: string) {
  const [row] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return withDefaults(DEFAULT_WORKSPACE_SETTINGS, row?.settings ?? null);
}

// Queues the brew's automatic analysis and records when it's due. Returns
// the due time, or null when nothing was queued.
async function queue(brewLogId: string, delayMs: number): Promise<Date | null> {
  try {
    await enqueueBrewAnalysis(brewLogId, { auto: true, delayMs });
  } catch (err) {
    console.error(`Could not queue the automatic analysis of ${brewLogId}:`, err instanceof Error ? err.message : err);
    return null;
  }
  const dueAt = new Date(Date.now() + delayMs);
  await db
    .insert(analysisRequests)
    .values({ brewLogId, dueAt, error: null })
    .onDuplicateKeyUpdate({ set: { dueAt, error: null, updatedAt: new Date() } });
  return dueAt;
}

// A new brew: rated ones wait the workspace's delay; unrated and steeping
// ones wait for their rating (onEdited).
export async function autoAnalyzeOnSave(brew: BrewState): Promise<Date | null> {
  if (!ready(brew)) return null;
  const settings = await settingsOf(brew.workspaceId);
  if (!settings.autoAnalyze) return null;
  return queue(brew.id, settings.autoAnalyzeDelayMinutes * 60_000);
}

// An edit that gave a brew its first rating, or finished its steep: analyzed
// now, unless it already has a suggestion.
export async function autoAnalyzeOnEdited(before: Omit<BrewState, "id" | "workspaceId" | "analyzed">, after: BrewState): Promise<Date | null> {
  if (ready(before) || !ready(after) || after.analyzed) return null;
  const settings = await settingsOf(after.workspaceId);
  if (!settings.autoAnalyze) return null;
  return queue(after.id, 0);
}

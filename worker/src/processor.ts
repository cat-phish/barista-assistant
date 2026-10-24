import { randomUUID } from "node:crypto";
import type { BrewAnalysisJobData } from "@barista/shared/jobs";
import type { AiDetail } from "@barista/shared/aiDetails";
import { brewLogs, DEFAULT_WORKSPACE_SETTINGS, llmAnalyses, withDefaults, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { loadBrewContext } from "./context.js";
import { db } from "./db.js";
import { config } from "./config.js";
import { analyzeWithLlm, PROMPT_VERSION } from "./llm.js";

// What the brew's workspace keeps from the AI (Settings → AI,
// docs/api/llm-contract.md §9 "What the AI sees").
async function aiHiddenFor(brewLogId: string): Promise<Set<AiDetail>> {
  const [row] = await db
    .select({ settings: workspaces.settings })
    .from(brewLogs)
    .innerJoin(workspaces, eq(brewLogs.workspaceId, workspaces.id))
    .where(eq(brewLogs.id, brewLogId));
  return new Set(withDefaults(DEFAULT_WORKSPACE_SETTINGS, row?.settings ?? null).aiHidden);
}

export type JobResult = { status: "saved"; analysisId: string } | { status: "skipped"; reason: string };

// One brew-analysis job. Throwing makes BullMQ retry (docs/api/llm-contract.md §9).
export async function processBrewAnalysis({ brewLogId }: BrewAnalysisJobData): Promise<JobResult> {

  const context = await loadBrewContext(brewLogId);
  if (!context) {
    // Deleted after queueing: nothing to analyze, and retrying won't change that.
    return { status: "skipped", reason: "brew log no longer exists" };
  }
  // A cold brew still steeping has nothing to judge (the API refuses to queue
  // one; this covers a job queued just before it was started over).
  if (context.brew.steeping) return { status: "skipped", reason: "still steeping" };

  const hidden = await aiHiddenFor(brewLogId);
  // The workspace only analyzes rated brews (the API refuses to queue an
  // unrated one; this covers a job queued before the switch).
  if (hidden.has("analyzeUnrated") && context.brew.rating === null && context.brew.drinkRating === null) {
    return { status: "skipped", reason: "unrated brews aren't analyzed" };
  }

  const analysis = await analyzeWithLlm(context, hidden);

  const analysisId = randomUUID();
  try {
    await db.insert(llmAnalyses).values({ id: analysisId, brewLogId, ...analysis, model: config.openaiModel, promptVersion: PROMPT_VERSION });
  } catch (err) {
    // The log may have been deleted while the LLM call was running (FK violation).
    if ((await loadBrewContext(brewLogId)) === null) {
      return { status: "skipped", reason: "brew log deleted during analysis" };
    }
    throw err;
  }
  return { status: "saved", analysisId };
}

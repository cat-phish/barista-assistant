import { randomUUID } from "node:crypto";
import type { BrewAnalysisJobData } from "@barista/shared/jobs";
import { llmAnalyses } from "@barista/shared/schema";
import { loadBrewContext } from "./context.js";
import { db } from "./db.js";
import { analyzeWithLlm } from "./llm.js";

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

  const analysis = await analyzeWithLlm(context);

  const analysisId = randomUUID();
  try {
    await db.insert(llmAnalyses).values({ id: analysisId, brewLogId, ...analysis });
  } catch (err) {
    // The log may have been deleted while the LLM call was running (FK violation).
    if ((await loadBrewContext(brewLogId)) === null) {
      return { status: "skipped", reason: "brew log deleted during analysis" };
    }
    throw err;
  }
  return { status: "saved", analysisId };
}

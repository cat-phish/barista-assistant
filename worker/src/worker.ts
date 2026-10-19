import "dotenv/config";
import { randomUUID } from "node:crypto";
import { BREW_ANALYSIS_QUEUE, type BrewAnalysisJobData } from "@barista/shared/jobs";
import { llmAnalyses } from "@barista/shared/schema";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { loadBrewContext } from "./context.js";
import { db, pool } from "./db.js";
import { analyzeWithLlm } from "./llm.js";

type JobResult = { status: "saved"; analysisId: string } | { status: "skipped"; reason: string };

async function processBrewAnalysis(job: Job<BrewAnalysisJobData>): Promise<JobResult> {
  const { brewLogId } = job.data;

  const context = await loadBrewContext(brewLogId);
  if (!context) {
    // Deleted after queueing: nothing to analyze, and retrying won't change that.
    return { status: "skipped", reason: "brew log no longer exists" };
  }

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

// BullMQ workers need maxRetriesPerRequest: null (blocking commands).
const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  ...(config.redis.password ? { password: config.redis.password } : {}),
});

const worker = new Worker<BrewAnalysisJobData, JobResult>(BREW_ANALYSIS_QUEUE, processBrewAnalysis, {
  connection,
  concurrency: config.concurrency,
});

worker.on("ready", () => console.log(`Worker listening on queue "${BREW_ANALYSIS_QUEUE}"`));
worker.on("completed", (job, result) => {
  console.log(`Job ${job.id}: ${result.status}${result.status === "skipped" ? ` (${result.reason})` : ""}`);
});
worker.on("failed", (job, err) => {
  if (!job) {
    console.error(`Job ? failed: ${err.message}`);
    return;
  }
  const maxAttempts = job.opts.attempts ?? 1;
  const final = err instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;
  const outcome = final
    ? `giving up after attempt ${job.attemptsMade}/${maxAttempts}`
    : `attempt ${job.attemptsMade}/${maxAttempts}, will retry`;
  console.error(`Job ${job.id} failed (${outcome}): ${err.message}`);
});
worker.on("error", (err) => console.error("Worker error:", err.message));

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, finishing active jobs`);
  // close() waits for running jobs to finish before resolving.
  const results = await Promise.allSettled([worker.close(), pool.end()]);
  for (const r of results) {
    if (r.status === "rejected") console.error("Error during shutdown:", r.reason);
  }
  connection.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

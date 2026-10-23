import "dotenv/config";
import { BREW_ANALYSIS_QUEUE, REMINDER_QUEUE, STEEP_REMINDER_JOB, type BrewAnalysisJobData, type RateReminderJobData, type SteepReminderJobData } from "@barista/shared/jobs";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { pool } from "./db.js";
import { processBrewAnalysis, type JobResult } from "./processor.js";
import { processRateReminder, processSteepReminder, type ReminderResult } from "./reminders.js";

// BullMQ workers need maxRetriesPerRequest: null (blocking commands).
const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  ...(config.redis.password ? { password: config.redis.password } : {}),
});

const worker = new Worker<BrewAnalysisJobData, JobResult>(BREW_ANALYSIS_QUEUE, (job: Job<BrewAnalysisJobData>) => processBrewAnalysis(job.data), {
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

// Reminders (docs/api/notifications.md §1b): delayed jobs, sent once due.
// The job name says which: rate later, or a cold brew's steep done.
type ReminderJob = Job<RateReminderJobData | SteepReminderJobData>;
const reminders = new Worker<RateReminderJobData | SteepReminderJobData, ReminderResult>(REMINDER_QUEUE, (job: ReminderJob) => (job.name === STEEP_REMINDER_JOB ? processSteepReminder(job.data) : processRateReminder(job.data)), {
  connection,
  concurrency: config.concurrency,
});
reminders.on("completed", (job, result) => {
  const detail = result.status === "sent" ? `sent to ${result.channels}${result.failed.length ? `, failed: ${result.failed.join("; ")}` : ""}` : `skipped (${result.reason})`;
  console.log(`Reminder ${job.id}: ${detail}`);
});
reminders.on("failed", (job, err) => console.error(`Reminder ${job?.id ?? "?"} failed: ${err.message}`));
reminders.on("error", (err) => console.error("Reminder worker error:", err.message));

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, finishing active jobs`);
  // close() waits for running jobs to finish before resolving.
  const results = await Promise.allSettled([worker.close(), reminders.close()]);
  results.push(...(await Promise.allSettled([pool.end()])));
  for (const r of results) {
    if (r.status === "rejected") console.error("Error during shutdown:", r.reason);
  }
  connection.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

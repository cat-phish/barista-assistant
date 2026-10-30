import "dotenv/config";
import { AI_PREVIEW_QUEUE, BREW_ANALYSIS_QUEUE, LABEL_READ_QUEUE, MAINTENANCE_QUEUE, PARAMETER_SUGGESTION_QUEUE, REMINDER_QUEUE, STEEP_REMINDER_JOB, REST_REMINDER_JOB, GREEN_LOW_JOB, type AiPreviewJobData, type BrewAnalysisJobData, type DbBackupJobData, type LabelReadJobData, type LabelReadResult, type ParameterSuggestionJobData, type GreenLowJobData, type RateReminderJobData, type RestReminderJobData, type SteepReminderJobData } from "@barista/shared/jobs";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { pool } from "./db.js";
import { failSuggestion, failureMessage, processAiPreview, processBrewAnalysis, processParameterSuggestion, settleRequest, type JobResult } from "./processor.js";
import { processGreenLow, processRateReminder, processRestReminder, processSteepReminder, type ReminderResult } from "./reminders.js";
import { runDbBackup, type BackupResult } from "./dbBackup.js";
import { readLabel } from "./label.js";
import type { AiRequest } from "@barista/shared/schema";

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
  // Shown on the journal entry with "Try again" (docs/api/analysis.md §8).
  if (final) void settleRequest(job.data.brewLogId, failureMessage(err instanceof UnrecoverableError)).catch(() => undefined);
});
worker.on("error", (err) => console.error("Worker error:", err.message));

// "Suggest parameters" (docs/api/analysis.md §8b): retried like an analysis;
// once every attempt fails, the suggestion says why.
const suggestions = new Worker<ParameterSuggestionJobData, JobResult>(PARAMETER_SUGGESTION_QUEUE, (job: Job<ParameterSuggestionJobData>) => processParameterSuggestion(job.data), {
  connection,
  concurrency: config.concurrency,
});
suggestions.on("completed", (job, result) => {
  console.log(`Suggestion ${job.id}: ${result.status}${result.status === "skipped" ? ` (${result.reason})` : ""}`);
});
suggestions.on("failed", (job, err) => {
  if (!job) return;
  const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  console.error(`Suggestion ${job.id} failed (${final ? "giving up" : "will retry"}): ${err.message}`);
  if (final) void failSuggestion(job.data.suggestionId, failureMessage(err instanceof UnrecoverableError)).catch(() => undefined);
});
suggestions.on("error", (err) => console.error("Suggestion worker error:", err.message));

// Previews (docs/api/analysis.md §8d): no AI call, so quick; the backend
// waits for the return value. Not retried.
const previews = new Worker<AiPreviewJobData, AiRequest | null>(AI_PREVIEW_QUEUE, (job: Job<AiPreviewJobData>) => processAiPreview(job.data), {
  connection,
  concurrency: config.concurrency,
});
previews.on("failed", (job, err) => console.error(`Preview ${job?.id ?? "?"} failed: ${err.message}`));
previews.on("error", (err) => console.error("Preview worker error:", err.message));

// Bean labels (docs/api/llm-contract.md §9c): an AI call the backend waits
// for; not retried (the person tries again), nothing stored.
const labels = new Worker<LabelReadJobData, LabelReadResult>(LABEL_READ_QUEUE, (job: Job<LabelReadJobData>) => readLabel(job.data), {
  connection,
  concurrency: config.concurrency,
});
labels.on("failed", (job, err) => console.error(`Label read ${job?.id ?? "?"} failed: ${err.message}`));
labels.on("error", (err) => console.error("Label worker error:", err.message));

// Reminders (docs/api/notifications.md §1b): delayed jobs, sent once due.
// The job name says which: rate later, a cold brew's steep done, a roast
// rested, or a green coffee running low.
type ReminderData = RateReminderJobData | SteepReminderJobData | RestReminderJobData | GreenLowJobData;
function runReminder(job: Job<ReminderData>): Promise<ReminderResult> {
  switch (job.name) {
    case STEEP_REMINDER_JOB:
      return processSteepReminder(job.data as SteepReminderJobData);
    case REST_REMINDER_JOB:
      return processRestReminder(job.data as RestReminderJobData);
    case GREEN_LOW_JOB:
      return processGreenLow(job.data as GreenLowJobData);
    default:
      return processRateReminder(job.data as RateReminderJobData);
  }
}
const reminders = new Worker<ReminderData, ReminderResult>(REMINDER_QUEUE, runReminder, {
  connection,
  concurrency: config.concurrency,
});
reminders.on("completed", (job, result) => {
  const detail = result.status === "sent" ? `sent to ${result.channels}${result.failed.length ? `, failed: ${result.failed.join("; ")}` : ""}` : `skipped (${result.reason})`;
  console.log(`Reminder ${job.id}: ${detail}`);
});
reminders.on("failed", (job, err) => console.error(`Reminder ${job?.id ?? "?"} failed: ${err.message}`));
reminders.on("error", (err) => console.error("Reminder worker error:", err.message));

// Scheduled server backups (docs/api/server.md §10): one dump at a time.
const maintenance = new Worker<DbBackupJobData, BackupResult>(MAINTENANCE_QUEUE, () => runDbBackup(), { connection, concurrency: 1 });
maintenance.on("completed", (job, r) => {
  console.log(`Backup ${job.id} (${job.data.reason}): ${r.file}, ${r.bytes} bytes${r.pruned.length ? `; removed ${r.pruned.join(", ")}` : ""}`);
});
maintenance.on("failed", (job, err) => console.error(`Backup ${job?.id ?? "?"} failed: ${err.message}`));
maintenance.on("error", (err) => console.error("Maintenance worker error:", err.message));

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, finishing active jobs`);
  // close() waits for running jobs to finish before resolving.
  const results = await Promise.allSettled([worker.close(), suggestions.close(), previews.close(), labels.close(), reminders.close(), maintenance.close()]);
  results.push(...(await Promise.allSettled([pool.end()])));
  for (const r of results) {
    if (r.status === "rejected") console.error("Error during shutdown:", r.reason);
  }
  connection.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

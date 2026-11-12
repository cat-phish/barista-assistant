import "dotenv/config";
import { AI_CHECK_QUEUE, AI_PREVIEW_QUEUE, BEAN_REVIEW_QUEUE, BREW_ANALYSIS_QUEUE, CHAT_QUEUE, CHAT_SUMMARY_JOB, LABEL_READ_QUEUE, MAINTENANCE_QUEUE, PARAMETER_SUGGESTION_QUEUE, RECAP_SUMMARY_QUEUE, REMINDER_QUEUE, RECAP_TICK_JOB, STEEP_REMINDER_JOB, BEAN_REST_TICK_JOB, LEGACY_REST_REMINDER_JOB, GREEN_LOW_JOB, type AiCheckJobData, type AiCheckResult, type AiPreviewJobData, type BeanReviewJobData, type BeanReviewResult, type BrewAnalysisJobData, type ChatJobData, type ChatSummaryJobData, type DbBackupJobData, type LabelReadJobData, type LabelReadResult, type ParameterSuggestionJobData, type RecapSummaryJobData, type GreenLowJobData, type RateReminderJobData, type RecapTickJobData, type BeanRestTickJobData, type SteepReminderJobData } from "@barista/shared/jobs";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { pool } from "./db.js";
import { failSuggestion, failureMessage, processAiPreview, processBeanReview, processBrewAnalysis, processParameterSuggestion, settleRequest, type JobResult } from "./processor.js";
import { processRecapTick, type RecapTickResult } from "./recaps.js";
import { failRecapSummary, writeRecapSummary, type RecapSummaryResult } from "./recapSummary.js";
import { processGreenLow, processRateReminder, processSteepReminder, type ReminderResult } from "./reminders.js";
import { processBeanRestTick, type BeanRestTickResult } from "./beanRest.js";
import { runDbBackup, type BackupResult } from "./dbBackup.js";
import { readLabel } from "./label.js";
import { runAiCheck } from "./ai/check.js";
import { processChatReply, redisPublisher, type ChatResult } from "./chat.js";
import { processChatSummary, type ChatSummaryResult } from "./chatSummary.js";
import { NO_AI, publishEnvStatus } from "./ai/resolve.js";
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

// Recap summaries (docs/api/llm-contract.md §9f): retried; once every
// attempt fails, the recap says why.
const recapSummaries = new Worker<RecapSummaryJobData, RecapSummaryResult>(RECAP_SUMMARY_QUEUE, (job: Job<RecapSummaryJobData>) => writeRecapSummary(job.data), {
  connection,
  concurrency: config.concurrency,
});
recapSummaries.on("completed", (job, result) => {
  console.log(`Recap summary ${job.id}: ${result.status}${result.status === "skipped" ? ` (${result.reason})` : ""}`);
});
recapSummaries.on("failed", (job, err) => {
  if (!job) return;
  const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  console.error(`Recap summary ${job.id} failed (${final ? "giving up" : "will retry"}): ${err.message}`);
  if (final) void failRecapSummary(job.data.recapId, err.message.startsWith(NO_AI) ? NO_AI : failureMessage(err instanceof UnrecoverableError)).catch(() => undefined);
});
recapSummaries.on("error", (err) => console.error("Recap summary worker error:", err.message));

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

// Bean review drafts (docs/api/llm-contract.md §9d): the same, an AI call the
// backend waits for; not retried, nothing stored.
const beanReviews = new Worker<BeanReviewJobData, BeanReviewResult | null>(BEAN_REVIEW_QUEUE, (job: Job<BeanReviewJobData>) => processBeanReview(job.data), {
  connection,
  concurrency: config.concurrency,
});
beanReviews.on("failed", (job, err) => console.error(`Bean review ${job?.id ?? "?"} failed: ${err.message}`));
beanReviews.on("error", (err) => console.error("Bean review worker error:", err.message));

// Chat replies and summaries (docs/api/llm-contract.md §9e): one attempt; a
// failed one is saved as failed, so only something unexpected ends up here.
const chatPublisher = redisPublisher(new Redis(config.redis.url, { maxRetriesPerRequest: 1, ...(config.redis.password ? { password: config.redis.password } : {}) }));
const chats = new Worker<ChatJobData | ChatSummaryJobData, ChatResult | ChatSummaryResult>(
  CHAT_QUEUE,
  (job: Job<ChatJobData | ChatSummaryJobData>) => (job.name === CHAT_SUMMARY_JOB ? processChatSummary(job.data as ChatSummaryJobData) : processChatReply(job.data as ChatJobData, chatPublisher)),
  {
    connection,
    concurrency: config.concurrency,
  },
);
chats.on("failed", (job, err) => console.error(`Chat job ${job?.id ?? "?"} failed: ${err.message}`));
chats.on("error", (err) => console.error("Chat worker error:", err.message));

// Settings' model list and Test (docs/api/workspaces.md §2d): the backend
// waits; a failure is the answer, so nothing here retries.
const aiChecks = new Worker<AiCheckJobData, AiCheckResult>(AI_CHECK_QUEUE, (job: Job<AiCheckJobData>) => runAiCheck(job.data), {
  connection,
  concurrency: config.concurrency,
});
aiChecks.on("failed", (job, err) => console.error(`AI check ${job?.id ?? "?"} failed: ${err.message}`));
aiChecks.on("error", (err) => console.error("AI check worker error:", err.message));

// Reminders (docs/api/notifications.md §1b): delayed jobs, sent once due.
// The job name says which: rate later, a cold brew's steep done, a green
// coffee running low, or the quarter-hourly recap and resting-bean ticks.
type ReminderData = RateReminderJobData | SteepReminderJobData | GreenLowJobData | RecapTickJobData | BeanRestTickJobData;
type ReminderOutcome = ReminderResult | RecapTickResult | BeanRestTickResult;
function runReminder(job: Job<ReminderData>): Promise<ReminderOutcome> {
  switch (job.name) {
    case RECAP_TICK_JOB:
      return processRecapTick();
    case STEEP_REMINDER_JOB:
      return processSteepReminder(job.data as SteepReminderJobData);
    case BEAN_REST_TICK_JOB:
      return processBeanRestTick();
    case LEGACY_REST_REMINDER_JOB:
      return Promise.resolve({ status: "skipped", reason: "resting moved to beans" });
    case GREEN_LOW_JOB:
      return processGreenLow(job.data as GreenLowJobData);
    default:
      return processRateReminder(job.data as RateReminderJobData);
  }
}
const reminders = new Worker<ReminderData, ReminderOutcome>(REMINDER_QUEUE, runReminder, {
  connection,
  concurrency: config.concurrency,
});
reminders.on("completed", (job, result) => {
  if (!("status" in result)) {
    const what = job.name === BEAN_REST_TICK_JOB ? "Resting beans" : "Recaps";
    if (result.sent || result.failed) console.log(`${what}: ${result.sent} sent${result.failed ? `, ${result.failed} failed` : ""}`);
    return;
  }
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

publishEnvStatus().catch((err: unknown) => console.error("AI status not saved:", err instanceof Error ? err.message : err));

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, finishing active jobs`);
  // close() waits for running jobs to finish before resolving.
  const results = await Promise.allSettled([worker.close(), suggestions.close(), recapSummaries.close(), previews.close(), labels.close(), beanReviews.close(), chats.close(), aiChecks.close(), reminders.close(), maintenance.close()]);
  results.push(...(await Promise.allSettled([pool.end()])));
  for (const r of results) {
    if (r.status === "rejected") console.error("Error during shutdown:", r.reason);
  }
  connection.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

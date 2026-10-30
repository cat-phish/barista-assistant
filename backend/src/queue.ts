import {
  BREW_ANALYSIS_JOB,
  BREW_ANALYSIS_QUEUE,
  brewAnalysisJobId,
  RATE_REMINDER_JOB,
  rateReminderJobId,
  REMINDER_QUEUE,
  STEEP_REMINDER_JOB,
  steepReminderJobId,
  REST_REMINDER_JOB,
  restReminderJobId,
  GREEN_LOW_JOB,
  type BrewAnalysisJobData,
  type GreenLowJobData,
  type RateReminderJobData,
  type RestReminderJobData,
  type SteepReminderJobData,
  backupCron,
  DB_BACKUP_JOB,
  DB_BACKUP_SCHEDULER,
  MAINTENANCE_QUEUE,
  type DbBackupJobData,
  PARAMETER_SUGGESTION_JOB,
  PARAMETER_SUGGESTION_QUEUE,
  type ParameterSuggestionJobData,
  AI_PREVIEW_JOB,
  AI_PREVIEW_QUEUE,
  type AiPreviewJobData,
  LABEL_READ_JOB,
  LABEL_READ_QUEUE,
  type LabelReadResult,
  type LabelReadJobData,
} from "@barista/shared/jobs";
import type { AiRequest, BackupSettings } from "@barista/shared/schema";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { backupTimezone, config, labelReadTimeoutMs, labelWebTimeoutMs, previewTimeoutMs } from "./config.js";

// Producer side of the brew-analysis queue (docs/api/llm-contract.md §9).
const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: 1,
  ...(config.redis.password ? { password: config.redis.password } : {}),
});

export const brewAnalysisQueue = new Queue<BrewAnalysisJobData>(BREW_ANALYSIS_QUEUE, { connection });

// Without a listener, connection errors (e.g. Redis restarting) are unhandled.
let lastError = "";
brewAnalysisQueue.on("error", (err: Error) => {
  if (err.message !== lastError) console.error("Brew analysis queue error:", err.message);
  lastError = err.message;
});

// Delayed rate-later reminders (docs/api/notifications.md §1b).
// Both kinds of reminder share the queue; the job name says which.
export const reminderQueue = new Queue<ReminderJobData>(REMINDER_QUEUE, { connection });
let lastReminderError = "";
reminderQueue.on("error", (err: Error) => {
  if (err.message !== lastReminderError) console.error("Reminder queue error:", err.message);
  lastReminderError = err.message;
});

export class QueueUnavailableError extends Error {}

// BullMQ waits for Redis to come back rather than failing, which would hang the
// request; give up after a few seconds so the API can answer 503.
const ENQUEUE_TIMEOUT_MS = 3000;

// Runs a queue call, as QueueUnavailableError if Redis doesn't answer in time.
async function withTimeout<T>(work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError("Timed out reaching Redis")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work(), timeout]);
  } catch (err) {
    if (err instanceof QueueUnavailableError) throw err;
    throw new QueueUnavailableError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

// auto: queued by auto-analyze, after delayMs (docs/api/analysis.md §8).
// note: a one-off note from whoever asked (docs/api/auth.md §1c).
export interface AnalysisJobOptions {
  auto?: boolean;
  delayMs?: number;
  note?: string;
}

export function enqueueBrewAnalysis(brewLogId: string, { auto = false, delayMs = 0, note }: AnalysisJobOptions = {}): Promise<string> {
  const data: BrewAnalysisJobData = auto ? { brewLogId, auto: true } : { brewLogId, ...(note ? { note } : {}) };
  const jobId = brewAnalysisJobId(brewLogId);
  return withTimeout(async () => {
    if (!auto) {
      // An automatic analysis still waiting: run it now, as asked for (so
      // the daily cap doesn't apply). It may start meanwhile; then it's
      // simply the job already running.
      const waiting = await brewAnalysisQueue.getJob(jobId);
      if (waiting && (await waiting.isDelayed())) {
        await waiting.updateData(data);
        await waiting.promote().catch(() => undefined);
        return jobId;
      }
    }
    // Same jobId while waiting/active => BullMQ returns the existing job instead of adding one.
    // (One already waiting or running keeps the data it was queued with.)
    const job = await brewAnalysisQueue.add(BREW_ANALYSIS_JOB, data, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
    if (!job.id) throw new Error("BullMQ returned a job without an id");
    return job.id;
  });
}

// A deleted brew's automatic analysis that hasn't started (the worker skips
// deleted brews anyway; this keeps the queue tidy).
export function cancelWaitingAnalysis(brewLogId: string): Promise<void> {
  return withTimeout(async () => {
    const job = await brewAnalysisQueue.getJob(brewAnalysisJobId(brewLogId));
    if (job && (await job.isDelayed())) await job.remove();
  });
}

// "Suggest parameters" (docs/api/analysis.md §8b): one job per request, its
// row already saved as pending. Retried like an analysis.
export const parameterSuggestionQueue = new Queue<ParameterSuggestionJobData>(PARAMETER_SUGGESTION_QUEUE, { connection });
let lastSuggestionError = "";
parameterSuggestionQueue.on("error", (err: Error) => {
  if (err.message !== lastSuggestionError) console.error("Parameter suggestion queue error:", err.message);
  lastSuggestionError = err.message;
});

export async function enqueueParameterSuggestion(suggestionId: string): Promise<void> {
  await withTimeout(() =>
    parameterSuggestionQueue.add(PARAMETER_SUGGESTION_JOB, { suggestionId }, {
      jobId: `suggest-${suggestionId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
    })
  );
}

// Previews (docs/api/analysis.md §8d): the worker builds what would be sent
// and the request waits for it. Finished jobs stay a minute, so the answer
// can still be read if it came before the wait began.
export const aiPreviewQueue = new Queue<AiPreviewJobData, AiRequest | null>(AI_PREVIEW_QUEUE, { connection });
let lastPreviewError = "";
aiPreviewQueue.on("error", (err: Error) => {
  if (err.message !== lastPreviewError) console.error("AI preview queue error:", err.message);
  lastPreviewError = err.message;
});
export class JobTimeoutError extends Error {}

// Waiting for a job's answer needs a blocking connection of its own, and a
// QueueEvents per queue; made on first use.
let waitConnection: Redis | null = null;
const queueEvents = new Map<string, QueueEvents>();
// Adds a job and waits for its return value (finished jobs stay a minute,
// so the answer can still be read if it came before the wait began). A
// timeout removes the job and throws JobTimeoutError; a failed job
// rejects with its reason.
async function addAndWait<D, R>(queue: Queue<D, R>, name: string, data: D, timeoutMs: number): Promise<R> {
  const events = await withTimeout(async () => {
    waitConnection ??= new Redis(config.redis.url, { maxRetriesPerRequest: null, ...(config.redis.password ? { password: config.redis.password } : {}) });
    let e = queueEvents.get(queue.name);
    if (!e) {
      e = new QueueEvents(queue.name, { connection: waitConnection });
      queueEvents.set(queue.name, e);
    }
    await e.waitUntilReady();
    return e;
  });
  // bullmq's name type is generic over the data; this queue only has the one job name.
  const job = await withTimeout(() => queue.add(name as never, data as never, { removeOnComplete: { age: 60 }, removeOnFail: { age: 60 } }));
  try {
    return (await job.waitUntilFinished(events, timeoutMs)) as R;
  } catch (err) {
    if (err instanceof Error && /timed out/i.test(err.message)) {
      await job.remove().catch(() => undefined); // nobody's waiting for it any more
      throw new JobTimeoutError(err.message);
    }
    throw err;
  }
}

export function previewAiRequest(data: AiPreviewJobData): Promise<AiRequest | null> {
  return addAndWait(aiPreviewQueue, AI_PREVIEW_JOB, data, previewTimeoutMs());
}

// Reading a bean label (docs/api/bean-label.md §4d): an AI call, so a longer
// wait; not retried (the person tries again).
export const labelReadQueue = new Queue<LabelReadJobData, LabelReadResult>(LABEL_READ_QUEUE, { connection });
let lastLabelError = "";
labelReadQueue.on("error", (err: Error) => {
  if (err.message !== lastLabelError) console.error("Label queue error:", err.message);
  lastLabelError = err.message;
});
export function readBeanLabel(data: LabelReadJobData): Promise<LabelReadResult> {
  return addAndWait(labelReadQueue, LABEL_READ_JOB, data, data.lookUp ? labelWebTimeoutMs() : labelReadTimeoutMs());
}

// Same timeout as the analysis; the caller treats failure as "no reminder".
export function enqueueRateReminder(data: RateReminderJobData, delayMs: number): Promise<void> {
  return enqueueReminder(RATE_REMINDER_JOB, rateReminderJobId(data.brewLogId), data, delayMs);
}
export function enqueueSteepReminder(data: SteepReminderJobData, delayMs: number): Promise<void> {
  return enqueueReminder(STEEP_REMINDER_JOB, steepReminderJobId(data.brewLogId), data, delayMs);
}

// A roast's rest reminder: replaces one still waiting, so an edited roast
// reminds on its new ready day.
export async function enqueueRestReminder(data: RestReminderJobData, delayMs: number): Promise<void> {
  await cancelRestReminder(data.roastId);
  await enqueueReminder(REST_REMINDER_JOB, restReminderJobId(data.roastId), data, delayMs);
}
// A deleted roast, or one that's no longer resting.
export function cancelRestReminder(roastId: string): Promise<void> {
  return withTimeout(() => removeWaiting(restReminderJobId(roastId)));
}
async function removeWaiting(jobId: string): Promise<void> {
  const job = await reminderQueue.getJob(jobId);
  if (job && (await job.isDelayed())) await job.remove();
}
// Sent right away; each crossing below the threshold is its own job.
export function enqueueGreenLow(data: GreenLowJobData): Promise<void> {
  return enqueueReminder(GREEN_LOW_JOB, undefined, data, 0);
}

type ReminderJobData = RateReminderJobData | SteepReminderJobData | RestReminderJobData | GreenLowJobData;
async function enqueueReminder(name: string, jobId: string | undefined, data: ReminderJobData, delayMs: number): Promise<void> {
  await withTimeout(() =>
    reminderQueue.add(name, data, {
      ...(jobId ? { jobId } : {}),
      delay: delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    })
  );
}

// Scheduled server backups (docs/api/server.md §10): a job scheduler that
// runs the database dump on the admins' schedule, and one-off runs.
export const maintenanceQueue = new Queue<DbBackupJobData>(MAINTENANCE_QUEUE, { connection });
let lastMaintenanceError = "";
maintenanceQueue.on("error", (err: Error) => {
  if (err.message !== lastMaintenanceError) console.error("Maintenance queue error:", err.message);
  lastMaintenanceError = err.message;
});

const BACKUP_JOB_OPTS = { attempts: 2, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: true, removeOnFail: 20 } as const;

// Makes the scheduler match the settings: created or moved, or removed when off.
export async function syncBackupSchedule(settings: BackupSettings): Promise<void> {
  const pattern = backupCron(settings);
  if (!pattern) {
    await maintenanceQueue.removeJobScheduler(DB_BACKUP_SCHEDULER);
    return;
  }
  await maintenanceQueue.upsertJobScheduler(
    DB_BACKUP_SCHEDULER,
    { pattern, tz: backupTimezone() },
    { name: DB_BACKUP_JOB, data: { reason: "schedule" }, opts: BACKUP_JOB_OPTS },
  );
}

// When the next scheduled dump runs, or null when off.
export async function nextBackupAt(): Promise<string | null> {
  const scheduler = await maintenanceQueue.getJobScheduler(DB_BACKUP_SCHEDULER);
  return scheduler?.next ? new Date(scheduler.next).toISOString() : null;
}

export async function enqueueBackupNow(): Promise<void> {
  await maintenanceQueue.add(DB_BACKUP_JOB, { reason: "manual" }, BACKUP_JOB_OPTS);
}

export async function closeQueue(): Promise<void> {
  await Promise.all([brewAnalysisQueue.close(), reminderQueue.close(), maintenanceQueue.close(), parameterSuggestionQueue.close(), aiPreviewQueue.close(), labelReadQueue.close(), ...[...queueEvents.values()].map((e) => e.close())]);
  connection.disconnect();
  waitConnection?.disconnect();
}

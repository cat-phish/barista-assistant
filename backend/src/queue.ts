import {
  BREW_ANALYSIS_JOB,
  BREW_ANALYSIS_QUEUE,
  brewAnalysisJobId,
  RATE_REMINDER_JOB,
  rateReminderJobId,
  REMINDER_QUEUE,
  STEEP_REMINDER_JOB,
  steepReminderJobId,
  type BrewAnalysisJobData,
  type RateReminderJobData,
  type SteepReminderJobData,
  backupCron,
  DB_BACKUP_JOB,
  DB_BACKUP_SCHEDULER,
  MAINTENANCE_QUEUE,
  type DbBackupJobData,
} from "@barista/shared/jobs";
import type { BackupSettings } from "@barista/shared/schema";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { backupTimezone, config } from "./config.js";

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
export const reminderQueue = new Queue<RateReminderJobData | SteepReminderJobData>(REMINDER_QUEUE, { connection });
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
export interface AnalysisJobOptions {
  auto?: boolean;
  delayMs?: number;
}

export function enqueueBrewAnalysis(brewLogId: string, { auto = false, delayMs = 0 }: AnalysisJobOptions = {}): Promise<string> {
  const jobId = brewAnalysisJobId(brewLogId);
  return withTimeout(async () => {
    if (!auto) {
      // An automatic analysis still waiting: run it now, as asked for (so
      // the daily cap doesn't apply). It may start meanwhile; then it's
      // simply the job already running.
      const waiting = await brewAnalysisQueue.getJob(jobId);
      if (waiting && (await waiting.isDelayed())) {
        await waiting.updateData({ brewLogId });
        await waiting.promote().catch(() => undefined);
        return jobId;
      }
    }
    // Same jobId while waiting/active => BullMQ returns the existing job instead of adding one.
    const job = await brewAnalysisQueue.add(BREW_ANALYSIS_JOB, auto ? { brewLogId, auto: true } : { brewLogId }, {
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

// Same timeout as the analysis; the caller treats failure as "no reminder".
export function enqueueRateReminder(data: RateReminderJobData, delayMs: number): Promise<void> {
  return enqueueReminder(RATE_REMINDER_JOB, rateReminderJobId(data.brewLogId), data, delayMs);
}
export function enqueueSteepReminder(data: SteepReminderJobData, delayMs: number): Promise<void> {
  return enqueueReminder(STEEP_REMINDER_JOB, steepReminderJobId(data.brewLogId), data, delayMs);
}

async function enqueueReminder(name: string, jobId: string, data: RateReminderJobData | SteepReminderJobData, delayMs: number): Promise<void> {
  await withTimeout(() =>
    reminderQueue.add(name, data, {
      jobId,
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
  await Promise.all([brewAnalysisQueue.close(), reminderQueue.close(), maintenanceQueue.close()]);
  connection.disconnect();
}

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
} from "@barista/shared/jobs";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";

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

export async function enqueueBrewAnalysis(brewLogId: string): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError("Timed out reaching Redis")), ENQUEUE_TIMEOUT_MS);
  });

  try {
    // Same jobId while waiting/active => BullMQ returns the existing job instead of adding one.
    const job = await Promise.race([
      brewAnalysisQueue.add(
        BREW_ANALYSIS_JOB,
        { brewLogId },
        {
          jobId: brewAnalysisJobId(brewLogId),
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true,
          removeOnFail: true,
        }
      ),
      timeout,
    ]);
    if (!job.id) throw new Error("BullMQ returned a job without an id");
    return job.id;
  } catch (err) {
    if (err instanceof QueueUnavailableError) throw err;
    throw new QueueUnavailableError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

// Same timeout as the analysis; the caller treats failure as "no reminder".
export function enqueueRateReminder(data: RateReminderJobData, delayMs: number): Promise<void> {
  return enqueueReminder(RATE_REMINDER_JOB, rateReminderJobId(data.brewLogId), data, delayMs);
}
export function enqueueSteepReminder(data: SteepReminderJobData, delayMs: number): Promise<void> {
  return enqueueReminder(STEEP_REMINDER_JOB, steepReminderJobId(data.brewLogId), data, delayMs);
}

async function enqueueReminder(name: string, jobId: string, data: RateReminderJobData | SteepReminderJobData, delayMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError("Timed out reaching Redis")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      reminderQueue.add(name, data, {
        jobId,
        delay: delayMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeQueue(): Promise<void> {
  await Promise.all([brewAnalysisQueue.close(), reminderQueue.close()]);
  connection.disconnect();
}

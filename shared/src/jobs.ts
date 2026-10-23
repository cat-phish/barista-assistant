// BullMQ contract between the backend (producer) and the worker (consumer).
// See docs/api/llm-contract.md §9.

export const BREW_ANALYSIS_QUEUE = "brew-analysis";
export const BREW_ANALYSIS_JOB = "analyze";

export interface BrewAnalysisJobData {
  brewLogId: string;
}

// One job per brew log while it's waiting or running, so repeated clicks
// don't queue duplicate LLM calls. BullMQ custom IDs must not contain ":".
export function brewAnalysisJobId(brewLogId: string): string {
  return `analyze-${brewLogId}`;
}

export const GRIND_DELTAS = ["much_finer", "finer", "no_change", "coarser", "much_coarser"] as const;
export type GrindDelta = (typeof GRIND_DELTAS)[number];

// Rate-later reminders (docs/api/notifications.md §1b): a delayed job per
// brew saved with "Rate later". The worker skips it if the brew has been
// rated (or deleted) by then, or the person turned reminders off.
export const REMINDER_QUEUE = "reminders";
export const RATE_REMINDER_JOB = "rate-brew";

export interface RateReminderJobData {
  brewLogId: string;
  userId: string;
}

export function rateReminderJobId(brewLogId: string): string {
  return `rate-${brewLogId}`;
}

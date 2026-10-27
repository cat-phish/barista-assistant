import type { BackupSettings } from "./schema.js";

// BullMQ contract between the backend (producer) and the worker (consumer).
// See docs/api/llm-contract.md §9.

export const BREW_ANALYSIS_QUEUE = "brew-analysis";
export const BREW_ANALYSIS_JOB = "analyze";

export interface BrewAnalysisJobData {
  brewLogId: string;
  // Queued by auto-analyze, not asked for (docs/api/analysis.md §8): skipped
  // if auto-analyze was turned off or the daily cap is reached, and the
  // analysis is marked auto. Absent on older jobs (= asked for).
  auto?: boolean;
}

// One job per brew log while it's waiting or running, so repeated clicks
// don't queue duplicate LLM calls. BullMQ custom IDs must not contain ":".
export function brewAnalysisJobId(brewLogId: string): string {
  return `analyze-${brewLogId}`;
}

// "Suggest parameters" (docs/api/analysis.md §8b): one job per request; the
// row in parameter_suggestions says what to suggest for and holds the result.
export const PARAMETER_SUGGESTION_QUEUE = "parameter-suggestion";
export const PARAMETER_SUGGESTION_JOB = "suggest";

export interface ParameterSuggestionJobData {
  suggestionId: string;
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

// Steep reminders (docs/api/notifications.md §1b): when a cold brew started
// with a steep window reaches its shortest time, on the same queue. Skipped if
// it's been finished or deleted by then.
export const STEEP_REMINDER_JOB = "steep-done";

export interface SteepReminderJobData {
  brewLogId: string;
  userId: string;
}

export function steepReminderJobId(brewLogId: string): string {
  return `steep-${brewLogId}`;
}

// Scheduled server backups (docs/api/server.md §10): a BullMQ job scheduler
// on the maintenance queue runs a whole-database dump on the admins' schedule.
export const MAINTENANCE_QUEUE = "maintenance";
export const DB_BACKUP_JOB = "db-backup";
export const DB_BACKUP_SCHEDULER = "db-backup";

export interface DbBackupJobData {
  reason: "schedule" | "manual";
}

// The cron pattern for the settings ("0 3 * * *" daily at 3, "0 3 * * 0"
// Sundays at 3), or null when backups are off.
export function backupCron(settings: Pick<BackupSettings, "frequency" | "hour" | "weekday">): string | null {
  if (settings.frequency === "off") return null;
  return settings.frequency === "daily" ? `0 ${settings.hour} * * *` : `0 ${settings.hour} * * ${settings.weekday}`;
}

// Dump files: "barista-db-2026-10-24-0300Z.sql.gz" (UTC). Only names that
// match are listed, served or pruned.
export const DB_BACKUP_FILE = /^barista-db-\d{4}-\d{2}-\d{2}-\d{4}Z\.sql\.gz$/;
export function dbBackupFileName(at: Date): string {
  const iso = at.toISOString(); // 2026-10-24T03:00:00.000Z
  return `barista-db-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}Z.sql.gz`;
}

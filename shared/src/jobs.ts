import type { BackupSettings, BlendType, CoffeeSpecies, DetailedRoastLevel, LabelWebContext, ParameterSuggestion, RoastLevel, RoastType } from "./schema.js";

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
  // A one-off note from whoever asked (docs/api/auth.md §1c), added to the
  // prompt; absent on automatic ones.
  note?: string;
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

// Previews (docs/api/analysis.md §8d): what an analysis or a suggestion
// would send, built by the worker without calling the AI. The backend waits
// for the answer (the job's return value, an AiRequest, or null when the
// brew or bean is gone). The suggestion is as POST would save it.
export const AI_PREVIEW_QUEUE = "ai-preview";
export const AI_PREVIEW_JOB = "preview";

export type SuggestionPreview = Pick<
  ParameterSuggestion,
  | "beanId"
  | "recipeId"
  | "brewerId"
  | "grinderId"
  | "source"
  | "maxBrews"
  | "batchDoseGrams"
  | "batchWaterGrams"
  | "batchIceGrams"
  | "batchYieldGrams"
  | "requestedBy"
  | "note"
  | "alternativesAsked"
>;
// note: a one-off note (docs/api/auth.md §1c), as asking would send it.
export type AiPreviewJobData = { kind: "analysis"; brewLogId: string; note?: string } | { kind: "suggest"; suggestion: SuggestionPreview };

// Reading a bean's label from its photos, or looking a bean up on the web
// (docs/api/bean-label.md §4d, llm-contract.md §9c). The backend waits for the
// answer (the job's return value); nothing is stored. images: base64 WebP,
// already resized by the backend; processes: the workspace's visible process
// names to pick from.
export const LABEL_READ_QUEUE = "label-read";
export const LABEL_READ_JOB = "read";
// Photos in one read: the bean's (up to 6) and a couple taken just for it.
export const LABEL_MAX_IMAGES = 8;
export interface LabelReadJobData {
  images: string[];
  processes: string[];
  requestedBy: string; // whose AI prompt is used (docs/api/auth.md §1c)
  // Set (and images []) for a web lookup instead (llm-contract.md §9c, step
  // 2): what's known of the bean, from a label read or the form; only its
  // website's site is searched when it has one.
  lookUp?: LabelFields;
  webContext?: LabelWebContext; // the workspace's labelWebContext; unset = "high"
}
// What the label says, each null when it isn't printed (or can't be read).
export interface LabelFields {
  roasterName: string | null;
  beanName: string | null;
  processName: string | null; // one of the job's processes
  processText: string | null; // the process as printed, when none of them fits
  country: string | null;
  region: string | null;
  producer: string | null;
  altitudeMasl: number | null; // a range gives its middle
  varieties: string[] | null; // as printed, each once; null = none
  species: CoffeeSpecies[] | null;
  flavorProfile: string | null;
  roastDate: string | null; // YYYY-MM-DD; never a best-before date
  detailedRoastLevel: DetailedRoastLevel | null;
  roastLevel: RoastLevel | null; // when only light … dark is printed
  roastType: RoastType | null;
  blendType: BlendType | null;
  decaf: true | null;
  bagWeightGrams: number | null;
  batchNumber: string | null;
  website: string | null;
}

// What a web lookup can add, each with the page it came from. Not the roast
// date or batch number: they belong to one bag.
export const LABEL_WEB_FIELDS = [
  "roasterName",
  "beanName",
  "processName",
  "processText",
  "country",
  "region",
  "producer",
  "altitudeMasl",
  "varieties",
  "species",
  "flavorProfile",
  "detailedRoastLevel",
  "roastLevel",
  "roastType",
  "blendType",
  "decaf",
  "bagWeightGrams",
  "website",
] as const satisfies ReadonlyArray<keyof LabelFields>;
export type LabelWebField = (typeof LABEL_WEB_FIELDS)[number];
export type LabelWebFinds = { [K in LabelWebField]?: { value: NonNullable<LabelFields[K]>; url: string } };
// The job's answer. A label read: what the label says (web null). A web
// lookup: the fields it was given, what the web adds (null when it failed,
// with webError) and the pages it looked at (webSources, [] when it failed).
export interface LabelReadResult {
  fields: LabelFields;
  web: LabelWebFinds | null;
  webSources: string[];
  webError: string | null;
}
// What POST …/bean-label/web answers.
export type LabelWebResult = Pick<LabelReadResult, "web" | "webSources" | "webError">;
// Nothing known: a field each, null.
export const EMPTY_LABEL_FIELDS: LabelFields = {
  roasterName: null,
  beanName: null,
  processName: null,
  processText: null,
  country: null,
  region: null,
  producer: null,
  altitudeMasl: null,
  varieties: null,
  species: null,
  flavorProfile: null,
  roastDate: null,
  detailedRoastLevel: null,
  roastLevel: null,
  roastType: null,
  blendType: null,
  decaf: null,
  bagWeightGrams: null,
  batchNumber: null,
  website: null,
};

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

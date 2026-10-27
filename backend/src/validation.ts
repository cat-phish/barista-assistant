import { z } from "zod";
import { ALTITUDE_UNITS, AUTO_ANALYZE_DELAYS, MAX_AUTO_ANALYZE_DAILY_CAP, MAX_SUGGEST_BREWS, REPEAT_KEEPS, ROAST_LEVELS, ROAST_SCALES, SUGGEST_SOURCES, TEMPERATURE_UNITS, THEMES, VOLUME_UNITS } from "@barista/shared/schema";
import { AI_DETAILS } from "@barista/shared/aiDetails";
import { ROLES } from "./auth/membership.js";

export const roleSchema = z.enum(ROLES);

// Stored slugs always match this, so a param that doesn't can't be a real slug.
// Checking it also stops the case-insensitive collation matching "TEST-BAR" to "test-bar".
export const SLUG_PATTERN = /^[a-z0-9-]{3,64}$/;

// Settings PATCH bodies (docs/api/workspaces.md §2, auth.md §1): any non-empty
// subset of the keys; unknown keys are refused so a typo isn't silently kept.
export const workspaceSettingsObject = z
  .object({
    recipeRoastLevel: z.enum(ROAST_LEVELS),
    roastScale: z.enum(ROAST_SCALES),
    // Field keys are checked by shape, not a list: the registry lives in the
    // frontend (lib/fields.ts), and an unknown key simply hides nothing.
    hiddenFields: z
      .array(z.string().regex(/^(brew|bean|recipe)\.[a-zA-Z]+$/, "a field key like brew.tds"))
      .max(100)
      .refine((keys) => new Set(keys).size === keys.length, "each field once"),
    // What the AI doesn't get (docs/api/llm-contract.md §9); the whole list.
    aiHidden: z
      .array(z.enum(AI_DETAILS))
      .refine((keys) => new Set(keys).size === keys.length, "each detail once"),
    // Auto-analyze (docs/api/analysis.md §8).
    autoAnalyze: z.boolean(),
    autoAnalyzeDelayMinutes: z.literal(AUTO_ANALYZE_DELAYS),
    autoAnalyzeDailyCap: z.number().int().min(1).max(MAX_AUTO_ANALYZE_DAILY_CAP).nullable(),
    // "Suggest parameters" defaults (docs/api/analysis.md §8b).
    suggestSource: z.enum(SUGGEST_SOURCES),
    suggestMaxBrews: z.number().int().min(1).max(MAX_SUGGEST_BREWS),
  })
  .partial()
  .strict();
// A backup (docs/api/backup.md §2b) takes workspaceSettingsObject as stored,
// where {} is fine.
export const workspaceSettingsSchema = workspaceSettingsObject.refine((body) => Object.keys(body).length > 0, "Provide at least one setting");

export const preferencesSchema = z
  .object({
    volumeUnit: z.enum(VOLUME_UNITS),
    showBothVolumes: z.boolean(),
    altitudeUnit: z.enum(ALTITUDE_UNITS),
    temperatureUnit: z.enum(TEMPERATURE_UNITS),
    theme: z.enum(THEMES),
    rateReminders: z.boolean(),
    rateReminderMinutes: z.number().int().min(5).max(240),
    rateLaterDefault: z.boolean(),
    // The whole list (what's on); each once.
    repeatKeeps: z
      .array(z.enum(REPEAT_KEEPS))
      .refine((keys) => new Set(keys).size === keys.length, "each once"),
    steepReminders: z.boolean(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one preference");

export const emailSchema =z.string().trim().toLowerCase().pipe(z.email().max(255));

// A JSON number destined for a DECIMAL(p, scale) column (mode: "number").
// Rejects values with more than `scale` decimals so nothing is silently rounded.
export function decimalSchema(opts: {
  min: number;
  max: number;
  scale: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
}) {
  const { min, max, scale, exclusiveMin = false, exclusiveMax = false } = opts;
  return z
    .number()
    .refine((n) => (exclusiveMin ? n > min : n >= min), `must be ${exclusiveMin ? "greater than" : "at least"} ${min}`)
    .refine((n) => (exclusiveMax ? n < max : n <= max), `must be ${exclusiveMax ? "less than" : "at most"} ${max}`)
    .refine((n) => Number(n.toFixed(scale)) === n, `must have at most ${scale} decimal places`);
}

// A grind setting: the number on the grinder's dial, like its settingMin/Max
// (docs/api/grinders.md §3b).
export const grindSettingSchema = decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMax: true });

// Optional, nullable trimmed string; blank becomes null so "" isn't stored.
// The transform sits inside .optional() on a non-optional schema, so an absent
// key stays undefined (left untouched by an update) instead of becoming null.
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s ? s : null))
    .optional();
}

// For PATCH bodies: reject {} and unknown keys.
export function updateSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");
}

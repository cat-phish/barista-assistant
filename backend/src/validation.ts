import { z } from "zod";
import { BEAN_CARRY_KEYS } from "@barista/shared/beanCarry";
import { CHAT_PERIOD_BREWS_MAX, CHAT_PERIOD_BREWS_MIN } from "@barista/shared/chatPeriod";
import { ALTITUDE_UNITS, AUTO_ANALYZE_DELAYS, LABEL_WEB_CONTEXTS, MAX_AUTO_ANALYZE_DAILY_CAP, MAX_CHAT_ATTACHMENTS, MAX_REST_DAYS, MAX_REVIEW_BREWS, MAX_SUGGEST_BREWS, RECAP_AI_MODES, RECAP_PERIOD_CHOICES, REMEMBER_KEYS, REPEAT_BUTTON_GROUPS, REPEAT_KEEPS, RATING_STEPS, ROAST_LEVELS, ROAST_SCALES, ROAST_TYPES, type RoastType, SUGGEST_ALTERNATIVES, SUGGEST_SOURCES, TEMPERATURE_UNITS, THEMES, VOLUME_UNITS } from "@barista/shared/schema";
import { AI_DETAILS } from "@barista/shared/aiDetails";
import { ROLES } from "./auth/membership.js";

export const roleSchema = z.enum(ROLES);

// Stored slugs always match this, so a param that doesn't can't be a real slug.
// Checking it also stops the case-insensitive collation matching "TEST-BAR" to "test-bar".
export const SLUG_PATTERN = /^[a-z0-9-]{3,64}$/;

// What else Suggest parameters suggests (docs/api/analysis.md §8b), each kind once.
export const alternativeKinds = z
  .array(z.enum(SUGGEST_ALTERNATIVES))
  .refine((kinds) => new Set(kinds).size === kinds.length, "each kind once");

// Settings PATCH bodies (docs/api/workspaces.md §2, auth.md §1): any non-empty
// subset of the keys; unknown keys are refused so a typo isn't silently kept.
const restDay = z.number().int().min(0).max(MAX_REST_DAYS);
const restDayShape = Object.fromEntries(ROAST_TYPES.map((t) => [t, restDay])) as Record<RoastType, typeof restDay>;

export const workspaceSettingsObject = z
  .object({
    recipeRoastLevel: z.enum(ROAST_LEVELS),
    roastScale: z.enum(ROAST_SCALES),
    ratingStep: z.enum(RATING_STEPS),
    // Field keys are checked by shape, not a list: the registry lives in the
    // frontend (lib/fields.ts), and an unknown key simply hides nothing.
    hiddenFields: z
      .array(z.string().regex(/^(brew|bean|recipe|green|roast)\.[a-zA-Z]+$/, "a field key like brew.tds"))
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
    suggestAlternatives: alternativeKinds,
    // "Suggest with AI" on a bean's Review (docs/api/analysis.md §8e).
    beanReviews: z.boolean(),
    beanReviewMaxBrews: z.number().int().min(1).max(MAX_REVIEW_BREWS),
    beanReviewRatedOnly: z.boolean(),
    beanReviewBrewers: z.union([z.literal("all"), z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each brewer once")]),
    aiChat: z.boolean(), // docs/api/chat.md §12
    chatMaxAttachments: z.number().int().min(1).max(MAX_CHAT_ATTACHMENTS),
    chatPeriodMaxBrews: z.number().int().min(CHAT_PERIOD_BREWS_MIN).max(CHAT_PERIOD_BREWS_MAX),
    readLabels: z.boolean(), // docs/api/bean-label.md §4d
    labelWebLookup: z.boolean(),
    labelWebContext: z.enum(LABEL_WEB_CONTEXTS),
    // Home roasting (docs/api/workspaces.md §2).
    homeRoasting: z.boolean(),
    homeRoasterName: z.string().trim().min(1).max(255),
    restDays: z.object(restDayShape).strict(),
    batchAddBeans: z.boolean(), // the Add bean page's batch mode
    beanCarryOver: z
      .array(z.enum(BEAN_CARRY_KEYS))
      .refine((keys) => new Set(keys).size === keys.length, "each field once"),
    // The workspace's time zone; null = the server's BREW_TIMEZONE.
    timeZone: z.string().max(64).refine(isTimeZone, "an IANA time zone, like Europe/London").nullable(),
  })
  .partial()
  .strict();
// A backup (docs/api/backup.md §2b) takes workspaceSettingsObject as stored,
// where {} is fine.
export const workspaceSettingsSchema = workspaceSettingsObject.refine((body) => Object.keys(body).length > 0, "Provide at least one setting");

// "Europe/Paris": a zone this server's Intl knows.
function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

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
    repeatButtonsBy: z.enum(REPEAT_BUTTON_GROUPS),
    rememberSetup: z
      .array(z.enum(REMEMBER_KEYS))
      .refine((keys) => new Set(keys).size === keys.length, "each once"),
    // Whole map of per-method delays; an omitted method has none
    // (docs/api/auth.md §1).
    startDelays: z.object({
      filter: z.literal([0, 3, 5]),
      espresso: z.literal([0, 3, 5]),
      stovetop: z.literal([0, 3, 5]),
      other: z.literal([0, 3, 5]),
    }).partial().strict(),
    steepReminders: z.boolean(),
    restReminders: z.boolean(),
    restReminderRepeatDays: z.number().int().min(1).max(60).nullable(),
    restingInBrewPickerDefault: z.boolean(),
    greenStockAlerts: z.boolean(),
    // Recaps (docs/api/recaps.md §11c).
    recaps: z.boolean(),
    recapPeriods: z.enum(RECAP_PERIOD_CHOICES),
    weekStartsOn: z.number().int().min(0).max(6),
    recapBanner: z.boolean(),
    recapBannerDays: z.number().int().min(1).max(14),
    recapNotify: z.boolean(),
    recapNotifyTime: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "HH:MM in 15-minute steps"),
    timeZone: z.string().max(64).refine(isTimeZone, "an IANA time zone").nullable(),
    recapAi: z.enum(RECAP_AI_MODES),
    recapSeen: z.object({ weekly: localDate, monthly: localDate }).partial().strict(),
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

// A brew's or bean's rating (docs/api/brew-logs.md §6): 0.5-5 in half steps,
// whatever the workspace's ratingStep (that only changes the input).
export const ratingSchema = z
  .number()
  .min(0.5)
  .max(5)
  .refine((n) => Number.isInteger(n * 2), "must be in steps of 0.5");

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

// A note's blocks (docs/api/notes.md §3h): text, and calculators whose
// results are worked out from their inputs by formula. Formulas are only
// checked for length here; the page parses them (frontend/src/lib/calc.ts)
// and shows an error for one it can't work out.
export const MAX_NOTE_TEXT = 20_000; // all its text blocks together
const calcKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, "a key like water or per_litre");
const calcField = { key: calcKey, label: z.string().trim().min(1).max(60), unit: z.string().trim().max(20) };
const blockId = z.string().min(1).max(36);
const textBlock = z.object({ id: blockId, type: z.literal("text"), text: z.string().max(MAX_NOTE_TEXT) }).strict();
const calculatorBlock = z
  .object({
    id: blockId,
    type: z.literal("calculator"),
    title: z.string().trim().max(100),
    inputs: z.array(z.object({ ...calcField, value: z.number().min(-1e9).max(1e9) }).strict()).min(1).max(20),
    results: z.array(z.object({ ...calcField, formula: z.string().trim().min(1).max(300), decimals: z.number().int().min(0).max(6) }).strict()).min(1).max(20),
  })
  .strict();
export const noteBlocksSchema = z
  .array(z.discriminatedUnion("type", [textBlock, calculatorBlock]))
  .max(50)
  .superRefine((blocks, ctx) => {
    if (new Set(blocks.map((b) => b.id)).size !== blocks.length) ctx.addIssue({ code: "custom", message: "each block id once" });
    const text = blocks.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
    if (text > MAX_NOTE_TEXT) ctx.addIssue({ code: "custom", message: `at most ${MAX_NOTE_TEXT} characters of text in all` });
    blocks.forEach((b, i) => {
      if (b.type !== "calculator") return;
      const keys = [...b.inputs, ...b.results].map((f) => f.key.toLowerCase());
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: [i], message: "each key once in a calculator" });
    });
  });

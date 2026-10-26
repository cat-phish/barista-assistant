import type { RecipeStyleSummary } from "./recipes.js";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES, type Role } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, parseQuery, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  beans,
  brewLogMarks,
  brewLogs,
  brewers,
  drinkIngredients,
  drinks,
  grinders,
  waterProfiles,
  prepTools,
  brewLogTools,
  brewProblems,
  brewLogProblems,
  llmAnalyses,
  analysisRequests,
  recipes,
  SERVING_UNITS,
  STEEP_TEMPS,
  DILUTION_WITH,
  users,
  type Bean,
  type BrewLog,
  type LlmAnalysis,
  MARK_KINDS,
  type MarkKind,
  type MethodKind,
  type Recipe,
  recipeStyles,
} from "@barista/shared/schema";
import { decimalSchema, grindSettingSchema, optionalText, updateSchema } from "../validation.js";
import { remindToRate, remindWhenSteeped, type ReminderOutcome } from "../reminders.js";
import { autoAnalyzeOnEdited, autoAnalyzeOnSave } from "../autoAnalyze.js";
import { cancelWaitingAnalysis } from "../queue.js";

// docs/api/brew-logs.md §6: first_drop (espresso), step_end (a step's real end).
export interface Mark {
  kind: MarkKind;
  stepOrder: number | null; // step_end only
  atSec: number;
}

export interface BrewLogDetails extends BrewLog {
  bean: Pick<Bean, "id" | "roasterName" | "beanName" | "batchNumber">;
  // style: the recipe's (docs/api/recipe-styles.md §5e), for how extraction yield is worked out.
  recipe: (Pick<Recipe, "id" | "name" | "expectedYieldGrams"> & { methodKind: MethodKind; style: RecipeStyleSummary | null }) | null;
  grinder: { id: string; name: string } | null; // archived grinders included
  waterProfile: { id: string; name: string } | null; // archived profiles included
  // The brewer it was made with (the recipe's at the time); archived included.
  brewer: { id: string; name: string; kind: MethodKind } | null;
  // The drink it was for; hasIngredients = the shot and the drink are tasted apart.
  drink: { id: string; name: string; hasIngredients: boolean } | null;
  marks: Mark[]; // when things actually happened, earliest first
  tools: Array<{ id: string; name: string; methodKind: MethodKind | null }>; // prep tools used, in checklist order
  problems: Array<{ id: string; name: string; methodKind: MethodKind | null }>; // what went wrong, in checklist order
  // Null when the brewer deleted their account (the log is kept).
  brewedBy: { id: string; email: string } | null;
  // Where its AI suggestion stands (docs/api/analysis.md §8): analyzed at
  // least once; an automatic analysis due then; why the last one failed or
  // was skipped.
  analyzed: boolean;
  analysisDueAt: Date | null;
  analysisError: string | null;
}

export interface BrewLogListResponse {
  brewLogs: BrewLogDetails[];
  total: number;
}

export interface BrewLogResponse {
  brewLog: BrewLogDetails;
}

// POST's reply also says what happened to a requested rate-later reminder
// (docs/api/brew-logs.md §6): queued, off (no enabled channel, or reminders
// switched off) or unavailable (the queue couldn't be reached).
export interface CreatedBrewLogResponse extends BrewLogResponse {
  reminder?: ReminderOutcome;
  // A steeping cold brew with a steep window: the "ready" reminder (§1b).
  steepReminder?: ReminderOutcome;
}

export interface BrewLogWithAnalysisResponse {
  brewLog: BrewLogDetails & { latestAnalysis: LlmAnalysis | null };
}

interface WorkspaceParams {
  workspaceId: string;
}

interface BrewLogParams extends WorkspaceParams {
  brewLogId: string;
}

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_TIME_SEC = 7 * 24 * 60 * 60;

const brewLogFields = {
  beanId: z.uuid(),
  recipeId: z.uuid().nullable().optional(),
  grinderId: z.uuid().nullable().optional(),
  waterProfileId: z.uuid().nullable().optional(),
  // The drink it was for; with a recipe, one of the drink's method (drinkError).
  drinkId: z.uuid().nullable().optional(),
  // The size made, for a drink scaled from its default (sizeError).
  servingSize: decimalSchema({ min: 0, max: 2000, scale: 1, exclusiveMin: true }).nullable().optional(),
  servingUnit: z.enum(SERVING_UNITS).nullable().optional(),
  timestamp: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() <= Date.now() + FUTURE_SKEW_MS, "can't be more than 5 minutes in the future")
    .optional(),
  // The logging device's UTC offset (minutes, -420 = PDT): the worker's local
  // brew date for roast age (docs/api/brew-logs.md §6). UTC-12 to UTC+14.
  utcOffsetMinutes: z.number().int().min(-720).max(840).nullable().optional(),
  actualDoseGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  // Required, except null for espresso (espressoError).
  actualWaterGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  // Flash chilled: ice in the server; null for espresso, and no TDS with it (iceError).
  actualIceGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  // Measured beverage weight (optional, except for espresso; docs/api/brew-logs.md §6).
  actualYieldGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  // Refractometer reading, % (docs/api/brew-logs.md §6). Espresso runs to ~12%.
  tdsPercent: decimalSchema({ min: 0, max: 30, scale: 2, exclusiveMin: true }).nullable().optional(),
  actualTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
  // The number on the grinder's dial (docs/api/brew-logs.md §6).
  actualGrindSetting: grindSettingSchema.nullable().optional(),
  // Grinder speed: only with a variable-speed grinder (rpmError).
  grindRpm: z.number().int().min(50).max(5000).nullable().optional(),
  // Beans weighed in and grounds out, for grinder retention (weightsError).
  beanWeightInGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  groundWeightOutGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  // Up to 7 days: a long cold brew's steep (docs/api/brew-logs.md §6).
  actualTimeSec: z.number().int().min(0).max(MAX_TIME_SEC),
  // Cold styles: started and not finished yet; where it steeped; how it was served.
  steeping: z.boolean().optional(),
  steepTemp: z.enum(STEEP_TEMPS).nullable().optional(),
  dilutionRatio: decimalSchema({ min: 0, max: 10, scale: 1, exclusiveMin: true }).nullable().optional(),
  dilutedWith: z.enum(DILUTION_WITH).nullable().optional(),
  // The coffee tasted on its own (for a milk drink, only if tasted straight).
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tastingNotes: optionalText(5000),
  // The finished drink: only for a brew made for a drink (drinkOnlyError).
  drinkRating: z.number().int().min(1).max(5).nullable().optional(),
  drinkTastingNotes: optionalText(5000),
  // Timer marks: one first_drop (espresso), one step_end per step.
  marks: z
    .array(
      z
        .object({
          kind: z.enum(MARK_KINDS),
          stepOrder: z.number().int().min(1).max(50).nullable().optional(),
          atSec: decimalSchema({ min: 0, max: MAX_TIME_SEC, scale: 1 }),
        })
        .strict()
        .refine((m) => (m.kind === "step_end") === (m.stepOrder != null), "stepOrder is required for step_end and only for it")
    )
    .max(51)
    .refine((list) => new Set(list.map((m) => `${m.kind}:${m.stepOrder ?? ""}`)).size === list.length, "at most one first_drop and one step_end per step")
    .optional(),
  // Prep tools used (docs/api/prep-tools.md §3d); PATCH replaces the list.
  toolIds: z
    .array(z.uuid())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "each tool once")
    .optional(),
  // What went wrong (docs/api/brew-problems.md §6b); PATCH replaces the list.
  problemIds: z
    .array(z.uuid())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "each problem once")
    .optional(),
};

// The window the brew aims for (docs/api/brew-logs.md §6): the recipe's, or
// changed for this brew. Set when it's created and not edited after, so the
// steep reminder queued then stays right. Each pair is both or neither.
const windowFields = {
  steepMinHours: decimalSchema({ min: 0.5, max: 72, scale: 1 }).nullable().optional(),
  steepMaxHours: decimalSchema({ min: 0.5, max: 72, scale: 1 }).nullable().optional(),
  expectedFinishMinSec: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
  expectedFinishMaxSec: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
};
type WindowBody = { [K in keyof typeof windowFields]?: number | null };
function windowPairIssue(body: WindowBody, ctx: z.RefinementCtx): void {
  for (const [min, max] of [
    ["steepMinHours", "steepMaxHours"],
    ["expectedFinishMinSec", "expectedFinishMaxSec"],
  ] as const) {
    const lo = body[min] ?? null;
    const hi = body[max] ?? null;
    if ((lo === null) !== (hi === null)) ctx.addIssue({ code: "custom", path: [lo === null ? min : max], message: `send both ${min} and ${max}, or neither` });
    else if (lo !== null && hi !== null && lo > hi) ctx.addIssue({ code: "custom", path: [max], message: `must not be less than ${min}` });
  }
}

// Strict, like PATCH: the brewer comes from the recipe, so e.g. an old
// client's machineId is refused rather than silently dropped.
// remindToRate: create only, not stored (docs/api/notifications.md §1b).
const createBrewLogSchema = z.object({ ...brewLogFields, ...windowFields, remindToRate: z.boolean().optional() }).strict().superRefine(windowPairIssue);
const updateBrewLogSchema = updateSchema(brewLogFields);

const listQuerySchema = z.object({
  beanId: z.uuid().optional(),
  recipeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Espresso brews record the shot weight instead of water (docs/api/README.md
// §6). kind is the kind of the log's recipe's brewer, or null without a recipe.
function espressoError(
  kind: MethodKind | null,
  log: {
    actualWaterGrams: number | null;
    actualIceGrams: number | null;
    actualYieldGrams: number | null;
    actualTimeSec: number;
    marks: ReadonlyArray<{ kind: MarkKind; atSec: number }>;
  }
): string | null {
  if (log.marks.some((m) => m.atSec > log.actualTimeSec)) return "marks: must be within actualTimeSec";
  if (kind === null && log.marks.some((m) => m.kind === "step_end")) return "marks: step_end needs a recipe";
  if (kind === "espresso") {
    if (log.actualWaterGrams !== null) return "actualWaterGrams: must be null for an espresso brew";
    if (log.actualIceGrams !== null) return "actualIceGrams: must be null for an espresso brew";
    if (log.actualYieldGrams === null) return "actualYieldGrams: is required for an espresso brew (the shot weight)";
    return null;
  }
  if (log.marks.some((m) => m.kind === "first_drop")) return "marks: only espresso brews record a first drop";
  return log.actualWaterGrams === null ? "actualWaterGrams: is required" : null;
}

// A brew made onto ice takes no TDS reading (docs/api/brew-logs.md §6).
function iceError(log: { actualIceGrams?: number | null; tdsPercent?: number | null }): string | null {
  return (log.actualIceGrams ?? null) !== null && (log.tdsPercent ?? null) !== null ? "tdsPercent: not taken for a brew made onto ice (actualIceGrams)" : null;
}

// A size is both its number and unit; it and the drink's tasting are only for
// a brew made for a drink (docs/api/brew-logs.md §6).
function drinkOnlyError(log: {
  drinkId?: string | null;
  servingSize?: number | null;
  servingUnit?: string | null;
  drinkRating?: number | null;
  drinkTastingNotes?: string | null;
}): string | null {
  const hasSize = (log.servingSize ?? null) !== null;
  if (hasSize !== ((log.servingUnit ?? null) !== null)) return "servingSize: servingSize and servingUnit go together";
  if (hasSize && !log.drinkId) return "servingSize: only for a brew made for a drink";
  if (!log.drinkId && ((log.drinkRating ?? null) !== null || (log.drinkTastingNotes ?? null) !== null)) {
    return "drinkRating: the drink's tasting is only for a brew made for a drink";
  }
  return null;
}

// RPM is for a variable-speed grinder, within its range when it has one
// (docs/api/brew-logs.md §6). The range is only checked when the RPM is sent,
// so editing an old brew still works after the range changes.
async function rpmError(tx: Tx, grinderId: string | null, grindRpm: number | null, checkRange: boolean): Promise<string | null> {
  if (grindRpm === null) return null;
  if (!grinderId) return "grindRpm: needs a variable-speed grinder";
  const [grinder] = await tx
    .select({ variableSpeed: grinders.variableSpeed, rpmMin: grinders.rpmMin, rpmMax: grinders.rpmMax })
    .from(grinders)
    .where(eq(grinders.id, grinderId));
  if (!grinder?.variableSpeed) return "grindRpm: needs a variable-speed grinder";
  if (checkRange && grinder.rpmMin !== null && grinder.rpmMax !== null && (grindRpm < grinder.rpmMin || grindRpm > grinder.rpmMax)) {
    return `grindRpm: must be within the grinder's range (${grinder.rpmMin}–${grinder.rpmMax})`;
  }
  return null;
}

// What comes out of the grinder can't weigh more than what went in
// (docs/api/brew-logs.md §6).
function weightsError(log: { beanWeightInGrams?: number | null; groundWeightOutGrams?: number | null }): string | null {
  const into = log.beanWeightInGrams ?? null;
  const out = log.groundWeightOutGrams ?? null;
  return into !== null && out !== null && out > into ? "groundWeightOutGrams: can't be more than beanWeightInGrams" : null;
}

// A brew for a drink uses a recipe on a brewer of the drink's kind, any one of
// them (docs/api/brew-logs.md §6).
async function drinkError(tx: Tx, drinkId: string | null, recipeId: string | null): Promise<string | null> {
  if (!drinkId || !recipeId) return null;
  const [allowed] = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
    .innerJoin(drinks, eq(drinks.kind, brewers.kind))
    .where(and(eq(drinks.id, drinkId), eq(recipes.id, recipeId)));
  return allowed ? null : "recipeId: not a recipe of the drink's kind";
}

// The recipe's brewer and its kind: a log records the brewer it was made with.
async function recipeBrewer(tx: Tx, recipeId: string | null | undefined): Promise<{ brewerId: string; kind: MethodKind } | null> {
  if (!recipeId) return null;
  const [row] = await tx
    .select({ brewerId: brewers.id, kind: brewers.kind })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
    .where(eq(recipes.id, recipeId));
  return row ?? null;
}

// Lock the referenced bean/recipe rows, like recipes do with brewers: a
// concurrent bean or recipe DELETE either finishes first (we see no row -> 400)
// or waits for this insert. Without the bean lock, a log could also slip in after
// a bean DELETE counted logs and get cascade-deleted without confirmation.
async function recipeSteepWindow(tx: Tx, recipeId: string | null | undefined): Promise<{ steepMinHours?: number; steepMaxHours?: number }> {
  if (!recipeId) return {};
  const [r] = await tx.select({ min: recipes.steepMinHours, max: recipes.steepMaxHours }).from(recipes).where(eq(recipes.id, recipeId));
  return r && r.min !== null && r.max !== null ? { steepMinHours: r.min, steepMaxHours: r.max } : {};
}

async function referencesInWorkspace(
  tx: Tx,
  workspaceId: string,
  refs: {
    beanId?: string;
    recipeId?: string | null;
    grinderId?: string | null;
    waterProfileId?: string | null;
    drinkId?: string | null;
    toolIds?: string[];
    problemIds?: string[];
  }
): Promise<string | null> {
  if (refs.drinkId) {
    const [drink] = await tx
      .select({ id: drinks.id })
      .from(drinks)
      .where(and(eq(drinks.id, refs.drinkId), eq(drinks.workspaceId, workspaceId)))
      .for("update");
    if (!drink) return "drinkId: not a drink in this workspace";
  }
  if (refs.beanId) {
    const [bean] = await tx
      .select({ id: beans.id })
      .from(beans)
      .where(and(eq(beans.id, refs.beanId), eq(beans.workspaceId, workspaceId)))
      .for("update");
    if (!bean) return "beanId: not a bean in this workspace";
  }
  if (refs.recipeId) {
    const [recipe] = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, refs.recipeId), eq(recipes.workspaceId, workspaceId)))
      .for("update");
    if (!recipe) return "recipeId: not a recipe in this workspace";
  }
  if (refs.grinderId) {
    // Archived grinders are accepted (docs/api/brew-logs.md §6).
    const [grinder] = await tx
      .select({ id: grinders.id })
      .from(grinders)
      .where(and(eq(grinders.id, refs.grinderId), eq(grinders.workspaceId, workspaceId)))
      .for("update");
    if (!grinder) return "grinderId: not a grinder in this workspace";
  }
  if (refs.toolIds && refs.toolIds.length > 0) {
    // Archived tools are accepted, like grinders; a tool's method isn't checked.
    const found = await tx
      .select({ id: prepTools.id })
      .from(prepTools)
      .where(and(inArray(prepTools.id, refs.toolIds), eq(prepTools.workspaceId, workspaceId)))
      .for("update");
    if (found.length !== refs.toolIds.length) return "toolIds: not all tools in this workspace";
  }
  if (refs.problemIds && refs.problemIds.length > 0) {
    // Archived problems are accepted, like tools; a problem's method isn't checked.
    const found = await tx
      .select({ id: brewProblems.id })
      .from(brewProblems)
      .where(and(inArray(brewProblems.id, refs.problemIds), eq(brewProblems.workspaceId, workspaceId)))
      .for("update");
    if (found.length !== refs.problemIds.length) return "problemIds: not all problems in this workspace";
  }
  if (refs.waterProfileId) {
    // Archived profiles are accepted, like grinders.
    const [profile] = await tx
      .select({ id: waterProfiles.id })
      .from(waterProfiles)
      .where(and(eq(waterProfiles.id, refs.waterProfileId), eq(waterProfiles.workspaceId, workspaceId)))
      .for("update");
    if (!profile) return "waterProfileId: not a water profile in this workspace";
  }
  return null;
}

// The log's own brewer, joined apart from the recipe's (which gives its kind).
const logBrewers = alias(brewers, "log_brewer");

export async function loadBrewLogs(where: SQL | undefined, limit = 1, offset = 0): Promise<BrewLogDetails[]> {
  const rows = await db
    .select({
      id: brewLogs.id,
      workspaceId: brewLogs.workspaceId,
      userId: brewLogs.userId,
      beanId: brewLogs.beanId,
      recipeId: brewLogs.recipeId,
      grinderId: brewLogs.grinderId,
      waterProfileId: brewLogs.waterProfileId,
      brewerId: brewLogs.brewerId,
      drinkId: brewLogs.drinkId,
      servingSize: brewLogs.servingSize,
      servingUnit: brewLogs.servingUnit,
      timestamp: brewLogs.timestamp,
      utcOffsetMinutes: brewLogs.utcOffsetMinutes,
      actualDoseGrams: brewLogs.actualDoseGrams,
      actualWaterGrams: brewLogs.actualWaterGrams,
      actualIceGrams: brewLogs.actualIceGrams,
      actualYieldGrams: brewLogs.actualYieldGrams,
      tdsPercent: brewLogs.tdsPercent,
      actualTempC: brewLogs.actualTempC,
      actualGrindSetting: brewLogs.actualGrindSetting,
      grindRpm: brewLogs.grindRpm,
      beanWeightInGrams: brewLogs.beanWeightInGrams,
      groundWeightOutGrams: brewLogs.groundWeightOutGrams,
      actualTimeSec: brewLogs.actualTimeSec,
      steeping: brewLogs.steeping,
      steepTemp: brewLogs.steepTemp,
      dilutionRatio: brewLogs.dilutionRatio,
      dilutedWith: brewLogs.dilutedWith,
      steepMinHours: brewLogs.steepMinHours,
      steepMaxHours: brewLogs.steepMaxHours,
      expectedFinishMinSec: brewLogs.expectedFinishMinSec,
      expectedFinishMaxSec: brewLogs.expectedFinishMaxSec,
      rating: brewLogs.rating,
      tastingNotes: brewLogs.tastingNotes,
      drinkRating: brewLogs.drinkRating,
      drinkTastingNotes: brewLogs.drinkTastingNotes,
      bean: { id: beans.id, roasterName: beans.roasterName, beanName: beans.beanName, batchNumber: beans.batchNumber },
      recipe: { id: recipes.id, name: recipes.name, expectedYieldGrams: recipes.expectedYieldGrams },
      // Separate columns: a nested object spanning two left joins isn't nulled as a whole.
      recipeMethodKind: brewers.kind,
      styleId: recipeStyles.id,
      styleName: recipeStyles.name,
      styleBrewsLike: recipeStyles.brewsLike,
      grinder: { id: grinders.id, name: grinders.name },
      waterProfile: { id: waterProfiles.id, name: waterProfiles.name },
      brewer: { id: logBrewers.id, name: logBrewers.name, kind: logBrewers.kind },
      drink: { id: drinks.id, name: drinks.name },
      // Separate column, like recipeMethodKind: whether the drink has ingredients.
      drinkHasIngredients: sql<number>`EXISTS (SELECT 1 FROM ${drinkIngredients} di WHERE di.drink_id = ${brewLogs.drinkId})`,
      brewedBy: { id: users.id, email: users.email },
      analyzedFlag: sql<number>`EXISTS (SELECT 1 FROM ${llmAnalyses} la WHERE la.brew_log_id = ${brewLogs.id})`,
      analysisDueAt: analysisRequests.dueAt,
      analysisError: analysisRequests.error,
    })
    .from(brewLogs)
    .innerJoin(beans, eq(brewLogs.beanId, beans.id))
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(brewers, eq(recipes.brewerId, brewers.id))
    .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
    .leftJoin(grinders, eq(brewLogs.grinderId, grinders.id))
    .leftJoin(waterProfiles, eq(brewLogs.waterProfileId, waterProfiles.id))
    .leftJoin(logBrewers, eq(brewLogs.brewerId, logBrewers.id))
    .leftJoin(drinks, eq(brewLogs.drinkId, drinks.id))
    // Left join: logs of deleted accounts (userId null) must still be listed.
    .leftJoin(users, eq(brewLogs.userId, users.id))
    .leftJoin(analysisRequests, eq(analysisRequests.brewLogId, brewLogs.id))
    .where(where)
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
    .limit(limit)
    .offset(offset);
  const ids = rows.map((r) => r.id);
  const [marks, tools, problems] = await Promise.all([marksFor(ids), toolsFor(ids), problemsFor(ids)]);
  // A recipe always has a method (inner FK), so its kind is set whenever recipe is.
  return rows.map(({ recipeMethodKind, styleId, styleName, styleBrewsLike, recipe, drink, drinkHasIngredients, analyzedFlag, ...row }) => ({
    ...row,
    analyzed: Number(analyzedFlag) === 1,
    recipe:
      recipe && recipeMethodKind
        ? { ...recipe, methodKind: recipeMethodKind, style: styleId && styleName && styleBrewsLike ? { id: styleId, name: styleName, brewsLike: styleBrewsLike } : null }
        : null,
    drink: drink ? { ...drink, hasIngredients: Number(drinkHasIngredients) === 1 } : null,
    marks: marks.get(row.id) ?? [],
    tools: tools.get(row.id) ?? [],
    problems: problems.get(row.id) ?? [],
  }));
}

async function toolsFor(brewLogIds: string[]): Promise<Map<string, BrewLogDetails["tools"]>> {
  const byLog = new Map<string, BrewLogDetails["tools"]>();
  if (brewLogIds.length === 0) return byLog;
  const rows = await db
    .select({ brewLogId: brewLogTools.brewLogId, id: prepTools.id, name: prepTools.name, methodKind: prepTools.methodKind })
    .from(brewLogTools)
    .innerJoin(prepTools, eq(brewLogTools.toolId, prepTools.id))
    .where(inArray(brewLogTools.brewLogId, brewLogIds))
    .orderBy(asc(prepTools.position), asc(prepTools.name));
  for (const { brewLogId, ...tool } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), tool]);
  return byLog;
}

async function insertTools(tx: Tx, brewLogId: string, toolIds: readonly string[]): Promise<void> {
  if (toolIds.length === 0) return;
  await tx.insert(brewLogTools).values(toolIds.map((toolId) => ({ brewLogId, toolId })));
}

async function problemsFor(brewLogIds: string[]): Promise<Map<string, BrewLogDetails["problems"]>> {
  const byLog = new Map<string, BrewLogDetails["problems"]>();
  if (brewLogIds.length === 0) return byLog;
  const rows = await db
    .select({ brewLogId: brewLogProblems.brewLogId, id: brewProblems.id, name: brewProblems.name, methodKind: brewProblems.methodKind })
    .from(brewLogProblems)
    .innerJoin(brewProblems, eq(brewLogProblems.problemId, brewProblems.id))
    .where(inArray(brewLogProblems.brewLogId, brewLogIds))
    .orderBy(asc(brewProblems.position), asc(brewProblems.name));
  for (const { brewLogId, ...problem } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), problem]);
  return byLog;
}

async function insertProblems(tx: Tx, brewLogId: string, problemIds: readonly string[]): Promise<void> {
  if (problemIds.length === 0) return;
  await tx.insert(brewLogProblems).values(problemIds.map((problemId) => ({ brewLogId, problemId })));
}

async function marksFor(brewLogIds: string[]): Promise<Map<string, BrewLogDetails["marks"]>> {
  const byLog = new Map<string, BrewLogDetails["marks"]>();
  if (brewLogIds.length === 0) return byLog;
  const rows = await db
    .select({ brewLogId: brewLogMarks.brewLogId, kind: brewLogMarks.kind, stepOrder: brewLogMarks.stepOrder, atSec: brewLogMarks.atSec })
    .from(brewLogMarks)
    .where(inArray(brewLogMarks.brewLogId, brewLogIds))
    .orderBy(asc(brewLogMarks.atSec), asc(brewLogMarks.stepOrder));
  for (const { brewLogId, ...mark } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), mark]);
  return byLog;
}

async function insertMarks(
  tx: Tx,
  brewLogId: string,
  marks: ReadonlyArray<{ kind: MarkKind; stepOrder?: number | null; atSec: number }>
): Promise<void> {
  if (marks.length === 0) return;
  await tx.insert(brewLogMarks).values(marks.map((m) => ({ id: randomUUID(), brewLogId, kind: m.kind, stepOrder: m.stepOrder ?? null, atSec: m.atSec })));
}

function logInWorkspace(params: BrewLogParams): SQL | undefined {
  return and(eq(brewLogs.id, params.brewLogId), eq(brewLogs.workspaceId, params.workspaceId));
}

// Owners can change any log; baristas only their own. Logs of deleted
// accounts (logUserId null) belong to no barista, so only owners can change them.
function canModify(role: Role, callerId: string, logUserId: string | null): boolean {
  return role === "owner" || (role === "barista" && logUserId !== null && callerId === logUserId);
}

// Mounted at /api/workspaces/:workspaceId/brew-logs
export const brewLogsRouter = Router({ mergeParams: true });
brewLogsRouter.use(requireAuth);

brewLogsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<BrewLogListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;

  const query = parseQuery(listQuerySchema, req, res);
  if (!query) return;

  const conditions: SQL[] = [eq(brewLogs.workspaceId, workspaceId)];
  if (query.beanId) conditions.push(eq(brewLogs.beanId, query.beanId));
  if (query.recipeId) conditions.push(eq(brewLogs.recipeId, query.recipeId));
  const where = and(...conditions);

  const [rows, [totals]] = await Promise.all([
    loadBrewLogs(where, query.limit, query.offset),
    db.select({ total: count() }).from(brewLogs).where(where),
  ]);

  res.json({ brewLogs: rows, total: totals?.total ?? 0 });
});

brewLogsRouter.get(
  "/:brewLogId",
  async (req: Request<BrewLogParams>, res: Response<BrewLogWithAnalysisResponse>) => {
    if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId))) return;

    const [brewLog] = await loadBrewLogs(logInWorkspace(req.params));
    if (!brewLog) {
      sendError(res, 404, "Brew log not found");
      return;
    }

    const [latestAnalysis] = await db
      .select()
      .from(llmAnalyses)
      .where(eq(llmAnalyses.brewLogId, brewLog.id))
      .orderBy(desc(llmAnalyses.createdAt), desc(llmAnalyses.id))
      .limit(1);

    res.json({ brewLog: { ...brewLog, latestAnalysis: latestAnalysis ?? null } });
  }
);

brewLogsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<CreatedBrewLogResponse>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;

  const body = parseBody(createBrewLogSchema, req, res);
  if (!body) return;

  const id = randomUUID();
  const refError = await db.transaction(async (tx) => {
    const error = await referencesInWorkspace(tx, workspaceId, body);
    if (error) return error;
    const { marks = [], toolIds = [], problemIds = [], remindToRate: _remind, ...fields } = body;
    const brewer = await recipeBrewer(tx, fields.recipeId);
    const wrongForKind = espressoError(brewer?.kind ?? null, {
      actualWaterGrams: fields.actualWaterGrams ?? null,
      actualIceGrams: fields.actualIceGrams ?? null,
      actualYieldGrams: fields.actualYieldGrams ?? null,
      actualTimeSec: fields.actualTimeSec,
      marks,
    });
    if (wrongForKind) return wrongForKind;
    const wrongForIce = iceError(fields);
    if (wrongForIce) return wrongForIce;
    const wrongForDrink = (await drinkError(tx, fields.drinkId ?? null, fields.recipeId ?? null)) ?? drinkOnlyError(fields);
    if (wrongForDrink) return wrongForDrink;
    const wrongRpm = await rpmError(tx, fields.grinderId ?? null, fields.grindRpm ?? null, true);
    if (wrongRpm) return wrongRpm;
    const wrongWeights = weightsError(fields);
    if (wrongWeights) return wrongWeights;
    // A steep started without a window takes its recipe's (older clients).
    const steepWindow = fields.steeping && fields.steepMinHours === undefined && fields.steepMaxHours === undefined ? await recipeSteepWindow(tx, fields.recipeId) : {};
    await tx.insert(brewLogs).values({ id, workspaceId, userId, ...fields, ...steepWindow, brewerId: brewer?.brewerId ?? null });
    await insertMarks(tx, id, marks);
    await insertTools(tx, id, toolIds);
    await insertProblems(tx, id, problemIds);
    return null;
  });

  if (refError) {
    sendError(res, 400, refError);
    return;
  }

  await autoAnalyzeOnSave({ id, workspaceId, rating: body.rating ?? null, drinkRating: body.drinkRating ?? null, steeping: body.steeping ?? false, analyzed: false });
  const [brewLog] = await loadBrewLogs(eq(brewLogs.id, id));
  if (!brewLog) {
    throw new Error(`Brew log ${id} missing after insert`);
  }
  const reminder = body.remindToRate ? await remindToRate(userId, id) : undefined;
  const steepReminder = body.steeping ? await remindWhenSteeped(userId, id, brewLog.steepMinHours, brewLog.timestamp) : undefined;
  res.status(201).json({ brewLog, ...(reminder ? { reminder } : {}), ...(steepReminder ? { steepReminder } : {}) });
});

brewLogsRouter.patch(
  "/:brewLogId",
  async (req: Request<BrewLogParams>, res: Response<BrewLogResponse>) => {
    const { workspaceId, brewLogId } = req.params;
    const callerId = authedUserId(req);
    const role = await requireMembership(res, callerId, workspaceId, WRITE_ROLES);
    if (!role) return;

    const body = parseBody(updateBrewLogSchema, req, res);
    if (!body) return;

    const outcome = await db.transaction(async (tx) => {
      const [log] = await tx
        .select({
          userId: brewLogs.userId,
          recipeId: brewLogs.recipeId,
          grinderId: brewLogs.grinderId,
          grindRpm: brewLogs.grindRpm,
          beanWeightInGrams: brewLogs.beanWeightInGrams,
          groundWeightOutGrams: brewLogs.groundWeightOutGrams,
          actualWaterGrams: brewLogs.actualWaterGrams,
          actualIceGrams: brewLogs.actualIceGrams,
          actualYieldGrams: brewLogs.actualYieldGrams,
          tdsPercent: brewLogs.tdsPercent,
          drinkId: brewLogs.drinkId,
          servingSize: brewLogs.servingSize,
          servingUnit: brewLogs.servingUnit,
          drinkRating: brewLogs.drinkRating,
          drinkTastingNotes: brewLogs.drinkTastingNotes,
          actualTimeSec: brewLogs.actualTimeSec,
          rating: brewLogs.rating,
          steeping: brewLogs.steeping,
        })
        .from(brewLogs)
        .where(logInWorkspace(req.params))
        .for("update");
      if (!log) return { status: "not_found" } as const;
      if (!canModify(role, callerId, log.userId)) return { status: "forbidden" } as const;

      const error = await referencesInWorkspace(tx, workspaceId, body);
      if (error) return { status: "bad_ref", error } as const;

      // Only when the change touches it, so old logs whose recipe later moved
      // to another brewer can still be edited (docs/api/brew-logs.md §6).
      const { marks, toolIds, problemIds, ...fields } = body;
      // A new recipe brings its brewer; the old brewer stays otherwise.
      const brewerUpdate = "recipeId" in body ? { brewerId: (await recipeBrewer(tx, fields.recipeId))?.brewerId ?? null } : {};
      const touched = ["recipeId", "actualWaterGrams", "actualIceGrams", "actualYieldGrams", "marks", "actualTimeSec"];
      if (touched.some((key) => key in body)) {
        const after = { ...log, ...fields };
        const kind = (await recipeBrewer(tx, after.recipeId))?.kind ?? null;
        const wrongForKind = espressoError(kind, {
          actualWaterGrams: after.actualWaterGrams ?? null,
          actualIceGrams: after.actualIceGrams ?? null,
          actualYieldGrams: after.actualYieldGrams ?? null,
          actualTimeSec: after.actualTimeSec,
          marks:
            marks ??
            (await tx.select({ kind: brewLogMarks.kind, atSec: brewLogMarks.atSec }).from(brewLogMarks).where(eq(brewLogMarks.brewLogId, brewLogId))),
        });
        if (wrongForKind) return { status: "bad_ref", error: wrongForKind } as const;
      }
      if ("actualIceGrams" in body || "tdsPercent" in body) {
        const wrongForIce = iceError({ ...log, ...fields });
        if (wrongForIce) return { status: "bad_ref", error: wrongForIce } as const;
      }

      if ("drinkId" in body || "recipeId" in body) {
        const after = { ...log, ...fields };
        const wrongForDrink = await drinkError(tx, after.drinkId ?? null, after.recipeId ?? null);
        if (wrongForDrink) return { status: "bad_ref", error: wrongForDrink } as const;
      }
      if (["drinkId", "servingSize", "servingUnit", "drinkRating", "drinkTastingNotes"].some((key) => key in body)) {
        const wrongSize = drinkOnlyError({ ...log, ...fields });
        if (wrongSize) return { status: "bad_ref", error: wrongSize } as const;
      }
      // Checked against the log after the change, so a new grinder that isn't
      // variable speed means clearing the RPM too.
      if ("grindRpm" in body || "grinderId" in body) {
        const after = { ...log, ...fields };
        const wrongRpm = await rpmError(tx, after.grinderId ?? null, after.grindRpm ?? null, "grindRpm" in body);
        if (wrongRpm) return { status: "bad_ref", error: wrongRpm } as const;
      }
      if ("beanWeightInGrams" in body || "groundWeightOutGrams" in body) {
        const wrongWeights = weightsError({ ...log, ...fields });
        if (wrongWeights) return { status: "bad_ref", error: wrongWeights } as const;
      }
      if (Object.keys(fields).length > 0) await tx.update(brewLogs).set({ ...fields, ...brewerUpdate }).where(eq(brewLogs.id, brewLogId));
      // A sent list replaces the old one entirely.
      if (marks) {
        await tx.delete(brewLogMarks).where(eq(brewLogMarks.brewLogId, brewLogId));
        await insertMarks(tx, brewLogId, marks);
      }
      if (toolIds) {
        await tx.delete(brewLogTools).where(eq(brewLogTools.brewLogId, brewLogId));
        await insertTools(tx, brewLogId, toolIds);
      }
      if (problemIds) {
        await tx.delete(brewLogProblems).where(eq(brewLogProblems.brewLogId, brewLogId));
        await insertProblems(tx, brewLogId, problemIds);
      }
      return { status: "updated", before: { rating: log.rating, drinkRating: log.drinkRating, steeping: log.steeping } } as const;
    });

    if (outcome.status === "not_found") {
      sendError(res, 404, "Brew log not found");
      return;
    }
    if (outcome.status === "forbidden") {
      sendError(res, 403, "Baristas can only edit their own brew logs");
      return;
    }
    if (outcome.status === "bad_ref") {
      sendError(res, 400, outcome.error);
      return;
    }

    const [brewLog] = await loadBrewLogs(eq(brewLogs.id, brewLogId));
    if (!brewLog) {
      sendError(res, 404, "Brew log not found");
      return;
    }
    // First rated (or finished): auto-analyze picks it up now.
    const dueAt = await autoAnalyzeOnEdited(outcome.before, brewLog);
    res.json({ brewLog: dueAt ? { ...brewLog, analysisDueAt: dueAt, analysisError: null } : brewLog });
  }
);

// Analyses cascade with the log.
brewLogsRouter.delete("/:brewLogId", async (req: Request<BrewLogParams>, res: Response) => {
  const { workspaceId, brewLogId } = req.params;
  const callerId = authedUserId(req);
  const role = await requireMembership(res, callerId, workspaceId, WRITE_ROLES);
  if (!role) return;

  const outcome = await db.transaction(async (tx) => {
    const [log] = await tx
      .select({ userId: brewLogs.userId })
      .from(brewLogs)
      .where(logInWorkspace(req.params))
      .for("update");
    if (!log) return "not_found" as const;
    if (!canModify(role, callerId, log.userId)) return "forbidden" as const;

    await tx.delete(brewLogs).where(eq(brewLogs.id, brewLogId));
    return "deleted" as const;
  });

  if (outcome === "not_found") {
    sendError(res, 404, "Brew log not found");
    return;
  }
  if (outcome === "forbidden") {
    sendError(res, 403, "Baristas can only delete their own brew logs");
    return;
  }
  await cancelWaitingAnalysis(brewLogId).catch(() => undefined); // best effort: the worker skips deleted brews
  res.status(204).end();
});

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
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
  brewMethods,
  drinks,
  grinders,
  llmAnalyses,
  machines,
  recipes,
  SERVING_UNITS,
  users,
  type Bean,
  type BrewLog,
  type LlmAnalysis,
  MARK_KINDS,
  type MarkKind,
  type MethodKind,
  type Recipe,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §6: first_drop (espresso), step_end (a step's real end).
export interface Mark {
  kind: MarkKind;
  stepOrder: number | null; // step_end only
  atSec: number;
}

export interface BrewLogDetails extends BrewLog {
  bean: Pick<Bean, "id" | "roasterName" | "beanName">;
  recipe: (Pick<Recipe, "id" | "name" | "expectedYieldGrams"> & { methodKind: MethodKind }) | null;
  grinder: { id: string; name: string } | null; // retired grinders included
  machine: { id: string; name: string } | null; // espresso only; retired included
  drink: { id: string; name: string } | null; // the drink it was for
  marks: Mark[]; // when things actually happened, earliest first
  // Null when the brewer deleted their account (the log is kept).
  brewer: { id: string; email: string } | null;
}

export interface BrewLogListResponse {
  brewLogs: BrewLogDetails[];
  total: number;
}

export interface BrewLogResponse {
  brewLog: BrewLogDetails;
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

const brewLogFields = {
  beanId: z.uuid(),
  recipeId: z.uuid().nullable().optional(),
  grinderId: z.uuid().nullable().optional(),
  // Espresso brews only (espressoError).
  machineId: z.uuid().nullable().optional(),
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
  actualDoseGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  // Required, except null for espresso (espressoError).
  actualWaterGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  // Measured beverage weight (optional, except for espresso; docs/api_spec.md §6).
  actualYieldGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  actualTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
  actualGrindSetting: optionalText(100),
  actualTimeSec: z.number().int().min(0).max(24 * 60 * 60),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tastingNotes: optionalText(5000),
  // Timer marks: one first_drop (espresso), one step_end per step.
  marks: z
    .array(
      z
        .object({
          kind: z.enum(MARK_KINDS),
          stepOrder: z.number().int().min(1).max(50).nullable().optional(),
          atSec: decimalSchema({ min: 0, max: 24 * 60 * 60, scale: 1 }),
        })
        .strict()
        .refine((m) => (m.kind === "step_end") === (m.stepOrder != null), "stepOrder is required for step_end and only for it")
    )
    .max(51)
    .refine((list) => new Set(list.map((m) => `${m.kind}:${m.stepOrder ?? ""}`)).size === list.length, "at most one first_drop and one step_end per step")
    .optional(),
};

const createBrewLogSchema = z.object(brewLogFields);
const updateBrewLogSchema = updateSchema(brewLogFields);

const listQuerySchema = z.object({
  beanId: z.uuid().optional(),
  recipeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Espresso brews record the shot weight instead of water, and may record a
// machine (docs/api_spec.md §6). kind is the method kind of the log's recipe,
// or null without a recipe.
function espressoError(
  kind: MethodKind | null,
  log: {
    actualWaterGrams: number | null;
    actualYieldGrams: number | null;
    machineId: string | null;
    actualTimeSec: number;
    marks: ReadonlyArray<{ kind: MarkKind; atSec: number }>;
  }
): string | null {
  if (log.marks.some((m) => m.atSec > log.actualTimeSec)) return "marks: must be within actualTimeSec";
  if (kind === null && log.marks.some((m) => m.kind === "step_end")) return "marks: step_end needs a recipe";
  if (kind === "espresso") {
    if (log.actualWaterGrams !== null) return "actualWaterGrams: must be null for an espresso brew";
    if (log.actualYieldGrams === null) return "actualYieldGrams: is required for an espresso brew (the shot weight)";
    return null;
  }
  if (log.machineId !== null) return "machineId: only espresso brews record a machine";
  if (log.marks.some((m) => m.kind === "first_drop")) return "marks: only espresso brews record a first drop";
  return log.actualWaterGrams === null ? "actualWaterGrams: is required" : null;
}

// A size is both its number and unit, and only for a drink (docs/api_spec.md §6).
function sizeError(log: { drinkId?: string | null; servingSize?: number | null; servingUnit?: string | null }): string | null {
  const hasSize = (log.servingSize ?? null) !== null;
  if (hasSize !== ((log.servingUnit ?? null) !== null)) return "servingSize: servingSize and servingUnit go together";
  if (hasSize && !log.drinkId) return "servingSize: only for a brew made for a drink";
  return null;
}

// A brew for a drink uses a recipe of the drink's method (docs/api_spec.md §6).
async function drinkError(tx: Tx, drinkId: string | null, recipeId: string | null): Promise<string | null> {
  if (!drinkId || !recipeId) return null;
  const [allowed] = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .innerJoin(drinks, eq(drinks.methodId, recipes.methodId))
    .where(and(eq(drinks.id, drinkId), eq(recipes.id, recipeId)));
  return allowed ? null : "recipeId: not a recipe of the drink's brew method";
}

async function recipeKind(tx: Tx, recipeId: string): Promise<MethodKind | null> {
  const [row] = await tx
    .select({ kind: brewMethods.kind })
    .from(recipes)
    .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
    .where(eq(recipes.id, recipeId));
  return row?.kind ?? null;
}

// Lock the referenced bean/recipe rows, like recipes do with brew methods: a
// concurrent bean or recipe DELETE either finishes first (we see no row -> 400)
// or waits for this insert. Without the bean lock, a log could also slip in after
// a bean DELETE counted logs and get cascade-deleted without confirmation.
async function referencesInWorkspace(
  tx: Tx,
  workspaceId: string,
  refs: { beanId?: string; recipeId?: string | null; grinderId?: string | null; machineId?: string | null; drinkId?: string | null }
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
    // Retired grinders are accepted (docs/api_spec.md §6).
    const [grinder] = await tx
      .select({ id: grinders.id })
      .from(grinders)
      .where(and(eq(grinders.id, refs.grinderId), eq(grinders.workspaceId, workspaceId)))
      .for("update");
    if (!grinder) return "grinderId: not a grinder in this workspace";
  }
  if (refs.machineId) {
    // Retired machines are accepted, like grinders.
    const [machine] = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.id, refs.machineId), eq(machines.workspaceId, workspaceId)))
      .for("update");
    if (!machine) return "machineId: not a machine in this workspace";
  }
  return null;
}

export async function loadBrewLogs(where: SQL | undefined, limit = 1, offset = 0): Promise<BrewLogDetails[]> {
  const rows = await db
    .select({
      id: brewLogs.id,
      workspaceId: brewLogs.workspaceId,
      userId: brewLogs.userId,
      beanId: brewLogs.beanId,
      recipeId: brewLogs.recipeId,
      grinderId: brewLogs.grinderId,
      machineId: brewLogs.machineId,
      drinkId: brewLogs.drinkId,
      servingSize: brewLogs.servingSize,
      servingUnit: brewLogs.servingUnit,
      timestamp: brewLogs.timestamp,
      actualDoseGrams: brewLogs.actualDoseGrams,
      actualWaterGrams: brewLogs.actualWaterGrams,
      actualYieldGrams: brewLogs.actualYieldGrams,
      actualTempC: brewLogs.actualTempC,
      actualGrindSetting: brewLogs.actualGrindSetting,
      actualTimeSec: brewLogs.actualTimeSec,
      rating: brewLogs.rating,
      tastingNotes: brewLogs.tastingNotes,
      bean: { id: beans.id, roasterName: beans.roasterName, beanName: beans.beanName },
      recipe: { id: recipes.id, name: recipes.name, expectedYieldGrams: recipes.expectedYieldGrams },
      // Separate column: a nested object spanning two left joins isn't nulled as a whole.
      recipeMethodKind: brewMethods.kind,
      grinder: { id: grinders.id, name: grinders.name },
      machine: { id: machines.id, name: machines.name },
      drink: { id: drinks.id, name: drinks.name },
      brewer: { id: users.id, email: users.email },
    })
    .from(brewLogs)
    .innerJoin(beans, eq(brewLogs.beanId, beans.id))
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
    .leftJoin(grinders, eq(brewLogs.grinderId, grinders.id))
    .leftJoin(machines, eq(brewLogs.machineId, machines.id))
    .leftJoin(drinks, eq(brewLogs.drinkId, drinks.id))
    // Left join: logs of deleted accounts (userId null) must still be listed.
    .leftJoin(users, eq(brewLogs.userId, users.id))
    .where(where)
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
    .limit(limit)
    .offset(offset);
  const marks = await marksFor(rows.map((r) => r.id));
  // A recipe always has a method (inner FK), so its kind is set whenever recipe is.
  return rows.map(({ recipeMethodKind, recipe, ...row }) => ({
    ...row,
    recipe: recipe && recipeMethodKind ? { ...recipe, methodKind: recipeMethodKind } : null,
    marks: marks.get(row.id) ?? [],
  }));
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

brewLogsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<BrewLogResponse>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;

  const body = parseBody(createBrewLogSchema, req, res);
  if (!body) return;

  const id = randomUUID();
  const refError = await db.transaction(async (tx) => {
    const error = await referencesInWorkspace(tx, workspaceId, body);
    if (error) return error;
    const { marks = [], ...fields } = body;
    const kind = fields.recipeId ? await recipeKind(tx, fields.recipeId) : null;
    const wrongForKind = espressoError(kind, {
      actualWaterGrams: fields.actualWaterGrams ?? null,
      actualYieldGrams: fields.actualYieldGrams ?? null,
      machineId: fields.machineId ?? null,
      actualTimeSec: fields.actualTimeSec,
      marks,
    });
    if (wrongForKind) return wrongForKind;
    const wrongForDrink = (await drinkError(tx, fields.drinkId ?? null, fields.recipeId ?? null)) ?? sizeError(fields);
    if (wrongForDrink) return wrongForDrink;
    await tx.insert(brewLogs).values({ id, workspaceId, userId, ...fields });
    await insertMarks(tx, id, marks);
    return null;
  });

  if (refError) {
    sendError(res, 400, refError);
    return;
  }

  const [brewLog] = await loadBrewLogs(eq(brewLogs.id, id));
  if (!brewLog) {
    throw new Error(`Brew log ${id} missing after insert`);
  }
  res.status(201).json({ brewLog });
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
          actualWaterGrams: brewLogs.actualWaterGrams,
          actualYieldGrams: brewLogs.actualYieldGrams,
          machineId: brewLogs.machineId,
          drinkId: brewLogs.drinkId,
          servingSize: brewLogs.servingSize,
          servingUnit: brewLogs.servingUnit,
          actualTimeSec: brewLogs.actualTimeSec,
        })
        .from(brewLogs)
        .where(logInWorkspace(req.params))
        .for("update");
      if (!log) return { status: "not_found" } as const;
      if (!canModify(role, callerId, log.userId)) return { status: "forbidden" } as const;

      const error = await referencesInWorkspace(tx, workspaceId, body);
      if (error) return { status: "bad_ref", error } as const;

      // Only when the change touches it, so old logs whose recipe later moved
      // to another method can still be edited (docs/api_spec.md §6).
      const { marks, ...fields } = body;
      const touched = ["recipeId", "actualWaterGrams", "actualYieldGrams", "machineId", "marks", "actualTimeSec"];
      if (touched.some((key) => key in body)) {
        const after = { ...log, ...fields };
        const kind = after.recipeId ? await recipeKind(tx, after.recipeId) : null;
        const wrongForKind = espressoError(kind, {
          actualWaterGrams: after.actualWaterGrams ?? null,
          actualYieldGrams: after.actualYieldGrams ?? null,
          machineId: after.machineId ?? null,
          actualTimeSec: after.actualTimeSec,
          marks:
            marks ??
            (await tx.select({ kind: brewLogMarks.kind, atSec: brewLogMarks.atSec }).from(brewLogMarks).where(eq(brewLogMarks.brewLogId, brewLogId))),
        });
        if (wrongForKind) return { status: "bad_ref", error: wrongForKind } as const;
      }

      if ("drinkId" in body || "recipeId" in body) {
        const after = { ...log, ...fields };
        const wrongForDrink = await drinkError(tx, after.drinkId ?? null, after.recipeId ?? null);
        if (wrongForDrink) return { status: "bad_ref", error: wrongForDrink } as const;
      }
      if ("drinkId" in body || "servingSize" in body || "servingUnit" in body) {
        const wrongSize = sizeError({ ...log, ...fields });
        if (wrongSize) return { status: "bad_ref", error: wrongSize } as const;
      }
      if (Object.keys(fields).length > 0) await tx.update(brewLogs).set(fields).where(eq(brewLogs.id, brewLogId));
      // A sent list replaces the old one entirely.
      if (marks) {
        await tx.delete(brewLogMarks).where(eq(brewLogMarks.brewLogId, brewLogId));
        await insertMarks(tx, brewLogId, marks);
      }
      return { status: "updated" } as const;
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
    res.json({ brewLog });
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
  res.status(204).end();
});

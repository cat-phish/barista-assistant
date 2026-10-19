import { randomUUID } from "node:crypto";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES, type Role } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, parseQuery, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  beans,
  brewLogs,
  llmAnalyses,
  recipes,
  users,
  type Bean,
  type BrewLog,
  type LlmAnalysis,
  type Recipe,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

export interface BrewLogDetails extends BrewLog {
  bean: Pick<Bean, "id" | "roasterName" | "beanName">;
  recipe: Pick<Recipe, "id" | "name"> | null;
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
  timestamp: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() <= Date.now() + FUTURE_SKEW_MS, "can't be more than 5 minutes in the future")
    .optional(),
  actualDoseGrams: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  actualYieldGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
  actualTempC: decimalSchema({ min: 0, max: 100, scale: 1 }).nullable().optional(),
  actualGrindSetting: optionalText(100),
  actualTimeSec: z.number().int().min(0).max(24 * 60 * 60),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tastingNotes: optionalText(5000),
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

// Lock the referenced bean/recipe rows, like recipes do with brew methods: a
// concurrent bean or recipe DELETE either finishes first (we see no row -> 400)
// or waits for this insert. Without the bean lock, a log could also slip in after
// a bean DELETE counted logs and get cascade-deleted without confirmation.
async function referencesInWorkspace(
  tx: Tx,
  workspaceId: string,
  refs: { beanId?: string; recipeId?: string | null }
): Promise<string | null> {
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
  return null;
}

export async function loadBrewLogs(where: SQL | undefined, limit = 1, offset = 0): Promise<BrewLogDetails[]> {
  return db
    .select({
      id: brewLogs.id,
      workspaceId: brewLogs.workspaceId,
      userId: brewLogs.userId,
      beanId: brewLogs.beanId,
      recipeId: brewLogs.recipeId,
      timestamp: brewLogs.timestamp,
      actualDoseGrams: brewLogs.actualDoseGrams,
      actualYieldGrams: brewLogs.actualYieldGrams,
      actualTempC: brewLogs.actualTempC,
      actualGrindSetting: brewLogs.actualGrindSetting,
      actualTimeSec: brewLogs.actualTimeSec,
      rating: brewLogs.rating,
      tastingNotes: brewLogs.tastingNotes,
      bean: { id: beans.id, roasterName: beans.roasterName, beanName: beans.beanName },
      recipe: { id: recipes.id, name: recipes.name },
      brewer: { id: users.id, email: users.email },
    })
    .from(brewLogs)
    .innerJoin(beans, eq(brewLogs.beanId, beans.id))
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    // Left join: logs of deleted accounts (userId null) must still be listed.
    .leftJoin(users, eq(brewLogs.userId, users.id))
    .where(where)
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
    .limit(limit)
    .offset(offset);
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
    await tx.insert(brewLogs).values({ id, workspaceId, userId, ...body });
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
        .select({ userId: brewLogs.userId })
        .from(brewLogs)
        .where(logInWorkspace(req.params))
        .for("update");
      if (!log) return { status: "not_found" } as const;
      if (!canModify(role, callerId, log.userId)) return { status: "forbidden" } as const;

      const error = await referencesInWorkspace(tx, workspaceId, body);
      if (error) return { status: "bad_ref", error } as const;

      await tx.update(brewLogs).set(body).where(eq(brewLogs.id, brewLogId));
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

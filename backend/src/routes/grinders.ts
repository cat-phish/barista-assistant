import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, parseQuery, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewLogs, grinders, type Grinder } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §3b
export type GrinderSummary = Pick<Grinder, "id" | "name" | "notes" | "retiredAt">;

export interface LastSettingResponse {
  lastSetting: { grindSetting: string; timestamp: Date; brewLogId: string } | null;
}

interface WorkspaceParams {
  workspaceId: string;
}
interface GrinderParams extends WorkspaceParams {
  grinderId: string;
}

const grinderFields = {
  name: z.string().trim().min(1).max(100),
  notes: optionalText(255),
};
const createSchema = z.object(grinderFields);
const updateGrinderSchema = updateSchema({ ...grinderFields, retired: z.boolean() });
const lastSettingQuery = z.object({ recipeId: z.uuid() });

const summary = { id: grinders.id, name: grinders.name, notes: grinders.notes, retiredAt: grinders.retiredAt };

function inWorkspace(p: GrinderParams) {
  return and(eq(grinders.id, p.grinderId), eq(grinders.workspaceId, p.workspaceId));
}

// Mounted at /api/workspaces/:workspaceId/grinders
export const grindersRouter = Router({ mergeParams: true });
grindersRouter.use(requireAuth);

grindersRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ grinders: GrinderSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(grinders)
    .where(eq(grinders.workspaceId, workspaceId))
    // Active first, then retired; each by name.
    .orderBy(sql`${grinders.retiredAt} IS NOT NULL`, asc(grinders.name));
  res.json({ grinders: rows });
});

grindersRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ grinder: GrinderSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(grinders).values({ id, workspaceId, name: body.name, notes: body.notes ?? null });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "A grinder with that name already exists");
      return;
    }
    throw err;
  }
  const [grinder] = await db.select(summary).from(grinders).where(eq(grinders.id, id));
  if (!grinder) throw new Error(`Grinder ${id} missing after insert`);
  res.status(201).json({ grinder });
});

grindersRouter.patch("/:grinderId", async (req: Request<GrinderParams>, res: Response<{ grinder: GrinderSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateGrinderSchema, req, res);
  if (!body) return;
  const { retired, ...fields } = body;

  try {
    await db
      .update(grinders)
      .set({
        ...fields,
        // Keep the original retirement date if it's already retired.
        ...(retired === true ? { retiredAt: sql`COALESCE(${grinders.retiredAt}, NOW())` } : {}),
        ...(retired === false ? { retiredAt: null } : {}),
      })
      .where(inWorkspace(req.params));
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "A grinder with that name already exists");
      return;
    }
    throw err;
  }
  const [grinder] = await db.select(summary).from(grinders).where(inWorkspace(req.params));
  if (!grinder) {
    sendError(res, 404, "Grinder not found");
    return;
  }
  res.json({ grinder });
});

// Only unused grinders can be deleted; used ones are retired so history keeps them.
grindersRouter.delete("/:grinderId", async (req: Request<GrinderParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const [grinder] = await tx.select({ id: grinders.id }).from(grinders).where(inWorkspace(req.params)).for("update");
    if (!grinder) return { status: "not_found" } as const;
    const [{ brewLogCount } = { brewLogCount: 0 }] = await tx
      .select({ brewLogCount: count() })
      .from(brewLogs)
      .where(eq(brewLogs.grinderId, grinder.id));
    if (brewLogCount > 0) return { status: "in_use", brewLogCount } as const;
    await tx.delete(grinders).where(eq(grinders.id, grinder.id));
    return { status: "deleted" } as const;
  });

  if (outcome.status === "not_found") {
    sendError(res, 404, "Grinder not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.brewLogCount} brew(s) were made with this grinder. Retire it instead.`, {
      brewLogCount: outcome.brewLogCount,
    });
    return;
  }
  res.status(204).end();
});

grindersRouter.get(
  "/:grinderId/last-setting",
  async (req: Request<GrinderParams>, res: Response<LastSettingResponse>) => {
    const { workspaceId, grinderId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
    const query = parseQuery(lastSettingQuery, req, res);
    if (!query) return;

    const [grinder] = await db.select({ id: grinders.id }).from(grinders).where(inWorkspace(req.params));
    if (!grinder) {
      sendError(res, 404, "Grinder not found");
      return;
    }
    const [last] = await db
      .select({ grindSetting: brewLogs.actualGrindSetting, timestamp: brewLogs.timestamp, brewLogId: brewLogs.id })
      .from(brewLogs)
      .where(
        and(
          eq(brewLogs.workspaceId, workspaceId),
          eq(brewLogs.grinderId, grinderId),
          eq(brewLogs.recipeId, query.recipeId),
          isNotNull(brewLogs.actualGrindSetting)
        )
      )
      .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
      .limit(1);

    res.json({ lastSetting: last?.grindSetting ? { ...last, grindSetting: last.grindSetting } : null });
  }
);

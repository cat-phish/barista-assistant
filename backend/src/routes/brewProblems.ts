import { randomUUID } from "node:crypto";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, brewProblemUsage } from "../usage.js";
import { METHOD_KINDS, brewProblems, type BrewProblem } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

// docs/api/brew-problems.md §6b
export type BrewProblemSummary = Omit<BrewProblem, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface ProblemParams extends WorkspaceParams {
  problemId: string;
}

const problemFields = {
  name: z.string().trim().min(1).max(100),
  methodKind: z.enum(METHOD_KINDS).nullable().optional(), // null = every method
};
const createSchema = z.object(problemFields).strict();
const updateProblemSchema = updateSchema({ ...problemFields, archived: z.boolean() });
const orderSchema = z
  .object({ problemIds: z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each problem once") })
  .strict();

const summary = {
  id: brewProblems.id,
  name: brewProblems.name,
  methodKind: brewProblems.methodKind,
  position: brewProblems.position,
  archivedAt: brewProblems.archivedAt,
  createdAt: brewProblems.createdAt,
};

function inWorkspace(p: ProblemParams) {
  return and(eq(brewProblems.id, p.problemId), eq(brewProblems.workspaceId, p.workspaceId));
}

function listProblems(workspaceId: string): Promise<BrewProblemSummary[]> {
  return db
    .select(summary)
    .from(brewProblems)
    .where(eq(brewProblems.workspaceId, workspaceId))
    .orderBy(asc(brewProblems.position), asc(brewProblems.name));
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A problem with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/brew-problems
export const brewProblemsRouter = Router({ mergeParams: true });
brewProblemsRouter.use(requireAuth);
addUsageRoute(brewProblemsRouter, "problemId", "brewProblems", brewProblemUsage, "Problem not found");

// In checklist order, archived ones included (flagged by archivedAt).
brewProblemsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ problems: BrewProblemSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ problems: await listProblems(workspaceId) });
});

// New problems go last.
brewProblemsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ problem: BrewProblemSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      // Lock the workspace's problems so two creates don't take the same position.
      await tx.select({ id: brewProblems.id }).from(brewProblems).where(eq(brewProblems.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(brewProblems.position) })
        .from(brewProblems)
        .where(eq(brewProblems.workspaceId, workspaceId));
      await tx.insert(brewProblems).values({ id, workspaceId, name: body.name, methodKind: body.methodKind ?? null, position: (last ?? 0) + 1 });
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [problem] = await db.select(summary).from(brewProblems).where(eq(brewProblems.id, id));
  if (!problem) throw new Error(`Brew problem ${id} missing after insert`);
  res.status(201).json({ problem });
});

// Every problem of the workspace (archived ones too), once each, in the new order.
brewProblemsRouter.put("/order", async (req: Request<WorkspaceParams>, res: Response<{ problems: BrewProblemSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: brewProblems.id }).from(brewProblems).where(eq(brewProblems.workspaceId, workspaceId)).for("update");
    const ids = new Set(existing.map((p) => p.id));
    if (existing.length !== body.problemIds.length || !body.problemIds.every((id) => ids.has(id))) return false;
    for (const [i, id] of body.problemIds.entries()) {
      await tx.update(brewProblems).set({ position: i + 1 }).where(eq(brewProblems.id, id));
    }
    return true;
  });
  if (!ok) {
    sendError(res, 400, "problemIds: must list every problem of this workspace exactly once");
    return;
  }
  res.json({ problems: await listProblems(workspaceId) });
});

brewProblemsRouter.patch("/:problemId", async (req: Request<ProblemParams>, res: Response<{ problem: BrewProblemSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateProblemSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;
  try {
    await db
      .update(brewProblems)
      .set({
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${brewProblems.archivedAt}, NOW())` } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      })
      .where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [problem] = await db.select(summary).from(brewProblems).where(inWorkspace(req.params));
  if (!problem) {
    sendError(res, 404, "Problem not found");
    return;
  }
  res.json({ problem });
});

// Deleting unlinks what used it; GET /usage says what, for the warning
// (docs/api/README.md, "Deleting"). Brews keep their record without the problem.
brewProblemsRouter.delete("/:problemId", async (req: Request<ProblemParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(brewProblems).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Problem not found");
    return;
  }
  res.status(204).end();
});

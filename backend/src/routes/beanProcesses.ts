import { randomUUID } from "node:crypto";
import { and, asc, eq, max } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, beanProcessUsage } from "../usage.js";
import { beanProcesses, DEFAULT_BEAN_PROCESSES, type BeanProcessRow } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

// docs/api/bean-processes.md §4b: the workspace's list of bean processes,
// seeded with the built-ins. Built-ins can be renamed and hidden but not
// deleted; custom ones can be deleted (their beans lose the process).
export type BeanProcessSummary = Omit<BeanProcessRow, "workspaceId" | "createdAt">;

interface WorkspaceParams {
  workspaceId: string;
}
interface ProcessParams extends WorkspaceParams {
  processId: string;
}

const name = z.string().trim().min(1).max(100);
const createSchema = z.object({ name }).strict();
const patchSchema = updateSchema({ name, hidden: z.boolean() });
const orderSchema = z
  .object({ processIds: z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each process once") })
  .strict();

const summary = {
  id: beanProcesses.id,
  name: beanProcesses.name,
  position: beanProcesses.position,
  hidden: beanProcesses.hidden,
  builtin: beanProcesses.builtin,
};

const inWorkspace = (p: ProcessParams) => and(eq(beanProcesses.id, p.processId), eq(beanProcesses.workspaceId, p.workspaceId));

function listProcesses(workspaceId: string): Promise<BeanProcessSummary[]> {
  return db.select(summary).from(beanProcesses).where(eq(beanProcesses.workspaceId, workspaceId)).orderBy(asc(beanProcesses.position), asc(beanProcesses.name));
}

// A new workspace's built-ins (workspaces.ts, in its create transaction).
export function defaultProcessRows(workspaceId: string) {
  return DEFAULT_BEAN_PROCESSES.map(({ builtin, name }, i) => ({ id: randomUUID(), workspaceId, name, builtin, position: i + 1 }));
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A process with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/bean-processes
export const beanProcessesRouter = Router({ mergeParams: true });
beanProcessesRouter.use(requireAuth);

// All of them, hidden ones included (the bean form leaves hidden ones out).
beanProcessesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ processes: BeanProcessSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ processes: await listProcesses(workspaceId) });
});

// New processes go last.
beanProcessesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ process: BeanProcessSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  let created: BeanProcessSummary;
  try {
    created = await db.transaction(async (tx) => {
      // Lock the list so two creates don't take the same position.
      await tx.select({ id: beanProcesses.id }).from(beanProcesses).where(eq(beanProcesses.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(beanProcesses.position) })
        .from(beanProcesses)
        .where(eq(beanProcesses.workspaceId, workspaceId));
      const row = { id: randomUUID(), name: body.name, position: (last ?? 0) + 1, hidden: false, builtin: null };
      await tx.insert(beanProcesses).values({ ...row, workspaceId });
      return row;
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  res.status(201).json({ process: created });
});

// Every process of the workspace, once each, in the new order.
beanProcessesRouter.put("/order", async (req: Request<WorkspaceParams>, res: Response<{ processes: BeanProcessSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: beanProcesses.id }).from(beanProcesses).where(eq(beanProcesses.workspaceId, workspaceId)).for("update");
    const ids = new Set(existing.map((p) => p.id));
    if (existing.length !== body.processIds.length || !body.processIds.every((id) => ids.has(id))) return false;
    for (const [i, id] of body.processIds.entries()) {
      await tx.update(beanProcesses).set({ position: i + 1 }).where(eq(beanProcesses.id, id));
    }
    return true;
  });
  if (!ok) {
    sendError(res, 400, "processIds: must list every process of this workspace exactly once");
    return;
  }
  res.json({ processes: await listProcesses(workspaceId) });
});

// Rename or hide/show. A renamed built-in keeps its builtin key.
beanProcessesRouter.patch("/:processId", async (req: Request<ProcessParams>, res: Response<{ process: BeanProcessSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(patchSchema, req, res);
  if (!body) return;
  try {
    await db.update(beanProcesses).set(body).where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [process] = await db.select(summary).from(beanProcesses).where(inWorkspace(req.params));
  if (!process) {
    sendError(res, 404, "Process not found");
    return;
  }
  res.json({ process });
});

addUsageRoute(beanProcessesRouter, "processId", "beanProcesses", beanProcessUsage, "Process not found");

// Custom processes only; their beans lose the process (FK set null). A
// built-in is hidden instead (409).
beanProcessesRouter.delete("/:processId", async (req: Request<ProcessParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [process] = await db.select({ builtin: beanProcesses.builtin }).from(beanProcesses).where(inWorkspace(req.params));
  if (!process) {
    sendError(res, 404, "Process not found");
    return;
  }
  if (process.builtin) {
    sendError(res, 409, "Built-in processes can't be deleted; hide it instead");
    return;
  }
  await db.delete(beanProcesses).where(inWorkspace(req.params));
  res.status(204).end();
});

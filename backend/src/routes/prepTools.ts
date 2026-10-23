import { randomUUID } from "node:crypto";
import { and, asc, count, eq, max, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewLogTools, METHOD_KINDS, prepTools, type PrepTool } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

// docs/api/prep-tools.md §3d
export type PrepToolSummary = Omit<PrepTool, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface ToolParams extends WorkspaceParams {
  toolId: string;
}

const toolFields = {
  name: z.string().trim().min(1).max(100),
  methodKind: z.enum(METHOD_KINDS).nullable().optional(), // null = every method
};
const createSchema = z.object(toolFields).strict();
const updateToolSchema = updateSchema({ ...toolFields, retired: z.boolean() });
const orderSchema = z
  .object({ toolIds: z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each tool once") })
  .strict();

const summary = {
  id: prepTools.id,
  name: prepTools.name,
  methodKind: prepTools.methodKind,
  position: prepTools.position,
  retiredAt: prepTools.retiredAt,
  createdAt: prepTools.createdAt,
};

function inWorkspace(p: ToolParams) {
  return and(eq(prepTools.id, p.toolId), eq(prepTools.workspaceId, p.workspaceId));
}

function listTools(workspaceId: string): Promise<PrepToolSummary[]> {
  return db
    .select(summary)
    .from(prepTools)
    .where(eq(prepTools.workspaceId, workspaceId))
    .orderBy(asc(prepTools.position), asc(prepTools.name));
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A tool with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/prep-tools
export const prepToolsRouter = Router({ mergeParams: true });
prepToolsRouter.use(requireAuth);

// In checklist order, retired ones included (flagged by retiredAt).
prepToolsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ tools: PrepToolSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ tools: await listTools(workspaceId) });
});

// New tools go last.
prepToolsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ tool: PrepToolSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      // Lock the workspace's tools so two creates don't take the same position.
      await tx.select({ id: prepTools.id }).from(prepTools).where(eq(prepTools.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(prepTools.position) })
        .from(prepTools)
        .where(eq(prepTools.workspaceId, workspaceId));
      await tx.insert(prepTools).values({ id, workspaceId, name: body.name, methodKind: body.methodKind ?? null, position: (last ?? 0) + 1 });
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [tool] = await db.select(summary).from(prepTools).where(eq(prepTools.id, id));
  if (!tool) throw new Error(`Prep tool ${id} missing after insert`);
  res.status(201).json({ tool });
});

// Every tool of the workspace (retired ones too), once each, in the new order.
prepToolsRouter.put("/order", async (req: Request<WorkspaceParams>, res: Response<{ tools: PrepToolSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: prepTools.id }).from(prepTools).where(eq(prepTools.workspaceId, workspaceId)).for("update");
    const ids = new Set(existing.map((t) => t.id));
    if (existing.length !== body.toolIds.length || !body.toolIds.every((id) => ids.has(id))) return false;
    for (const [i, id] of body.toolIds.entries()) {
      await tx.update(prepTools).set({ position: i + 1 }).where(eq(prepTools.id, id));
    }
    return true;
  });
  if (!ok) {
    sendError(res, 400, "toolIds: must list every tool of this workspace exactly once");
    return;
  }
  res.json({ tools: await listTools(workspaceId) });
});

prepToolsRouter.patch("/:toolId", async (req: Request<ToolParams>, res: Response<{ tool: PrepToolSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateToolSchema, req, res);
  if (!body) return;
  const { retired, ...fields } = body;
  try {
    await db
      .update(prepTools)
      .set({
        ...fields,
        // Keep the original retirement date if it's already retired.
        ...(retired === true ? { retiredAt: sql`COALESCE(${prepTools.retiredAt}, NOW())` } : {}),
        ...(retired === false ? { retiredAt: null } : {}),
      })
      .where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [tool] = await db.select(summary).from(prepTools).where(inWorkspace(req.params));
  if (!tool) {
    sendError(res, 404, "Tool not found");
    return;
  }
  res.json({ tool });
});

// Only unused tools can be deleted; used ones are retired so history keeps them.
prepToolsRouter.delete("/:toolId", async (req: Request<ToolParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const [tool] = await tx.select({ id: prepTools.id }).from(prepTools).where(inWorkspace(req.params)).for("update");
    if (!tool) return { status: "not_found" } as const;
    const [{ brewLogCount } = { brewLogCount: 0 }] = await tx
      .select({ brewLogCount: count() })
      .from(brewLogTools)
      .where(eq(brewLogTools.toolId, tool.id));
    if (brewLogCount > 0) return { status: "in_use", brewLogCount } as const;
    await tx.delete(prepTools).where(eq(prepTools.id, tool.id));
    return { status: "deleted" } as const;
  });
  if (outcome.status === "not_found") {
    sendError(res, 404, "Tool not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.brewLogCount} brew(s) used this tool. Retire it instead.`, { brewLogCount: outcome.brewLogCount });
    return;
  }
  res.status(204).end();
});

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, prepToolUsage } from "../usage.js";
import { brewers, METHOD_KINDS, prepToolBrewers, prepTools, type PrepTool } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

// docs/api/prep-tools.md §3d
// Offered for its methodKinds and brewerIds; both empty = every brew.
export type PrepToolSummary = Omit<PrepTool, "workspaceId"> & { brewerIds: string[] };

interface WorkspaceParams {
  workspaceId: string;
}
interface ToolParams extends WorkspaceParams {
  toolId: string;
}

const eachOnce = <T>(list: T[]) => new Set(list).size === list.length;
const toolFields = {
  name: z.string().trim().min(1).max(100),
  // Where it's offered; both empty = every brew. Each replaces its whole list.
  methodKinds: z.array(z.enum(METHOD_KINDS)).refine(eachOnce, "each method once"),
  brewerIds: z.array(z.uuid()).max(100).refine(eachOnce, "each brewer once"),
};
const createSchema = z.object({ ...toolFields, methodKinds: toolFields.methodKinds.optional(), brewerIds: toolFields.brewerIds.optional() }).strict();
const updateToolSchema = updateSchema({ ...toolFields, archived: z.boolean() });
const orderSchema = z
  .object({ toolIds: z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each tool once") })
  .strict();

const summary = {
  id: prepTools.id,
  name: prepTools.name,
  methodKinds: prepTools.methodKinds,
  position: prepTools.position,
  archivedAt: prepTools.archivedAt,
  createdAt: prepTools.createdAt,
};

function inWorkspace(p: ToolParams) {
  return and(eq(prepTools.id, p.toolId), eq(prepTools.workspaceId, p.workspaceId));
}

// The tools (one, or the whole workspace's in checklist order) with their brewers.
async function withBrewers(tools: Omit<PrepToolSummary, "brewerIds">[]): Promise<PrepToolSummary[]> {
  const ids = tools.map((t) => t.id);
  const links = ids.length
    ? await db.select().from(prepToolBrewers).where(inArray(prepToolBrewers.prepToolId, ids)).orderBy(asc(prepToolBrewers.brewerId))
    : [];
  return tools.map((t) => ({ ...t, brewerIds: links.filter((l) => l.prepToolId === t.id).map((l) => l.brewerId) }));
}
async function listTools(workspaceId: string): Promise<PrepToolSummary[]> {
  return withBrewers(
    await db.select(summary).from(prepTools).where(eq(prepTools.workspaceId, workspaceId)).orderBy(asc(prepTools.position), asc(prepTools.name)),
  );
}
async function getTool(p: ToolParams): Promise<PrepToolSummary | null> {
  return (await withBrewers(await db.select(summary).from(prepTools).where(inWorkspace(p))))[0] ?? null;
}
// Brewers must be this workspace's (archived ones too: a tool can keep them).
async function brewersInWorkspace(res: Response, workspaceId: string, ids: string[] | undefined): Promise<boolean> {
  if (!ids?.length) return true;
  const found = await db.select({ id: brewers.id }).from(brewers).where(and(eq(brewers.workspaceId, workspaceId), inArray(brewers.id, ids)));
  if (found.length === ids.length) return true;
  sendError(res, 400, "brewerIds: must be brewers of this workspace");
  return false;
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A tool with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/prep-tools
export const prepToolsRouter = Router({ mergeParams: true });
prepToolsRouter.use(requireAuth);
addUsageRoute(prepToolsRouter, "toolId", "prepTools", prepToolUsage, "Tool not found");

// In checklist order, archived ones included (flagged by archivedAt).
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
  if (!body || !(await brewersInWorkspace(res, workspaceId, body.brewerIds))) return;
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      // Lock the workspace's tools so two creates don't take the same position.
      await tx.select({ id: prepTools.id }).from(prepTools).where(eq(prepTools.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(prepTools.position) })
        .from(prepTools)
        .where(eq(prepTools.workspaceId, workspaceId));
      await tx.insert(prepTools).values({ id, workspaceId, name: body.name, methodKinds: body.methodKinds ?? [], position: (last ?? 0) + 1 });
      if (body.brewerIds?.length) await tx.insert(prepToolBrewers).values(body.brewerIds.map((brewerId) => ({ prepToolId: id, brewerId })));
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const tool = await getTool({ workspaceId, toolId: id });
  if (!tool) throw new Error(`Prep tool ${id} missing after insert`);
  res.status(201).json({ tool });
});

// Every tool of the workspace (archived ones too), once each, in the new order.
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
  if (!body || !(await brewersInWorkspace(res, req.params.workspaceId, body.brewerIds))) return;
  const { archived, brewerIds, ...fields } = body;
  try {
    await db.transaction(async (tx) => {
      const set = {
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${prepTools.archivedAt}, NOW())` } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      };
      // Only brewerIds sent: nothing to set on the tool itself.
      const found = Object.keys(set).length
        ? (await tx.update(prepTools).set(set).where(inWorkspace(req.params)))[0].affectedRows > 0
        : (await tx.select({ id: prepTools.id }).from(prepTools).where(inWorkspace(req.params))).length > 0;
      if (!found || !brewerIds) return; // 404 below
      await tx.delete(prepToolBrewers).where(eq(prepToolBrewers.prepToolId, req.params.toolId));
      if (brewerIds.length) await tx.insert(prepToolBrewers).values(brewerIds.map((brewerId) => ({ prepToolId: req.params.toolId, brewerId })));
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const tool = await getTool(req.params);
  if (!tool) {
    sendError(res, 404, "Tool not found");
    return;
  }
  res.json({ tool });
});

// Deleting unlinks what used it; GET /usage says what, for the warning
// (docs/api/README.md, "Deleting"). Brews keep their record without the tool.
prepToolsRouter.delete("/:toolId", async (req: Request<ToolParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(prepTools).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Tool not found");
    return;
  }
  res.status(204).end();
});

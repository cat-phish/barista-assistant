import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, brewerMethodUsage } from "../usage.js";
import { brewerMethods, brewers, METHOD_KINDS, METHOD_NAMES, recipes, type BrewerMethodRow } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

// docs/api/brewer-methods.md §3e: how the workspace groups its brewers,
// seeded with the built-in methods. A custom method ("Siphon") behaves like a
// built-in one, and its brewers' kind is that behaviour. Built-ins can be
// renamed and hidden but not deleted; deleting a custom method moves its
// brewers to the built-in method of the same behaviour.
export type BrewerMethodItem = Omit<BrewerMethodRow, "workspaceId" | "createdAt">;

interface WorkspaceParams {
  workspaceId: string;
}
interface MethodParams extends WorkspaceParams {
  methodId: string;
}

const name = z.string().trim().min(1).max(100);
const createSchema = z.object({ name, behaviour: z.enum(METHOD_KINDS) }).strict();
const patchSchema = updateSchema({ name, hidden: z.boolean(), behaviour: z.enum(METHOD_KINDS) });
const orderSchema = z
  .object({ methodIds: z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each method once") })
  .strict();

const columns = {
  id: brewerMethods.id,
  name: brewerMethods.name,
  position: brewerMethods.position,
  hidden: brewerMethods.hidden,
  builtin: brewerMethods.builtin,
  behaviour: brewerMethods.behaviour,
};
const inWorkspace = (p: MethodParams) => and(eq(brewerMethods.id, p.methodId), eq(brewerMethods.workspaceId, p.workspaceId));

function listMethods(workspaceId: string): Promise<BrewerMethodItem[]> {
  return db.select(columns).from(brewerMethods).where(eq(brewerMethods.workspaceId, workspaceId)).orderBy(asc(brewerMethods.position), asc(brewerMethods.name));
}

// A new workspace's built-ins (workspaces.ts, before its default brewers).
export function defaultMethodRows(workspaceId: string) {
  return METHOD_KINDS.map((kind, i) => ({ id: randomUUID(), workspaceId, name: METHOD_NAMES[kind], position: i + 1, builtin: kind, behaviour: kind }));
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A method with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/brewer-methods
export const brewerMethodsRouter = Router({ mergeParams: true });
brewerMethodsRouter.use(requireAuth);

// All of them, hidden ones included (the brewer form leaves hidden ones out).
brewerMethodsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ methods: BrewerMethodItem[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ methods: await listMethods(workspaceId) });
});

// New methods go last.
brewerMethodsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ method: BrewerMethodItem }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  let created: BrewerMethodItem;
  try {
    created = await db.transaction(async (tx) => {
      await tx.select({ id: brewerMethods.id }).from(brewerMethods).where(eq(brewerMethods.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx.select({ last: max(brewerMethods.position) }).from(brewerMethods).where(eq(brewerMethods.workspaceId, workspaceId));
      const row = { id: randomUUID(), name: body.name, position: (last ?? 0) + 1, hidden: false, builtin: null, behaviour: body.behaviour };
      await tx.insert(brewerMethods).values({ ...row, workspaceId });
      return row;
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  res.status(201).json({ method: created });
});

// Every method of the workspace, once each, in the new order.
brewerMethodsRouter.put("/order", async (req: Request<WorkspaceParams>, res: Response<{ methods: BrewerMethodItem[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: brewerMethods.id }).from(brewerMethods).where(eq(brewerMethods.workspaceId, workspaceId)).for("update");
    const ids = new Set(existing.map((m) => m.id));
    if (existing.length !== body.methodIds.length || !body.methodIds.every((id) => ids.has(id))) return false;
    for (const [i, id] of body.methodIds.entries()) {
      await tx.update(brewerMethods).set({ position: i + 1 }).where(eq(brewerMethods.id, id));
    }
    return true;
  });
  if (!ok) {
    sendError(res, 400, "methodIds: must list every method of this workspace exactly once");
    return;
  }
  res.json({ methods: await listMethods(workspaceId) });
});

// Rename, hide/show, or (custom methods) change the behaviour: its brewers'
// kind changes with it, so that's refused (409) while any of them has recipes,
// like changing a brewer's kind (§3).
brewerMethodsRouter.patch("/:methodId", async (req: Request<MethodParams>, res: Response<{ method: BrewerMethodItem }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(patchSchema, req, res);
  if (!body) return;
  let outcome: { status: number; error?: string; recipeCount?: number };
  try {
    outcome = await db.transaction(async (tx) => {
      const [current] = await tx.select({ builtin: brewerMethods.builtin, behaviour: brewerMethods.behaviour }).from(brewerMethods).where(inWorkspace(req.params)).for("update");
      if (!current) return { status: 404, error: "Method not found" };
      const changesBehaviour = body.behaviour !== undefined && body.behaviour !== current.behaviour;
      if (changesBehaviour && current.builtin) return { status: 400, error: "behaviour: a built-in method always behaves like itself" };
      if (changesBehaviour) {
        const own = tx.select({ id: brewers.id }).from(brewers).where(eq(brewers.methodId, req.params.methodId));
        const [row] = await tx.select({ n: count() }).from(recipes).where(inArray(recipes.brewerId, own));
        const recipeCount = row?.n ?? 0;
        if (recipeCount > 0) return { status: 409, error: `${recipeCount} recipe(s) use this method's brewers, so its behaviour can't change.`, recipeCount };
        await tx.update(brewers).set({ kind: body.behaviour }).where(eq(brewers.methodId, req.params.methodId));
      }
      await tx.update(brewerMethods).set(body).where(inWorkspace(req.params));
      return { status: 200 };
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error ?? "", outcome.recipeCount === undefined ? undefined : { recipeCount: outcome.recipeCount });
    return;
  }
  const [method] = await db.select(columns).from(brewerMethods).where(inWorkspace(req.params));
  if (!method) {
    sendError(res, 404, "Method not found");
    return;
  }
  res.json({ method });
});

addUsageRoute(brewerMethodsRouter, "methodId", "brewerMethods", brewerMethodUsage, "Method not found");

// Custom methods only: its brewers move to the built-in method of the same
// behaviour (nothing else changes for them), then it's deleted. A built-in is
// hidden instead (409).
brewerMethodsRouter.delete("/:methodId", async (req: Request<MethodParams>, res: Response) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const status = await db.transaction(async (tx) => {
    const [method] = await tx.select({ builtin: brewerMethods.builtin, behaviour: brewerMethods.behaviour }).from(brewerMethods).where(inWorkspace(req.params)).for("update");
    if (!method) return 404;
    if (method.builtin) return 409;
    const [home] = await tx
      .select({ id: brewerMethods.id })
      .from(brewerMethods)
      .where(and(eq(brewerMethods.workspaceId, workspaceId), eq(brewerMethods.builtin, method.behaviour)))
      .limit(1);
    await tx.update(brewers).set({ methodId: home?.id ?? null }).where(eq(brewers.methodId, req.params.methodId));
    await tx.delete(brewerMethods).where(inWorkspace(req.params));
    return 204;
  });
  if (status === 404) {
    sendError(res, 404, "Method not found");
    return;
  }
  if (status === 409) {
    sendError(res, 409, "Built-in methods can't be deleted; hide it instead");
    return;
  }
  res.status(204).end();
});

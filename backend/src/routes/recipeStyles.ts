import { randomUUID } from "node:crypto";
import { and, asc, eq, max } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, recipeStyleUsage } from "../usage.js";
import { METHOD_KINDS, RECIPE_STYLES, recipeStyles, STYLE_NAMES, STYLES_BY_KIND, type MethodKind, type RecipeStyleRow } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

// docs/api/recipe-styles.md §5e: the workspace's recipe styles, a list per
// brewer method, seeded with the built-ins. Built-ins can be renamed and
// hidden but not deleted; a custom style "brews like" one of its method's
// built-ins and can be deleted (its recipes lose the style).
export type RecipeStyleItem = Omit<RecipeStyleRow, "workspaceId" | "createdAt">;

interface WorkspaceParams {
  workspaceId: string;
}
interface StyleParams extends WorkspaceParams {
  styleId: string;
}

const name = z.string().trim().min(1).max(100);
const createSchema = z.object({ kind: z.enum(METHOD_KINDS), name, brewsLike: z.enum(RECIPE_STYLES) }).strict();
const patchSchema = updateSchema({ name, hidden: z.boolean(), brewsLike: z.enum(RECIPE_STYLES) });
const orderSchema = z
  .object({
    kind: z.enum(METHOD_KINDS),
    styleIds: z.array(z.uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "each style once"),
  })
  .strict();

const columns = {
  id: recipeStyles.id,
  kind: recipeStyles.kind,
  name: recipeStyles.name,
  position: recipeStyles.position,
  hidden: recipeStyles.hidden,
  builtin: recipeStyles.builtin,
  brewsLike: recipeStyles.brewsLike,
};
const kindOrder = (kind: MethodKind) => METHOD_KINDS.indexOf(kind);
const inWorkspace = (p: StyleParams) => and(eq(recipeStyles.id, p.styleId), eq(recipeStyles.workspaceId, p.workspaceId));
const BREWS_LIKE_ERROR = (kind: MethodKind) => `brewsLike: must be one of ${STYLES_BY_KIND[kind].join(", ")} for ${kind} recipes`;

// By method (filter, espresso, stovetop, other), then position.
async function listStyles(workspaceId: string): Promise<RecipeStyleItem[]> {
  const rows = await db.select(columns).from(recipeStyles).where(eq(recipeStyles.workspaceId, workspaceId)).orderBy(asc(recipeStyles.position), asc(recipeStyles.name));
  return rows.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
}

// A new workspace's built-ins (workspaces.ts, in its create transaction).
export function defaultStyleRows(workspaceId: string) {
  return METHOD_KINDS.flatMap((kind) =>
    STYLES_BY_KIND[kind].map((key, i) => ({ id: randomUUID(), workspaceId, kind, name: STYLE_NAMES[key], position: i + 1, builtin: key, brewsLike: key })),
  );
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A style with that name already exists for this method");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/recipe-styles
export const recipeStylesRouter = Router({ mergeParams: true });
recipeStylesRouter.use(requireAuth);

// All of them, hidden ones included (the recipe form leaves hidden ones out).
recipeStylesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ styles: RecipeStyleItem[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ styles: await listStyles(workspaceId) });
});

// New styles go last in their method.
recipeStylesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ style: RecipeStyleItem }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  if (!STYLES_BY_KIND[body.kind].includes(body.brewsLike)) {
    sendError(res, 400, BREWS_LIKE_ERROR(body.kind));
    return;
  }
  let created: RecipeStyleItem;
  try {
    created = await db.transaction(async (tx) => {
      const scope = and(eq(recipeStyles.workspaceId, workspaceId), eq(recipeStyles.kind, body.kind));
      await tx.select({ id: recipeStyles.id }).from(recipeStyles).where(scope).for("update");
      const [{ last } = { last: 0 }] = await tx.select({ last: max(recipeStyles.position) }).from(recipeStyles).where(scope);
      const row = { id: randomUUID(), kind: body.kind, name: body.name, position: (last ?? 0) + 1, hidden: false, builtin: null, brewsLike: body.brewsLike };
      await tx.insert(recipeStyles).values({ ...row, workspaceId });
      return row;
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  res.status(201).json({ style: created });
});

// One method's styles, every one once, in the new order.
recipeStylesRouter.put("/order", async (req: Request<WorkspaceParams>, res: Response<{ styles: RecipeStyleItem[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: recipeStyles.id })
      .from(recipeStyles)
      .where(and(eq(recipeStyles.workspaceId, workspaceId), eq(recipeStyles.kind, body.kind)))
      .for("update");
    const ids = new Set(existing.map((s) => s.id));
    if (existing.length !== body.styleIds.length || !body.styleIds.every((id) => ids.has(id))) return false;
    for (const [i, id] of body.styleIds.entries()) {
      await tx.update(recipeStyles).set({ position: i + 1 }).where(eq(recipeStyles.id, id));
    }
    return true;
  });
  if (!ok) {
    sendError(res, 400, `styleIds: must list every ${body.kind} style of this workspace exactly once`);
    return;
  }
  res.json({ styles: await listStyles(workspaceId) });
});

// Rename, hide/show, or (custom styles) change what it brews like.
recipeStylesRouter.patch("/:styleId", async (req: Request<StyleParams>, res: Response<{ style: RecipeStyleItem }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(patchSchema, req, res);
  if (!body) return;
  const [current] = await db.select({ kind: recipeStyles.kind, builtin: recipeStyles.builtin }).from(recipeStyles).where(inWorkspace(req.params));
  if (!current) {
    sendError(res, 404, "Style not found");
    return;
  }
  if (body.brewsLike !== undefined) {
    if (current.builtin && body.brewsLike !== current.builtin) {
      sendError(res, 400, "brewsLike: a built-in style always brews like itself");
      return;
    }
    if (!STYLES_BY_KIND[current.kind].includes(body.brewsLike)) {
      sendError(res, 400, BREWS_LIKE_ERROR(current.kind));
      return;
    }
  }
  try {
    await db.update(recipeStyles).set(body).where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [style] = await db.select(columns).from(recipeStyles).where(inWorkspace(req.params));
  if (!style) {
    sendError(res, 404, "Style not found");
    return;
  }
  res.json({ style });
});

addUsageRoute(recipeStylesRouter, "styleId", "recipeStyles", recipeStyleUsage, "Style not found");

// Custom styles only; their recipes lose the style (FK set null). A built-in
// is hidden instead (409).
recipeStylesRouter.delete("/:styleId", async (req: Request<StyleParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [style] = await db.select({ builtin: recipeStyles.builtin }).from(recipeStyles).where(inWorkspace(req.params));
  if (!style) {
    sendError(res, 404, "Style not found");
    return;
  }
  if (style.builtin) {
    sendError(res, 409, "Built-in styles can't be deleted; hide it instead");
    return;
  }
  await db.delete(recipeStyles).where(inWorkspace(req.params));
  res.status(204).end();
});

import { randomUUID } from "node:crypto";
import { and, asc, eq, max } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { drinkCategories, type DrinkCategory } from "@barista/shared/schema";

// docs/api_spec.md §5d: ordered menu sections for drinks and brewers.
export type CategorySummary = Pick<DrinkCategory, "id" | "name" | "position">;

interface WorkspaceParams {
  workspaceId: string;
}
interface CategoryParams extends WorkspaceParams {
  categoryId: string;
}

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const orderSchema = z
  .object({ categoryIds: z.array(z.uuid()).max(100).refine((ids) => new Set(ids).size === ids.length, "each category once") })
  .strict();

const summary = { id: drinkCategories.id, name: drinkCategories.name, position: drinkCategories.position };

function inWorkspace(p: CategoryParams) {
  return and(eq(drinkCategories.id, p.categoryId), eq(drinkCategories.workspaceId, p.workspaceId));
}

function listCategories(workspaceId: string): Promise<CategorySummary[]> {
  return db
    .select(summary)
    .from(drinkCategories)
    .where(eq(drinkCategories.workspaceId, workspaceId))
    .orderBy(asc(drinkCategories.position), asc(drinkCategories.name));
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A category with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/drink-categories
export const drinkCategoriesRouter = Router({ mergeParams: true });
drinkCategoriesRouter.use(requireAuth);

drinkCategoriesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ categories: CategorySummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ categories: await listCategories(workspaceId) });
});

// New categories go last.
drinkCategoriesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ category: CategorySummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(nameSchema, req, res);
  if (!body) return;
  let category: CategorySummary;
  try {
    category = await db.transaction(async (tx) => {
      // Lock the workspace's categories so two creates don't take the same position.
      await tx.select({ id: drinkCategories.id }).from(drinkCategories).where(eq(drinkCategories.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(drinkCategories.position) })
        .from(drinkCategories)
        .where(eq(drinkCategories.workspaceId, workspaceId));
      const row = { id: randomUUID(), name: body.name, position: (last ?? 0) + 1 };
      await tx.insert(drinkCategories).values({ ...row, workspaceId });
      return row;
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  res.status(201).json({ category });
});

// Every category of the workspace, once each, in the new order.
drinkCategoriesRouter.put("/order", async (req: Request<WorkspaceParams>, res: Response<{ categories: CategorySummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: drinkCategories.id })
      .from(drinkCategories)
      .where(eq(drinkCategories.workspaceId, workspaceId))
      .for("update");
    const ids = new Set(existing.map((c) => c.id));
    if (existing.length !== body.categoryIds.length || !body.categoryIds.every((id) => ids.has(id))) return false;
    for (const [i, id] of body.categoryIds.entries()) {
      await tx.update(drinkCategories).set({ position: i + 1 }).where(eq(drinkCategories.id, id));
    }
    return true;
  });
  if (!ok) {
    sendError(res, 400, "categoryIds: must list every category of this workspace exactly once");
    return;
  }
  res.json({ categories: await listCategories(workspaceId) });
});

drinkCategoriesRouter.patch("/:categoryId", async (req: Request<CategoryParams>, res: Response<{ category: CategorySummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(nameSchema, req, res);
  if (!body) return;
  try {
    await db.update(drinkCategories).set(body).where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [category] = await db.select(summary).from(drinkCategories).where(inWorkspace(req.params));
  if (!category) {
    sendError(res, 404, "Category not found");
    return;
  }
  res.json({ category });
});

// Its drinks and brewers become uncategorised (FK set null).
drinkCategoriesRouter.delete("/:categoryId", async (req: Request<CategoryParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(drinkCategories).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Category not found");
    return;
  }
  res.status(204).end();
});

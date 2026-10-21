import { randomUUID } from "node:crypto";
import { and, asc, count, eq, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { INGREDIENT_TYPES, ingredients, drinkIngredients, type Ingredient } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api/ingredients.md §5b: reusable preps that finish a drink.
export type IngredientSummary = Pick<Ingredient, "id" | "name" | "ingredientType" | "instructions" | "createdAt"> & { drinkCount: number };

interface WorkspaceParams {
  workspaceId: string;
}
interface IngredientParams extends WorkspaceParams {
  ingredientId: string;
}

const ingredientFields = {
  name: z.string().trim().min(1).max(100),
  ingredientType: z.enum(INGREDIENT_TYPES),
  instructions: optionalText(5000),
};
const createSchema = z.object({ ...ingredientFields, ingredientType: ingredientFields.ingredientType.default("other") });
const updateIngredientSchema = updateSchema(ingredientFields);

function inWorkspace(p: IngredientParams) {
  return and(eq(ingredients.id, p.ingredientId), eq(ingredients.workspaceId, p.workspaceId));
}

async function loadIngredients(where: SQL | undefined): Promise<IngredientSummary[]> {
  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      ingredientType: ingredients.ingredientType,
      instructions: ingredients.instructions,
      createdAt: ingredients.createdAt,
      drinkCount: count(drinkIngredients.id),
    })
    .from(ingredients)
    .leftJoin(drinkIngredients, eq(drinkIngredients.ingredientId, ingredients.id))
    .where(where)
    .groupBy(ingredients.id)
    .orderBy(asc(ingredients.name));
  return rows;
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "An ingredient with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/ingredients
export const ingredientsRouter = Router({ mergeParams: true });
ingredientsRouter.use(requireAuth);

ingredientsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ ingredients: IngredientSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ ingredients: await loadIngredients(eq(ingredients.workspaceId, workspaceId)) });
});

ingredientsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ ingredient: IngredientSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(ingredients).values({ id, workspaceId, ...body });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [ingredient] = await loadIngredients(eq(ingredients.id, id));
  if (!ingredient) throw new Error(`Ingredient ${id} missing after insert`);
  res.status(201).json({ ingredient });
});

ingredientsRouter.patch("/:ingredientId", async (req: Request<IngredientParams>, res: Response<{ ingredient: IngredientSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateIngredientSchema, req, res);
  if (!body) return;
  try {
    await db.update(ingredients).set(body).where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [ingredient] = await loadIngredients(inWorkspace(req.params));
  if (!ingredient) {
    sendError(res, 404, "Ingredient not found");
    return;
  }
  res.json({ ingredient });
});

// The FK cascades (so workspace deletion works); this check protects drinks.
ingredientsRouter.delete("/:ingredientId", async (req: Request<IngredientParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const [ingredient] = await tx.select({ id: ingredients.id }).from(ingredients).where(inWorkspace(req.params)).for("update");
    if (!ingredient) return { status: "not_found" } as const;
    const [{ drinkCount } = { drinkCount: 0 }] = await tx
      .select({ drinkCount: count() })
      .from(drinkIngredients)
      .where(eq(drinkIngredients.ingredientId, ingredient.id));
    if (drinkCount > 0) return { status: "in_use", drinkCount } as const;
    await tx.delete(ingredients).where(eq(ingredients.id, ingredient.id));
    return { status: "deleted" } as const;
  });
  if (outcome.status === "not_found") {
    sendError(res, 404, "Ingredient not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.drinkCount} drink(s) use this ingredient. Remove it from them first.`, { drinkCount: outcome.drinkCount });
    return;
  }
  res.status(204).end();
});

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  brewers,
  ingredients,
  drinkCategories,
  drinkIngredients,
  drinks,
  METHOD_KINDS,
  recipes,
  SERVING_UNITS,
  type IngredientType,
  type Drink,
  type MethodKind,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api/drinks.md §5c
export interface DrinkDetails
  extends Pick<Drink, "id" | "name" | "description" | "defaultRecipeId" | "servingSize" | "servingUnit" | "instructions" | "createdAt"> {
  kind: MethodKind; // the kind of coffee it needs; any brewer of it can make it
  category: { id: string; name: string } | null;
  parent: { id: string; name: string } | null;
  variants: Array<{ id: string; name: string }>;
  ingredients: Array<{
    ingredientId: string;
    name: string;
    ingredientType: IngredientType;
    amountValue: number | null; // for the default size
    amountUnit: string | null; // "fl oz", "ml", "g" or free text ("pump")
    note: string | null;
  }>;
}

interface WorkspaceParams {
  workspaceId: string;
}
interface DrinkParams extends WorkspaceParams {
  drinkId: string;
}

const distinct = (ids: readonly string[]) => new Set(ids).size === ids.length;

const drinkFields = {
  name: z.string().trim().min(1).max(255),
  description: optionalText(500),
  kind: z.enum(METHOD_KINDS),
  categoryId: z.uuid().nullable().optional(),
  parentDrinkId: z.uuid().nullable().optional(),
  defaultRecipeId: z.uuid().nullable().optional(),
  // Both or neither (checked below).
  servingSize: decimalSchema({ min: 0, max: 2000, scale: 1, exclusiveMin: true }).nullable().optional(),
  servingUnit: z.enum(SERVING_UNITS).nullable().optional(),
  instructions: optionalText(5000), // how to make it, shown after the brew
  ingredients: z
    .array(
      z
        .object({
          ingredientId: z.uuid(),
          amountValue: decimalSchema({ min: 0, max: 100000, scale: 2, exclusiveMin: true }).nullable().optional(),
          amountUnit: optionalText(20),
          note: optionalText(255),
        })
        .strict()
    )
    .max(20)
    .refine((list) => distinct(list.map((c) => c.ingredientId)), "each ingredient at most once"),
};
// Strict: showOnPublicMenu is gone (the menu builder places drinks, §7b), so
// an old client sending it gets a 400 rather than a silent drop.
const createSchema = z
  .object({
    ...drinkFields,
    ingredients: drinkFields.ingredients.default([]),
  })
  .strict();
const updateDrinkSchema = updateSchema(drinkFields);

// A size needs both its number and unit, or neither.
const SIZE_ERROR = "servingSize: servingSize and servingUnit go together";
const sizeMismatch = (size: number | null | undefined, unit: string | null | undefined) => (size ?? null) === null !== ((unit ?? null) === null);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Everything a drink points at must be in its workspace. Rows are locked so a
// concurrent delete either finishes first (we see it missing -> 400) or waits.
async function inWorkspace(tx: Tx, table: typeof drinkCategories | typeof drinks, id: string, workspaceId: string): Promise<boolean> {
  const found = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
    .for("update");
  return found.length === 1;
}
async function ingredientsInWorkspace(tx: Tx, ids: string[], workspaceId: string): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await tx
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(and(inArray(ingredients.id, ids), eq(ingredients.workspaceId, workspaceId)))
    .for("update");
  return found.length === ids.length;
}
// The default recipe must be in the workspace, on a brewer of the drink's kind.
async function recipeFitsKind(tx: Tx, recipeId: string, kind: MethodKind, workspaceId: string): Promise<boolean> {
  const found = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
    .where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, workspaceId), eq(brewers.kind, kind)))
    .for("update");
  return found.length === 1;
}
// True if making parentId the parent of drinkId would form a loop (parentId
// is drinkId or one of its variants, at any depth). The workspace's drinks are
// locked so two concurrent re-parentings can't build a loop between them.
async function wouldLoop(tx: Tx, drinkId: string, parentId: string, workspaceId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: drinks.id, parentDrinkId: drinks.parentDrinkId })
    .from(drinks)
    .where(eq(drinks.workspaceId, workspaceId))
    .for("update");
  const parentOf = new Map(rows.map((r) => [r.id, r.parentDrinkId]));
  const seen = new Set<string>();
  for (let at: string | null | undefined = parentId; at; at = parentOf.get(at)) {
    if (at === drinkId || seen.has(at)) return true;
    seen.add(at);
  }
  return false;
}

async function replaceIngredients(tx: Tx, drinkId: string, list: z.infer<typeof drinkFields.ingredients>): Promise<void> {
  await tx.delete(drinkIngredients).where(eq(drinkIngredients.drinkId, drinkId));
  if (list.length === 0) return;
  await tx.insert(drinkIngredients).values(
    list.map((c, i) => ({
      id: randomUUID(),
      drinkId,
      ingredientId: c.ingredientId,
      position: i + 1,
      amountValue: c.amountValue ?? null,
      amountUnit: c.amountUnit ?? null,
      note: c.note ?? null,
    }))
  );
}

const parents = alias(drinks, "parent");

export async function loadDrinks(where: SQL | undefined): Promise<DrinkDetails[]> {
  const rows = await db
    .select({
      id: drinks.id,
      name: drinks.name,
      description: drinks.description,
      createdAt: drinks.createdAt,
      defaultRecipeId: drinks.defaultRecipeId,
      servingSize: drinks.servingSize,
      servingUnit: drinks.servingUnit,
      instructions: drinks.instructions,
      kind: drinks.kind,
      categoryId: drinkCategories.id,
      categoryName: drinkCategories.name,
      parentId: parents.id,
      parentName: parents.name,
    })
    .from(drinks)
    .leftJoin(drinkCategories, eq(drinks.categoryId, drinkCategories.id))
    .leftJoin(parents, eq(drinks.parentDrinkId, parents.id))
    .where(where)
    .orderBy(asc(drinks.name));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [variantRows, ingredientRows] = await Promise.all([
    db
      .select({ parentDrinkId: drinks.parentDrinkId, id: drinks.id, name: drinks.name })
      .from(drinks)
      .where(inArray(drinks.parentDrinkId, ids))
      .orderBy(asc(drinks.name)),
    db
      .select({
        drinkId: drinkIngredients.drinkId,
        ingredientId: ingredients.id,
        name: ingredients.name,
        ingredientType: ingredients.ingredientType,
        amountValue: drinkIngredients.amountValue,
        amountUnit: drinkIngredients.amountUnit,
        note: drinkIngredients.note,
      })
      .from(drinkIngredients)
      .innerJoin(ingredients, eq(drinkIngredients.ingredientId, ingredients.id))
      .where(inArray(drinkIngredients.drinkId, ids))
      .orderBy(asc(drinkIngredients.position)),
  ]);
  return rows.map(({ categoryId, categoryName, parentId, parentName, ...row }) => ({
    ...row,
    category: categoryId && categoryName ? { id: categoryId, name: categoryName } : null,
    parent: parentId && parentName ? { id: parentId, name: parentName } : null,
    variants: variantRows.filter((v) => v.parentDrinkId === row.id).map(({ id, name }) => ({ id, name })),
    ingredients: ingredientRows.filter((c) => c.drinkId === row.id).map(({ drinkId: _drink, ...c }) => c),
  }));
}

// Mounted at /api/workspaces/:workspaceId/drinks
export const drinksRouter = Router({ mergeParams: true });
drinksRouter.use(requireAuth);

drinksRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ drinks: DrinkDetails[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ drinks: await loadDrinks(eq(drinks.workspaceId, workspaceId)) });
});

drinksRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ drink: DrinkDetails }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const { ingredients: list, ...fields } = body;
  if (sizeMismatch(fields.servingSize, fields.servingUnit)) {
    sendError(res, 400, SIZE_ERROR);
    return;
  }
  const id = randomUUID();
  const error = await db.transaction(async (tx) => {
    if (fields.categoryId && !(await inWorkspace(tx, drinkCategories, fields.categoryId, workspaceId))) return "categoryId: not a category in this workspace";
    if (fields.parentDrinkId && !(await inWorkspace(tx, drinks, fields.parentDrinkId, workspaceId))) return "parentDrinkId: not a drink in this workspace";
    if (fields.defaultRecipeId && !(await recipeFitsKind(tx, fields.defaultRecipeId, fields.kind, workspaceId))) {
      return "defaultRecipeId: must be a recipe of the drink's kind in this workspace";
    }
    if (!(await ingredientsInWorkspace(tx, list.map((c) => c.ingredientId), workspaceId))) return "ingredients: ingredientId not an ingredient in this workspace";
    await tx.insert(drinks).values({ id, workspaceId, ...fields });
    await replaceIngredients(tx, id, list);
    return null;
  });
  if (error) {
    sendError(res, 400, error);
    return;
  }
  const [drink] = await loadDrinks(eq(drinks.id, id));
  if (!drink) throw new Error(`Drink ${id} missing after insert`);
  res.status(201).json({ drink });
});

drinksRouter.patch("/:drinkId", async (req: Request<DrinkParams>, res: Response<{ drink: DrinkDetails }>) => {
  const { workspaceId, drinkId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateDrinkSchema, req, res);
  if (!body) return;
  const { ingredients: list, ...fields } = body;

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ kind: drinks.kind, defaultRecipeId: drinks.defaultRecipeId, servingSize: drinks.servingSize, servingUnit: drinks.servingUnit })
      .from(drinks)
      .where(and(eq(drinks.id, drinkId), eq(drinks.workspaceId, workspaceId)))
      .for("update");
    if (!existing) return { status: 404, error: "Drink not found" } as const;
    const bad = (error: string) => ({ status: 400, error }) as const;
    const size = fields.servingSize === undefined ? existing.servingSize : fields.servingSize;
    const unit = fields.servingUnit === undefined ? existing.servingUnit : fields.servingUnit;
    if (sizeMismatch(size, unit)) return bad(SIZE_ERROR);

    const kind = fields.kind ?? existing.kind;
    if (fields.categoryId && !(await inWorkspace(tx, drinkCategories, fields.categoryId, workspaceId))) return bad("categoryId: not a category in this workspace");
    if (fields.parentDrinkId) {
      if (!(await inWorkspace(tx, drinks, fields.parentDrinkId, workspaceId))) return bad("parentDrinkId: not a drink in this workspace");
      if (await wouldLoop(tx, drinkId, fields.parentDrinkId, workspaceId)) return bad("parentDrinkId: a drink can't be a variant of itself or of its own variants");
    }
    // The default must fit the kind after the change; a default of the old
    // kind is cleared unless a new one is sent.
    let defaultRecipeId = fields.defaultRecipeId === undefined ? existing.defaultRecipeId : fields.defaultRecipeId;
    if (defaultRecipeId && !(await recipeFitsKind(tx, defaultRecipeId, kind, workspaceId))) {
      if (fields.defaultRecipeId) return bad("defaultRecipeId: must be a recipe of the drink's kind in this workspace");
      defaultRecipeId = null;
    }
    if (list && !(await ingredientsInWorkspace(tx, list.map((c) => c.ingredientId), workspaceId))) {
      return bad("ingredients: ingredientId not an ingredient in this workspace");
    }
    await tx.update(drinks).set({ ...fields, defaultRecipeId }).where(eq(drinks.id, drinkId));
    if (list) await replaceIngredients(tx, drinkId, list);
    return { status: 200 } as const;
  });

  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error);
    return;
  }
  const [drink] = await loadDrinks(eq(drinks.id, drinkId));
  if (!drink) {
    sendError(res, 404, "Drink not found");
    return;
  }
  res.json({ drink });
});

// Its variants move up to its parent. Brew logs keep their history with
// drinkId set to null.
drinksRouter.delete("/:drinkId", async (req: Request<DrinkParams>, res: Response) => {
  const { workspaceId, drinkId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const found = await db.transaction(async (tx) => {
    const [drink] = await tx
      .select({ parentDrinkId: drinks.parentDrinkId })
      .from(drinks)
      .where(and(eq(drinks.id, drinkId), eq(drinks.workspaceId, workspaceId)))
      .for("update");
    if (!drink) return false;
    await tx.update(drinks).set({ parentDrinkId: drink.parentDrinkId }).where(eq(drinks.parentDrinkId, drinkId));
    await tx.delete(drinks).where(eq(drinks.id, drinkId));
    return true;
  });
  if (!found) {
    sendError(res, 404, "Drink not found");
    return;
  }
  res.status(204).end();
});

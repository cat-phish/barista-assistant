import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  brewMethods,
  components,
  drinkComponents,
  drinkRecipes,
  drinks,
  recipes,
  type ComponentType,
  type Drink,
  type MethodKind,
} from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §5c
export interface DrinkDetails extends Pick<Drink, "id" | "name" | "description" | "category" | "showOnPublicMenu" | "defaultRecipeId"> {
  recipes: Array<{ id: string; name: string; method: { id: string; name: string; kind: MethodKind } }>;
  components: Array<{ componentId: string; name: string; componentType: ComponentType; amount: string | null; note: string | null }>;
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
  category: optionalText(100), // free text, groups drinks (docs/api_spec.md §5c)
  showOnPublicMenu: z.boolean(),
  recipeIds: z.array(z.uuid()).min(1).max(20).refine(distinct, "each recipe at most once"),
  defaultRecipeId: z.uuid().nullable().optional(),
  components: z
    .array(z.object({ componentId: z.uuid(), amount: optionalText(50), note: optionalText(255) }).strict())
    .max(20)
    .refine((list) => distinct(list.map((c) => c.componentId)), "each component at most once"),
};
const createSchema = z.object({
  ...drinkFields,
  showOnPublicMenu: drinkFields.showOnPublicMenu.default(true),
  components: drinkFields.components.default([]),
});
const updateDrinkSchema = updateSchema(drinkFields);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Both lists must be in this workspace. Locked so a concurrent delete either
// finishes first (we see fewer rows -> 400) or waits for us.
async function recipesInWorkspace(tx: Tx, ids: string[], workspaceId: string): Promise<boolean> {
  const found = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(inArray(recipes.id, ids), eq(recipes.workspaceId, workspaceId)))
    .for("update");
  return found.length === ids.length;
}
async function componentsInWorkspace(tx: Tx, ids: string[], workspaceId: string): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await tx
    .select({ id: components.id })
    .from(components)
    .where(and(inArray(components.id, ids), eq(components.workspaceId, workspaceId)))
    .for("update");
  return found.length === ids.length;
}

async function replaceRecipes(tx: Tx, drinkId: string, recipeIds: string[]): Promise<void> {
  await tx.delete(drinkRecipes).where(eq(drinkRecipes.drinkId, drinkId));
  await tx.insert(drinkRecipes).values(recipeIds.map((recipeId) => ({ drinkId, recipeId })));
}
async function replaceComponents(tx: Tx, drinkId: string, list: z.infer<typeof drinkFields.components>): Promise<void> {
  await tx.delete(drinkComponents).where(eq(drinkComponents.drinkId, drinkId));
  if (list.length === 0) return;
  await tx.insert(drinkComponents).values(
    list.map((c, i) => ({ id: randomUUID(), drinkId, componentId: c.componentId, position: i + 1, amount: c.amount ?? null, note: c.note ?? null }))
  );
}

export async function loadDrinks(where: SQL | undefined): Promise<DrinkDetails[]> {
  const rows = await db
    .select({
      id: drinks.id,
      name: drinks.name,
      description: drinks.description,
      category: drinks.category,
      showOnPublicMenu: drinks.showOnPublicMenu,
      defaultRecipeId: drinks.defaultRecipeId,
    })
    .from(drinks)
    .where(where)
    .orderBy(asc(drinks.name));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [recipeRows, componentRows] = await Promise.all([
    db
      .select({
        drinkId: drinkRecipes.drinkId,
        id: recipes.id,
        name: recipes.name,
        method: { id: brewMethods.id, name: brewMethods.name, kind: brewMethods.kind },
      })
      .from(drinkRecipes)
      .innerJoin(recipes, eq(drinkRecipes.recipeId, recipes.id))
      .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
      .where(inArray(drinkRecipes.drinkId, ids))
      .orderBy(asc(recipes.name)),
    db
      .select({
        drinkId: drinkComponents.drinkId,
        componentId: components.id,
        name: components.name,
        componentType: components.componentType,
        amount: drinkComponents.amount,
        note: drinkComponents.note,
      })
      .from(drinkComponents)
      .innerJoin(components, eq(drinkComponents.componentId, components.id))
      .where(inArray(drinkComponents.drinkId, ids))
      .orderBy(asc(drinkComponents.position)),
  ]);
  return rows.map((row) => ({
    ...row,
    recipes: recipeRows.filter((r) => r.drinkId === row.id).map(({ drinkId: _drink, ...r }) => r),
    components: componentRows.filter((c) => c.drinkId === row.id).map(({ drinkId: _drink, ...c }) => c),
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

// The categories in use, for suggestions in the drink form.
drinksRouter.get("/categories", async (req: Request<WorkspaceParams>, res: Response<{ categories: string[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .selectDistinct({ category: drinks.category })
    .from(drinks)
    .where(and(eq(drinks.workspaceId, workspaceId), isNotNull(drinks.category)))
    .orderBy(asc(drinks.category));
  res.json({ categories: rows.flatMap((r) => (r.category ? [r.category] : [])) });
});

drinksRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ drink: DrinkDetails }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const { recipeIds, components: list, defaultRecipeId, ...fields } = body;
  const preferred = defaultRecipeId ?? recipeIds[0]!;
  if (!recipeIds.includes(preferred)) {
    sendError(res, 400, "defaultRecipeId: must be one of recipeIds");
    return;
  }
  const id = randomUUID();
  const error = await db.transaction(async (tx) => {
    if (!(await recipesInWorkspace(tx, recipeIds, workspaceId))) return "recipeIds: not all recipes are in this workspace";
    if (!(await componentsInWorkspace(tx, list.map((c) => c.componentId), workspaceId))) return "components: componentId not a component in this workspace";
    await tx.insert(drinks).values({ id, workspaceId, ...fields, defaultRecipeId: preferred });
    await replaceRecipes(tx, id, recipeIds);
    await replaceComponents(tx, id, list);
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
  const { recipeIds, components: list, defaultRecipeId, ...fields } = body;

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ defaultRecipeId: drinks.defaultRecipeId })
      .from(drinks)
      .where(and(eq(drinks.id, drinkId), eq(drinks.workspaceId, workspaceId)))
      .for("update");
    if (!existing) return { status: 404, error: "Drink not found" } as const;

    // The default must be one of the drink's recipes after the change.
    const recipeList =
      recipeIds ?? (await tx.select({ id: drinkRecipes.recipeId }).from(drinkRecipes).where(eq(drinkRecipes.drinkId, drinkId))).map((r) => r.id);
    let preferred = defaultRecipeId === undefined ? existing.defaultRecipeId : defaultRecipeId;
    if (preferred === null || !recipeList.includes(preferred)) {
      if (defaultRecipeId) return { status: 400, error: "defaultRecipeId: must be one of the drink's recipes" } as const;
      preferred = recipeList[0] ?? null;
    }

    if (recipeIds && !(await recipesInWorkspace(tx, recipeIds, workspaceId))) {
      return { status: 400, error: "recipeIds: not all recipes are in this workspace" } as const;
    }
    if (list && !(await componentsInWorkspace(tx, list.map((c) => c.componentId), workspaceId))) {
      return { status: 400, error: "components: componentId not a component in this workspace" } as const;
    }
    await tx.update(drinks).set({ ...fields, defaultRecipeId: preferred }).where(eq(drinks.id, drinkId));
    if (recipeIds) await replaceRecipes(tx, drinkId, recipeIds);
    if (list) await replaceComponents(tx, drinkId, list);
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

// Brew logs keep their history with drinkId set to null.
drinksRouter.delete("/:drinkId", async (req: Request<DrinkParams>, res: Response) => {
  const { workspaceId, drinkId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(drinks).where(and(eq(drinks.id, drinkId), eq(drinks.workspaceId, workspaceId)));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Drink not found");
    return;
  }
  res.status(204).end();
});

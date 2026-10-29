import { and, count, eq, inArray, or, type SQL } from "drizzle-orm";
import type { Request, Response, Router } from "express";
import { requireMembership } from "./auth/membership.js";
import { sendError } from "./http.js";
import { authedUserId } from "./middleware/requireAuth.js";
import {
  beanProcesses,
  brewerMethods,
  recipeStyles,
  beans,
  brewers,
  brewLogs,
  brewLogProblems,
  brewLogTools,
  brewProblems,
  drinkIngredients,
  drinks,
  greenCoffees,
  grinders,
  ingredients,
  menuItems,
  prepTools,
  recipeGrindSettings,
  recipePrepTools,
  recipes,
  roastingMachines,
  waterProfiles,
} from "@barista/shared/schema";
import { db } from "./db.js";

// What deleting something takes with it, for the edit pages' warnings
// (docs/api/README.md, "Deleting"). Each count is of rows that would be
// unlinked or removed; all zero means nothing else changes.

type Counts = Record<string, number>;

async function n(query: Promise<Array<{ n: number }>>): Promise<number> {
  const [row] = await query;
  return row?.n ?? 0;
}
const countWhere = (table: Parameters<ReturnType<typeof db.select>["from"]>[0], where: SQL | undefined) =>
  n(db.select({ n: count() }).from(table).where(where));

// Its recipes are deleted (the FK cascades), their brews lose the recipe, and
// brews made with it lose the brewer; menu items that show it go.
export async function brewerUsage(id: string): Promise<Counts> {
  const own = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.brewerId, id));
  const [recipeCount, brewLogCount, menuItemCount] = await Promise.all([
    countWhere(recipes, eq(recipes.brewerId, id)),
    countWhere(brewLogs, or(eq(brewLogs.brewerId, id), inArray(brewLogs.recipeId, own))),
    countWhere(menuItems, eq(menuItems.brewerId, id)),
  ]);
  return { recipeCount, brewLogCount, menuItemCount };
}

// Brews lose the grinder; recipes lose their grind setting for it (or it as
// their default grinder).
export async function grinderUsage(id: string): Promise<Counts> {
  const withSetting = db.select({ id: recipeGrindSettings.recipeId }).from(recipeGrindSettings).where(eq(recipeGrindSettings.grinderId, id));
  const [brewLogCount, recipeCount] = await Promise.all([
    countWhere(brewLogs, eq(brewLogs.grinderId, id)),
    countWhere(recipes, or(eq(recipes.defaultGrinderId, id), inArray(recipes.id, withSetting))),
  ]);
  return { brewLogCount, recipeCount };
}

export async function waterProfileUsage(id: string): Promise<Counts> {
  return { brewLogCount: await countWhere(brewLogs, eq(brewLogs.waterProfileId, id)) };
}

export async function prepToolUsage(id: string): Promise<Counts> {
  const [brewLogCount, recipeCount] = await Promise.all([
    countWhere(brewLogTools, eq(brewLogTools.toolId, id)),
    countWhere(recipePrepTools, eq(recipePrepTools.toolId, id)),
  ]);
  return { brewLogCount, recipeCount };
}

// Brews that recorded it lose it (FK cascade on brew_log_problems).
export async function brewProblemUsage(id: string): Promise<Counts> {
  return { brewLogCount: await countWhere(brewLogProblems, eq(brewLogProblems.problemId, id)) };
}

// Brews lose the recipe; drinks with it as their default lose the default.
export async function recipeUsage(id: string): Promise<Counts> {
  const [brewLogCount, drinkCount] = await Promise.all([
    countWhere(brewLogs, eq(brewLogs.recipeId, id)),
    countWhere(drinks, eq(drinks.defaultRecipeId, id)),
  ]);
  return { brewLogCount, drinkCount };
}

// Brews lose the drink; its variants move up to its parent; menu items that
// show it go.
export async function drinkUsage(id: string): Promise<Counts> {
  const [brewLogCount, variantCount, menuItemCount] = await Promise.all([
    countWhere(brewLogs, eq(brewLogs.drinkId, id)),
    countWhere(drinks, eq(drinks.parentDrinkId, id)),
    countWhere(menuItems, eq(menuItems.drinkId, id)),
  ]);
  return { brewLogCount, variantCount, menuItemCount };
}

// The drinks that use it lose it.
export async function ingredientUsage(id: string): Promise<Counts> {
  return { drinkCount: await countWhere(drinkIngredients, eq(drinkIngredients.ingredientId, id)) };
}

// Beans lose the process (FK set null).
export async function beanProcessUsage(id: string): Promise<Counts> {
  return { beanCount: await countWhere(beans, eq(beans.processId, id)) };
}

// Recipes lose the style (FK set null).
export async function recipeStyleUsage(id: string): Promise<Counts> {
  return { recipeCount: await countWhere(recipes, eq(recipes.styleId, id)) };
}

// Its brewers move to the built-in method of the same behaviour.
export async function brewerMethodUsage(id: string): Promise<Counts> {
  return { brewerCount: await countWhere(brewers, eq(brewers.methodId, id)) };
}

// Home roasting (docs/api/roasting-machines.md §3f, green-coffees.md §4e):
// nothing uses machines or green coffees until roasts are logged, which will
// keep their record with it unlinked.
export async function roastingMachineUsage(): Promise<Counts> {
  return { roastCount: 0 };
}
export async function greenCoffeeUsage(): Promise<Counts> {
  return { roastCount: 0 };
}

const tables = { roastingMachines, greenCoffees, brewers, grinders, waterProfiles, prepTools, brewProblems, recipes, drinks, ingredients, beanProcesses, recipeStyles, brewerMethods } as const;

// GET /:<param>/usage on a resource router: the counts above, for any member.
export function addUsageRoute(
  router: Router,
  param: string,
  table: keyof typeof tables,
  usage: (id: string) => Promise<Counts>,
  notFound: string,
): void {
  router.get(`/:${param}/usage`, async (req: Request<Record<string, string>>, res: Response<Counts>) => {
    const workspaceId = req.params.workspaceId ?? "";
    const id = req.params[param] ?? "";
    if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
    const t = tables[table];
    const [row] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.workspaceId, workspaceId))).limit(1);
    if (!row) {
      sendError(res, 404, notFound);
      return;
    }
    res.json(await usage(id));
  });
}

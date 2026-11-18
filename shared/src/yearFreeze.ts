// Your Year in Coffee's frozen copy (docs/api/recaps.md §11c "Your Year in
// Coffee"): counted once from the Insights rows of 1 January–6 December and
// kept on a recaps row (kind yearInCoffee, periodStart 1 January), per person,
// workspace, year and scope. Only the worker freezes them, from 7 December;
// the API shows a year with no frozen copy counted live, unsaved. Once
// frozen, never counted again: later edits don't change what was seen.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "./schema.js";
import { DEFAULT_WORKSPACE_SETTINGS, recaps, withDefaults, workspaces, type RecapScope } from "./schema.js";
import { loadStatsRows } from "./statsRows.js";
import { freezeYear, yearInCoffeePeriod, type FrozenYear, type YearRows } from "./yearInCoffee.js";

type Database = MySql2Database<typeof schema>;
export const YEAR_IN_COFFEE_KIND = "yearInCoffee" as const;

const keyOf = (workspaceId: string, userId: string, year: number, scope: RecapScope) =>
  and(eq(recaps.workspaceId, workspaceId), eq(recaps.userId, userId), eq(recaps.kind, YEAR_IN_COFFEE_KIND), eq(recaps.periodStart, `${year}-01-01`), eq(recaps.scope, scope));

export async function storedYear(db: Database, workspaceId: string, userId: string, year: number, scope: RecapScope): Promise<FrozenYear | null> {
  const [row] = await db.select({ figures: recaps.figures }).from(recaps).where(keyOf(workspaceId, userId, year, scope));
  return row?.figures ?? null;
}

// The year counted now, not saved: for a year with no frozen copy (before
// this existed, or before the tick reached you). today: the person's local date.
export async function countYearInCoffee(db: Database, workspaceId: string, userId: string, year: number, scope: RecapScope, today: string): Promise<FrozenYear> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const { recipeRoastLevel } = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null);
  const rows = await loadStatsRows(db, workspaceId, userId, { to: yearInCoffeePeriod(year).end, mine: scope === "mine" });
  // As the API sends them (dates as strings), so it counts what a browser would.
  const wire = JSON.parse(JSON.stringify(rows)) as YearRows;
  return freezeYear(wire, year, recipeRoastLevel, today);
}

// The frozen copy, counting and saving it when there's none. Only the
// worker's tick calls this (from 7 December); opening a year never freezes it.
export async function freezeYearInCoffee(db: Database, workspaceId: string, userId: string, year: number, scope: RecapScope, today: string): Promise<FrozenYear> {
  const stored = await storedYear(db, workspaceId, userId, year, scope);
  if (stored) return stored;
  const frozen = await countYearInCoffee(db, workspaceId, userId, year, scope, today);
  await db
    .insert(recaps)
    .values({ id: randomUUID(), workspaceId, userId, kind: YEAR_IN_COFFEE_KIND, periodStart: `${year}-01-01`, scope, figures: frozen })
    .onDuplicateKeyUpdate({ set: { workspaceId } }); // already there: keep it
  // A row without figures yet (a notification's mark) gets them; one frozen meanwhile stands.
  await db.update(recaps).set({ figures: frozen, updatedAt: new Date() }).where(and(keyOf(workspaceId, userId, year, scope), isNull(recaps.figures)));
  return (await storedYear(db, workspaceId, userId, year, scope)) ?? frozen;
}

// Your Year in Coffee frozen on 7 December (docs/api/recaps.md §11c "Your
// Year in Coffee"): each quarter-hour tick from then to the year's end
// freezes the copies still missing, once the person's own day has reached
// 7 December: "mine" for everyone who brewed from 1 January to 6 December,
// "all" for every member of a workspace someone brewed in. A few per tick, so
// a busy server spreads them out. Opening a year never freezes it.
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { brewLogs, recaps, userPreferences, users, workspaceMembers, workspaces, type RecapScope } from "@barista/shared/schema";
import { freezeYearInCoffee, YEAR_IN_COFFEE_KIND } from "@barista/shared/yearFreeze";
import { YEAR_OUT_ON, yearInCoffeePeriod } from "@barista/shared/yearInCoffee";
import { db } from "./db.js";
import { recapZone, zonedNow } from "./recaps.js";

export const FREEZES_PER_TICK = 50;
// The earliest anywhere reaches 7 December: UTC+14's midnight.
const EARLIEST_OFFSET_MS = 14 * 3_600_000;

export async function processYearFreeze(now: Date = new Date()): Promise<{ frozen: number; failed: number }> {
  const year = now.getUTCFullYear();
  const out = { frozen: 0, failed: 0 };
  if (now.getTime() + EARLIEST_OFFSET_MS < Date.parse(`${year}-${YEAR_OUT_ON}T00:00:00Z`)) return out;
  const period = yearInCoffeePeriod(year);

  // Who brewed where (a day either side covers every offset; the exact local
  // dates are the counting's), among people still members.
  const brewed = await db
    .selectDistinct({ workspaceId: brewLogs.workspaceId, userId: brewLogs.userId })
    .from(brewLogs)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, brewLogs.workspaceId), eq(workspaceMembers.userId, brewLogs.userId)))
    .where(and(gte(brewLogs.timestamp, new Date(`${year}-01-01T00:00:00Z`)), lt(brewLogs.timestamp, new Date(Date.parse(`${period.end}T00:00:00Z`) + 2 * 86_400_000)), eq(brewLogs.steeping, false)));
  if (!brewed.length) return out;
  const workspaceIds = [...new Set(brewed.map((b) => b.workspaceId))];
  const members = await db
    .select({ workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId, preferences: users.preferences, settings: workspaces.settings })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(inArray(workspaceMembers.workspaceId, workspaceIds));
  const done = await db
    .select({ workspaceId: recaps.workspaceId, userId: recaps.userId, scope: recaps.scope })
    .from(recaps)
    .where(and(eq(recaps.kind, YEAR_IN_COFFEE_KIND), eq(recaps.periodStart, period.start), isNotNull(recaps.figures)));
  const key = (ws: string, user: string, scope: RecapScope) => `${ws}|${user}|${scope}`;
  const have = new Set(done.map((d) => key(d.workspaceId, d.userId, d.scope)));
  const own = new Set(brewed.map((b) => key(b.workspaceId, b.userId ?? "", "mine")));

  for (const m of members) {
    const today = zonedNow(now, recapZone(userPreferences(m.preferences ?? null), m.settings)).day;
    if (today < `${year}-${YEAR_OUT_ON}`) continue;
    for (const scope of ["mine", "all"] as const) {
      if (out.frozen + out.failed >= FREEZES_PER_TICK) return out;
      const k = key(m.workspaceId, m.userId, scope);
      if (have.has(k) || (scope === "mine" && !own.has(k))) continue;
      try {
        await freezeYearInCoffee(db, m.workspaceId, m.userId, year, scope, today);
        out.frozen++;
      } catch (err) {
        out.failed++;
        console.error(`Year in Coffee for ${m.userId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return out;
}

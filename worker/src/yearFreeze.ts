// Your Year in Coffee frozen on 7 December (docs/api/recaps.md §11c "Your
// Year in Coffee"): each quarter-hour tick from then to the year's end
// freezes the copies still missing, once the person's own day has reached
// 7 December: "mine" for everyone who brewed from 1 January to 6 December,
// "all" for every member of a workspace someone brewed in. A few per tick, so
// a busy server spreads them out. Opening a year never freezes it. With
// Your Year in Coffee's AI switch on (recapAutoSummaries), its summary is
// written straight after, when the workspace has AI (recapSummary.ts). Its
// push goes on 7 December (processYearInCoffeePush, below).
import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { sendNotification } from "@barista/shared/notify";
import { sendWebPush } from "@barista/shared/webPush";
import { brewLogs, recaps, userPreferences, users, workspaceMembers, workspaces, type RecapScope } from "@barista/shared/schema";
import { freezeYearInCoffee, YEAR_IN_COFFEE_KIND } from "@barista/shared/yearFreeze";
import { YEAR_OUT_ON, yearInCoffeePeriod } from "@barista/shared/yearInCoffee";
import { config } from "./config.js";
import { db } from "./db.js";
import { deliver } from "./reminders.js";
import { autoSummary, recapZone, zonedNow } from "./recaps.js";

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
    const prefs = userPreferences(m.preferences ?? null);
    const today = zonedNow(now, recapZone(prefs, m.settings)).day;
    if (today < `${year}-${YEAR_OUT_ON}`) continue;
    for (const scope of ["mine", "all"] as const) {
      if (out.frozen + out.failed >= FREEZES_PER_TICK) return out;
      const k = key(m.workspaceId, m.userId, scope);
      if (have.has(k) || (scope === "mine" && !own.has(k))) continue;
      try {
        await freezeYearInCoffee(db, m.workspaceId, m.userId, year, scope, today);
        out.frozen++;
        if (prefs.recapAutoSummaries.yearInCoffee) {
          // Only one never asked for: a summary written by hand before the freeze stands.
          const [row] = await db.select({ id: recaps.id, status: recaps.status }).from(recaps).where(and(eq(recaps.workspaceId, m.workspaceId), eq(recaps.userId, m.userId), eq(recaps.kind, YEAR_IN_COFFEE_KIND), eq(recaps.periodStart, period.start), eq(recaps.scope, scope)));
          if (row?.status === "none") await autoSummary(row.id, m.workspaceId);
        }
      } catch (err) {
        out.failed++;
        console.error(`Year in Coffee for ${m.userId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return out;
}

type Send = typeof sendNotification;
type Push = typeof sendWebPush;

// Its push (docs/api/notifications.md §1b, "Recaps"): on 7 December, once
// the person's time reaches recapNotifyTime, one per workspace whose "mine"
// copy is frozen with brews in it, with Your Year in Coffee's push on. The
// row's notifiedAt claims it, so none goes twice. Only that day, as the
// other recaps: the banner stays through December.
export async function processYearInCoffeePush(now: Date = new Date(), send: Send = sendNotification, push: Push = sendWebPush): Promise<{ sent: number; failed: number }> {
  const year = now.getUTCFullYear();
  const out = { sent: 0, failed: 0 };
  const outOn = `${year}-${YEAR_OUT_ON}`;
  // 7 December somewhere: from UTC+14's midnight to UTC−12's end of the day.
  if (now.getTime() + EARLIEST_OFFSET_MS < Date.parse(`${outOn}T00:00:00Z`) || now.getTime() >= Date.parse(`${outOn}T00:00:00Z`) + 36 * 3_600_000) return out;
  const rows = await db
    .select({ id: recaps.id, workspaceId: recaps.workspaceId, userId: recaps.userId, figures: recaps.figures, preferences: users.preferences, settings: workspaces.settings, workspaceName: workspaces.name })
    .from(recaps)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, recaps.workspaceId), eq(workspaceMembers.userId, recaps.userId)))
    .innerJoin(users, eq(users.id, recaps.userId))
    .innerJoin(workspaces, eq(workspaces.id, recaps.workspaceId))
    .where(and(eq(recaps.kind, YEAR_IN_COFFEE_KIND), eq(recaps.periodStart, `${year}-01-01`), eq(recaps.scope, "mine"), isNotNull(recaps.figures), isNull(recaps.notifiedAt)));
  const perPerson = new Map<string, number>();
  for (const r of rows) perPerson.set(r.userId, (perPerson.get(r.userId) ?? 0) + 1);
  for (const r of rows) {
    const prefs = userPreferences(r.preferences ?? null);
    const brews = r.figures?.figures.recap.brews ?? 0;
    if (!prefs.recapPushes.yearInCoffee || brews === 0) continue;
    const local = zonedNow(now, recapZone(prefs, r.settings));
    if (local.day !== outOn || local.time < prefs.recapNotifyTime) continue;
    const [claimed] = await db.update(recaps).set({ notifiedAt: new Date() }).where(and(eq(recaps.id, r.id), isNull(recaps.notifiedAt)));
    if (claimed.affectedRows === 0) continue;
    const text = `Your Year in Coffee is ready: ${brews} ${brews === 1 ? "brew" : "brews"} from 1 January to 6 December.`;
    const unclaim = () => db.update(recaps).set({ notifiedAt: null }).where(eq(recaps.id, r.id));
    try {
      const result = await deliver(
        r.userId,
        {
          title: `Your ${year} in coffee`,
          message: (perPerson.get(r.userId) ?? 0) > 1 ? `${r.workspaceName} · ${text}` : text,
          url: config.appUrl ? `${config.appUrl}/insights/year?year=${year}&ws=${r.workspaceId}` : null,
        },
        send,
        push,
      );
      if (result.status === "sent") out.sent++;
      else await unclaim(); // no channel yet: a later tick that day may have one
    } catch (err) {
      out.failed++;
      await unclaim();
      console.error(`Year in Coffee push for ${r.userId} not sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

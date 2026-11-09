import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { sendNotification } from "@barista/shared/notify";
import { periodLabel, periodOf, previousPeriod, addDays, type RecapKind, type RecapPeriod } from "@barista/shared/recapPeriods";
import { beans, brewers, brewLogs, DEFAULT_PREFERENCES, recaps, users, withDefaults, workspaceMembers, workspaces, type UserPreferences } from "@barista/shared/schema";
import { sendWebPush } from "@barista/shared/webPush";
import { config } from "./config.js";
import { db } from "./db.js";
import { localBrewDate } from "./localDate.js";
import { deliver } from "./reminders.js";

// Recap notifications (docs/api/notifications.md §1b, "Recaps"). Every
// quarter hour the tick looks for people whose local time has reached
// recapNotifyTime on the first day of a new week or month, and sends one
// notification per workspace they brewed in during the period just ended.
// A recaps row (scope "mine") claims each, so none goes twice. Only that
// day: a server down all day skips it (the banner and Insights still have it).

type Send = typeof sendNotification;
type Push = typeof sendWebPush;

// The day and "HH:MM" at that moment in a time zone.
export function zonedNow(now: Date, zone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

const zoneOf = (prefs: UserPreferences): string => prefs.timeZone ?? config.brewTimezone ?? "UTC";

// The periods due now for this person: the one just ended, for each kind
// they get, when today starts a new one and their time has come.
export function recapsDueNow(prefs: UserPreferences, now: Date): Array<{ kind: RecapKind; period: RecapPeriod }> {
  if (!prefs.recaps || !prefs.recapNotify) return [];
  const { day, time } = zonedNow(now, zoneOf(prefs));
  if (time < prefs.recapNotifyTime) return [];
  const kinds: RecapKind[] = prefs.recapPeriods === "both" ? ["weekly", "monthly"] : [prefs.recapPeriods];
  return kinds.flatMap((kind) => {
    const current = periodOf(kind, day, prefs.weekStartsOn);
    return current.start === day ? [{ kind, period: previousPeriod(kind, current, prefs.weekStartsOn) }] : [];
  });
}

interface RecapBrew {
  id: string;
  workspaceId: string;
  workspaceName: string;
  day: string;
  rating: number | null;
  beanName: string;
  brewerName: string | null;
}

// The person's brews in the period, in workspaces they're still in. A brew's
// day is its local date as Insights counts it (docs/api/stats.md §11).
async function brewsIn(userId: string, period: RecapPeriod): Promise<RecapBrew[]> {
  const rows = await db
    .select({
      id: brewLogs.id,
      workspaceId: brewLogs.workspaceId,
      workspaceName: workspaces.name,
      timestamp: brewLogs.timestamp,
      utcOffsetMinutes: brewLogs.utcOffsetMinutes,
      rating: brewLogs.rating,
      beanName: beans.beanName,
      brewerName: brewers.name,
    })
    .from(brewLogs)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, brewLogs.workspaceId), eq(workspaceMembers.userId, userId)))
    .innerJoin(workspaces, eq(workspaces.id, brewLogs.workspaceId))
    .innerJoin(beans, eq(beans.id, brewLogs.beanId))
    .leftJoin(brewers, eq(brewers.id, brewLogs.brewerId))
    // A day either side covers every UTC offset.
    .where(and(eq(brewLogs.userId, userId), gte(brewLogs.timestamp, new Date(`${addDays(period.start, -1)}T00:00:00Z`)), lt(brewLogs.timestamp, new Date(`${addDays(period.end, 2)}T00:00:00Z`))));
  return rows
    .map((r) => ({ ...r, rating: r.rating === null ? null : Number(r.rating), day: localBrewDate(r.timestamp, r.utcOffsetMinutes, null) }))
    .filter((r) => r.day >= period.start && r.day <= period.end)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const stars = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

// "2–8 Nov · 12 brews · avg 3.9 · best 4.5, Kenya Nyeri on the V60".
export function recapMessage(kind: RecapKind, period: RecapPeriod, brews: readonly Pick<RecapBrew, "rating" | "beanName" | "brewerName">[]): string {
  const parts = [periodLabel(kind, period), `${brews.length} ${brews.length === 1 ? "brew" : "brews"}`];
  const rated = brews.filter((b): b is typeof b & { rating: number } => b.rating !== null);
  if (rated.length) {
    parts.push(`avg ${(rated.reduce((n, b) => n + b.rating, 0) / rated.length).toFixed(1)}`);
    const top = Math.max(...rated.map((b) => b.rating));
    const best = rated.filter((b) => b.rating === top).at(-1)!; // the newest of the best
    parts.push(`best ${stars(top)}, ${best.beanName}${best.brewerName ? ` on the ${best.brewerName}` : ""}`);
  }
  return parts.join(" · ");
}

// Takes the send for this period and workspace; false if it's already gone.
async function claim(workspaceId: string, userId: string, kind: RecapKind, periodStart: string): Promise<boolean> {
  await db
    .insert(recaps)
    .values({ id: randomUUID(), workspaceId, userId, kind, periodStart, scope: "mine" })
    .onDuplicateKeyUpdate({ set: { workspaceId } }); // already there: keep it
  const key = and(eq(recaps.workspaceId, workspaceId), eq(recaps.userId, userId), eq(recaps.kind, kind), eq(recaps.periodStart, periodStart), eq(recaps.scope, "mine"));
  const [result] = await db.update(recaps).set({ notifiedAt: new Date(), updatedAt: new Date() }).where(and(key, isNull(recaps.notifiedAt)));
  return result.affectedRows > 0;
}
async function unclaim(workspaceId: string, userId: string, kind: RecapKind, periodStart: string): Promise<void> {
  await db
    .update(recaps)
    .set({ notifiedAt: null })
    .where(and(eq(recaps.workspaceId, workspaceId), eq(recaps.userId, userId), eq(recaps.kind, kind), eq(recaps.periodStart, periodStart), eq(recaps.scope, "mine")));
}

export interface RecapTickResult {
  sent: number;
  failed: number;
}

// One tick. A person or workspace failing doesn't stop the others; a send
// that fails is let go, so the next tick that day tries again.
export async function processRecapTick(now: Date = new Date(), send: Send = sendNotification, push: Push = sendWebPush): Promise<RecapTickResult> {
  const people = await db.select({ id: users.id, preferences: users.preferences }).from(users);
  let sent = 0;
  let failed = 0;
  for (const person of people) {
    const prefs = withDefaults(DEFAULT_PREFERENCES, person.preferences ?? null);
    for (const { kind, period } of recapsDueNow(prefs, now)) {
      try {
        const brews = await brewsIn(person.id, period);
        const byWorkspace = new Map<string, RecapBrew[]>();
        for (const b of brews) byWorkspace.set(b.workspaceId, [...(byWorkspace.get(b.workspaceId) ?? []), b]);
        for (const [workspaceId, list] of byWorkspace) {
          if (!(await claim(workspaceId, person.id, kind, period.start))) continue;
          const text = recapMessage(kind, period, list);
          const query = `kind=${kind}&start=${period.start}&ws=${workspaceId}`;
          try {
            const result = await deliver(
              person.id,
              {
                title: kind === "weekly" ? "Your week in coffee" : "Your month in coffee",
                message: byWorkspace.size > 1 ? `${list[0]!.workspaceName} · ${text}` : text,
                url: config.appUrl ? `${config.appUrl}/insights/recap?${query}` : null,
              },
              send,
              push,
            );
            if (result.status === "sent") sent++;
            else await unclaim(workspaceId, person.id, kind, period.start); // no channel yet: a later tick may have one
          } catch (err) {
            failed++;
            await unclaim(workspaceId, person.id, kind, period.start);
            console.error(`Recap for ${person.id} (${kind} ${period.start}) not sent: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        failed++;
        console.error(`Recap for ${person.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { sent, failed };
}

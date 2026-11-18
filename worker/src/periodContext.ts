// A period of brewing as the AI sees it (docs/api/llm-contract.md §9f): the
// brews in a date range in one workspace (one person's, or everyone's, and
// optionally one bean's, recipe's or brewer's), with the figures for it and
// the period before. Used by recap summaries (docs/api/recaps.md §11c) and
// live Period attachments in chat (docs/api/chat.md §12).
import { brewers, brewLogGuests, brewLogs, brewServings } from "@barista/shared/schema";
import { addDays } from "@barista/shared/recapPeriods";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { drinksServed, flavorsFor, loadBean, marksFor, problemsFor, selectBrews, summarize, toolsFor, withJoins, type BrewSummary, type LoadedBean } from "./context.js";
import { db } from "./db.js";
import { localBrewDate } from "./localDate.js";
import { workspaceZone } from "./zone.js";

// At most this many brews go to the AI, the newest (a year: spread across
// its months, below); the rest are counted.
export const PERIOD_MAX_BREWS = 60;
// A year's month lines name this many beans, recipes and brewers each.
const MONTH_TOP = 3;

export interface PeriodRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string;
}
// A period may be open at the start: all time.
export interface OpenRange {
  start: string | null;
  end: string;
}
export interface PeriodBrew extends BrewSummary {
  day: string; // its local date
  bean: string; // "Roaster – Bean"
  brewer: string | null;
}
export interface PeriodFigures {
  brews: number;
  daysBrewed: number;
  ratedBrews: number;
  averageRating: number | null; // the coffee rating, one decimal
  bestRating: number | null;
  coffeeGrams: number;
  // Brews made at least partly for guests (backlog 67): for named or unnamed
  // guests, or a batch with a serving poured for one. A count only: no names.
  brewsForOthers: number;
  beans: Array<{ bean: string; brews: number }>; // most brewed first
  recipes: Array<{ recipe: string; brews: number }>;
  brewers: Array<{ brewer: string; brews: number }>;
}
export interface PeriodContext {
  kind: "weekly" | "monthly" | "yearly" | "custom";
  period: OpenRange;
  filters: string | null; // what else narrows the brews, in words ("Guji · V60 · Only mine")
  previous: PeriodRange | null;
  figures: PeriodFigures;
  previousFigures: PeriodFigures | null;
  brews: PeriodBrew[]; // newest first, at most PERIOD_MAX_BREWS
  brewsLeftOut: number;
  brewsChosen: "newest" | "spreadAcrossMonths"; // which ones are sent when there are more
  months?: Array<{ month: string } & PeriodFigures>; // yearly: each month with brews, "YYYY-MM", oldest first
  monthlySummaries?: Array<{ month: string; summary: string; highlights: string[] }>; // yearly: the ones written (recapSummary.ts)
  ratingScale: "0.5-5";
}

export interface PeriodQuery {
  workspaceId: string;
  userId: string | null; // null: everyone's in the workspace
  kind: PeriodContext["kind"];
  period: OpenRange;
  previous: PeriodRange | null;
  beanId?: string | null;
  recipeId?: string | null;
  brewerId?: string | null;
  filters?: string | null;
  maxBrews?: number; // brews sent in detail; default PERIOD_MAX_BREWS
}

// A brew's day as Insights counts it (its offset, else UTC; docs/api/stats.md §11).
const dayOf = (b: { timestamp: Date; utcOffsetMinutes: number | null }) => localBrewDate(b.timestamp, b.utcOffsetMinutes, null);

// The finished brews in a range, newest first (a day either side covers any offset).
async function rowsIn(q: PeriodQuery, range: OpenRange) {
  const rows = await selectBrews()
    .where(
      and(
        eq(brewLogs.workspaceId, q.workspaceId),
        q.userId ? eq(brewLogs.userId, q.userId) : undefined,
        q.beanId ? eq(brewLogs.beanId, q.beanId) : undefined,
        q.recipeId ? eq(brewLogs.recipeId, q.recipeId) : undefined,
        q.brewerId ? eq(brewLogs.brewerId, q.brewerId) : undefined,
        eq(brewLogs.steeping, false),
        range.start ? gte(brewLogs.timestamp, new Date(`${addDays(range.start, -1)}T00:00:00Z`)) : undefined,
        lt(brewLogs.timestamp, new Date(`${addDays(range.end, 2)}T00:00:00Z`)),
      ),
    )
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id));
  return rows.map(withJoins).filter((b) => {
    const day = dayOf(b);
    return (range.start === null || day >= range.start) && day <= range.end;
  });
}

function countBy<T>(items: readonly T[], key: (t: T) => string | null): Array<{ key: string; n: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n);
}

type Row = Awaited<ReturnType<typeof rowsIn>>[number];
// The brews among these that had a guest: named ones, or a serving for one.
async function withGuests(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [named, served] = await Promise.all([
    db.selectDistinct({ id: brewLogGuests.brewLogId }).from(brewLogGuests).where(inArray(brewLogGuests.brewLogId, ids)),
    db.selectDistinct({ id: brewServings.brewLogId }).from(brewServings).where(and(inArray(brewServings.brewLogId, ids), eq(brewServings.forGuest, true))),
  ]);
  return new Set([...named, ...served].map((r) => r.id));
}

function figuresOf(rows: readonly Row[], beanLabel: (id: string) => string, brewerName: (id: string | null) => string | null, guested: ReadonlySet<string>): PeriodFigures {
  const rated = rows.flatMap((b) => (b.rating === null ? [] : [Number(b.rating)]));
  return {
    brews: rows.length,
    daysBrewed: new Set(rows.map(dayOf)).size,
    ratedBrews: rated.length,
    averageRating: rated.length ? Math.round((rated.reduce((n, r) => n + r, 0) / rated.length) * 10) / 10 : null,
    bestRating: rated.length ? Math.max(...rated) : null,
    coffeeGrams: Math.round(rows.reduce((n, b) => n + Number(b.actualDoseGrams), 0) * 10) / 10,
    brewsForOthers: rows.filter((b) => !b.forMe || b.unnamedGuests > 0 || guested.has(b.id)).length,
    beans: countBy(rows, (b) => b.beanId).map((c) => ({ bean: beanLabel(c.key), brews: c.n })),
    recipes: countBy(rows, (b) => b.recipeName ?? null).map((c) => ({ recipe: c.key, brews: c.n })),
    brewers: countBy(rows, (b) => brewerName(b.brewerId)).map((c) => ({ brewer: c.key, brews: c.n })),
  };
}

export async function loadPeriodContext(q: PeriodQuery): Promise<PeriodContext> {
  const [rows, previousRows, zone] = await Promise.all([rowsIn(q, q.period), q.previous ? rowsIn(q, q.previous) : Promise.resolve(null), workspaceZone(q.workspaceId)]);
  const all = [...rows, ...(previousRows ?? [])];
  const beanIds = [...new Set(all.map((b) => b.beanId))];
  const brewerIds = [...new Set(all.flatMap((b) => (b.brewerId ? [b.brewerId] : [])))];
  const max = q.maxBrews ?? PERIOD_MAX_BREWS;
  const spread = q.kind === "yearly" && rows.length > max;
  const sent = spread ? spreadAcrossMonths(rows, max) : rows.slice(0, max);
  const ids = sent.map((b) => b.id);
  const [loaded, names, marks, tools, problems, flavors, servedAs, guested] = await Promise.all([
    Promise.all(beanIds.map(loadBean)),
    brewerIds.length ? db.select({ id: brewers.id, name: brewers.name }).from(brewers).where(inArray(brewers.id, brewerIds)) : Promise.resolve([]),
    marksFor(ids),
    toolsFor(ids),
    problemsFor(ids),
    flavorsFor(ids),
    drinksServed(sent.flatMap((b) => (b.drinkId ? [b.drinkId] : []))),
    withGuests(all.map((b) => b.id)),
  ]);
  const beans = new Map<string, LoadedBean>();
  beanIds.forEach((id, i) => {
    const b = loaded[i];
    if (b) beans.set(id, b);
  });
  const beanLabel = (id: string) => {
    const b = beans.get(id)?.info;
    return b ? `${b.roasterName} – ${b.beanName}` : "Unknown bean";
  };
  const brewerById = new Map(names.map((b) => [b.id, b.name]));
  const brewerName = (id: string | null) => (id ? (brewerById.get(id) ?? null) : null);

  return {
    kind: q.kind,
    period: q.period,
    filters: q.filters || null,
    previous: q.previous,
    figures: figuresOf(rows, beanLabel, brewerName, guested),
    previousFigures: previousRows ? figuresOf(previousRows, beanLabel, brewerName, guested) : null,
    brews: sent.map((b) => {
      const bean = beans.get(b.beanId);
      return {
        ...summarize(b, bean?.roastDate ?? null, bean?.freezes ?? [], marks, tools, problems, flavors, servedAs, zone),
        day: dayOf(b),
        bean: beanLabel(b.beanId),
        brewer: brewerName(b.brewerId),
      };
    }),
    brewsLeftOut: Math.max(0, rows.length - max),
    brewsChosen: spread ? "spreadAcrossMonths" : "newest",
    months:
      q.kind === "yearly"
        ? byMonth(rows).map(([month, list]) => {
            const f = figuresOf(list, beanLabel, brewerName, guested);
            return { month, ...f, beans: f.beans.slice(0, MONTH_TOP), recipes: f.recipes.slice(0, MONTH_TOP), brewers: f.brewers.slice(0, MONTH_TOP) };
          })
        : undefined,
    ratingScale: "0.5-5",
  };
}

// Rows (newest first) by local month, oldest month first.
function byMonth<T extends { timestamp: Date; utcOffsetMinutes: number | null }>(rows: readonly T[]): Array<[string, T[]]> {
  const months = new Map<string, T[]>();
  for (const b of rows) {
    const m = dayOf(b).slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), b]);
  }
  return [...months].sort(([a], [b]) => a.localeCompare(b));
}

// A year's brews for the AI when there are more than it gets: an even share
// from each month with brews (a quiet month's spare share goes to the
// others), within a month its best and lowest rated in turn, then the
// newest unrated. Newest first, like the rest.
export function spreadAcrossMonths<T extends { id: string; timestamp: Date; utcOffsetMinutes: number | null; rating: string | number | null }>(rows: readonly T[], max: number): T[] {
  const months = byMonth(rows).map(([, list]) => list);
  const share = new Map<T[], number>(months.map((m) => [m, 0]));
  let left = max;
  // Hand out one at a time round the months until they're full or it's spent.
  while (left > 0) {
    let gave = false;
    for (const m of months) {
      if (left > 0 && share.get(m)! < m.length) {
        share.set(m, share.get(m)! + 1);
        left--;
        gave = true;
      }
    }
    if (!gave) break;
  }
  const chosen = new Set<string>();
  for (const m of months) {
    const n = share.get(m)!;
    const rated = m.filter((b) => b.rating !== null).sort((a, b) => Number(b.rating) - Number(a.rating));
    const picked: T[] = [];
    for (let i = 0, j = rated.length - 1; picked.length < n && i <= j; ) {
      picked.push(rated[i++]!);
      if (picked.length < n && i <= j) picked.push(rated[j--]!);
    }
    for (const b of m) if (picked.length < n && b.rating === null) picked.push(b);
    for (const b of picked) chosen.add(b.id);
  }
  return rows.filter((b) => chosen.has(b.id));
}

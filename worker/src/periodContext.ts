// A period of brewing as the AI sees it (docs/api/llm-contract.md §9f): the
// brews in a date range in one workspace (one person's, or everyone's),
// with the figures for it and the period before. Built for recap summaries
// (docs/api/recaps.md §11c); written to serve a "period" chat attachment too
// (docs/backlog.md 17).
import { brewers, brewLogs } from "@barista/shared/schema";
import { addDays } from "@barista/shared/recapPeriods";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { drinksServed, flavorsFor, loadBean, marksFor, problemsFor, selectBrews, summarize, toolsFor, withJoins, type BrewSummary, type LoadedBean } from "./context.js";
import { db } from "./db.js";
import { localBrewDate } from "./localDate.js";
import { workspaceZone } from "./zone.js";

// At most this many brews go to the AI, the newest; the rest are counted.
export const PERIOD_MAX_BREWS = 60;

export interface PeriodRange {
  start: string; // YYYY-MM-DD, inclusive
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
  beans: Array<{ bean: string; brews: number }>; // most brewed first
  recipes: Array<{ recipe: string; brews: number }>;
  brewers: Array<{ brewer: string; brews: number }>;
}
export interface PeriodContext {
  kind: "weekly" | "monthly" | "custom";
  period: PeriodRange;
  previous: PeriodRange | null;
  figures: PeriodFigures;
  previousFigures: PeriodFigures | null;
  brews: PeriodBrew[]; // newest first, at most PERIOD_MAX_BREWS
  brewsLeftOut: number;
  ratingScale: "0.5-5";
}

export interface PeriodQuery {
  workspaceId: string;
  userId: string | null; // null: everyone's in the workspace
  kind: PeriodContext["kind"];
  period: PeriodRange;
  previous: PeriodRange | null;
}

// A brew's day as Insights counts it (its offset, else UTC; docs/api/stats.md §11).
const dayOf = (b: { timestamp: Date; utcOffsetMinutes: number | null }) => localBrewDate(b.timestamp, b.utcOffsetMinutes, null);

// The finished brews in a range, newest first (a day either side covers any offset).
async function rowsIn(q: PeriodQuery, range: PeriodRange) {
  const rows = await selectBrews()
    .where(
      and(
        eq(brewLogs.workspaceId, q.workspaceId),
        q.userId ? eq(brewLogs.userId, q.userId) : undefined,
        eq(brewLogs.steeping, false),
        gte(brewLogs.timestamp, new Date(`${addDays(range.start, -1)}T00:00:00Z`)),
        lt(brewLogs.timestamp, new Date(`${addDays(range.end, 2)}T00:00:00Z`)),
      ),
    )
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id));
  return rows.map(withJoins).filter((b) => {
    const day = dayOf(b);
    return day >= range.start && day <= range.end;
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
function figuresOf(rows: readonly Row[], beanLabel: (id: string) => string, brewerName: (id: string | null) => string | null): PeriodFigures {
  const rated = rows.flatMap((b) => (b.rating === null ? [] : [Number(b.rating)]));
  return {
    brews: rows.length,
    daysBrewed: new Set(rows.map(dayOf)).size,
    ratedBrews: rated.length,
    averageRating: rated.length ? Math.round((rated.reduce((n, r) => n + r, 0) / rated.length) * 10) / 10 : null,
    bestRating: rated.length ? Math.max(...rated) : null,
    coffeeGrams: Math.round(rows.reduce((n, b) => n + Number(b.actualDoseGrams), 0) * 10) / 10,
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
  const sent = rows.slice(0, PERIOD_MAX_BREWS);
  const ids = sent.map((b) => b.id);
  const [loaded, names, marks, tools, problems, flavors, servedAs] = await Promise.all([
    Promise.all(beanIds.map(loadBean)),
    brewerIds.length ? db.select({ id: brewers.id, name: brewers.name }).from(brewers).where(inArray(brewers.id, brewerIds)) : Promise.resolve([]),
    marksFor(ids),
    toolsFor(ids),
    problemsFor(ids),
    flavorsFor(ids),
    drinksServed(sent.flatMap((b) => (b.drinkId ? [b.drinkId] : []))),
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
    previous: q.previous,
    figures: figuresOf(rows, beanLabel, brewerName),
    previousFigures: previousRows ? figuresOf(previousRows, beanLabel, brewerName) : null,
    brews: sent.map((b) => {
      const bean = beans.get(b.beanId);
      return {
        ...summarize(b, bean?.roastDate ?? null, bean?.freezes ?? [], marks, tools, problems, flavors, servedAs, zone),
        day: dayOf(b),
        bean: beanLabel(b.beanId),
        brewer: brewerName(b.brewerId),
      };
    }),
    brewsLeftOut: Math.max(0, rows.length - PERIOD_MAX_BREWS),
    ratingScale: "0.5-5",
  };
}

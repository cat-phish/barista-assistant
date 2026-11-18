// Your Year in Coffee's figures, counted on the server and frozen on
// 7 December (docs/api/recaps.md §11c "Your Year in Coffee", backlog 65).
// The input is the Insights rows as the API sends them (docs/api/stats.md
// §11, dates as strings), so backend and worker count exactly what a browser
// would. Parity: `recap` counts as the browser's lib/recap.ts recapFigures
// does (the Yearly tab), and a figure added to one is added to the other in
// the same change (CLAUDE.md rule 15; frontend/src/lib/yearInCoffee.parity.test.ts
// holds them to the same results). Only ./recapPeriods is imported, so that
// test can load this file as it is.
import { addDays, type RecapPeriod } from "./recapPeriods.js";

// Bump when a figure is added or changes meaning; the page skips a figure
// an older frozen copy doesn't have.
export const YEAR_FIGURES_VERSION = 2; // 2: topCups replaces bestCupBy
// Out on 7 December, covering 1 January to 6 December.
export const YEAR_OUT_ON = "12-07";
export const YEAR_ENDS_ON = "12-06";
export const yearInCoffeePeriod = (year: number): RecapPeriod => ({ start: `${year}-01-01`, end: `${year}-${YEAR_ENDS_ON}` });
// The latest year on offer: this one from 7 December, else the one before.
export const latestYearInCoffee = (today: string): number => Number(today.slice(0, 4)) - (today.slice(5) >= YEAR_OUT_ON ? 0 : 1);

type RoastLevel = "light" | "medium_light" | "medium" | "medium_dark" | "dark";
type CoffeeSpecies = "arabica" | "robusta" | "liberica" | "excelsa" | "eugenioides";
type ServingUnit = "ml" | "fl_oz";
interface Named {
  id: string;
  name: string;
}

// The parts of the Insights rows (StatsResponse) this counts from.
export interface YearRowsBrew {
  id: string;
  timestamp: string;
  utcOffsetMinutes: number | null;
  userId: string | null;
  beanId: string;
  recipeId: string | null;
  brewerId: string | null;
  drinkId: string | null;
  forMe: boolean;
  guestIds: string[];
  unnamedGuests: number;
  servings: Array<{ guestId: string | null; forGuest: boolean; concentrateGrams: number }>;
  flavors: string[];
  doseGrams: number;
  waterGrams: number | null;
  iceGrams: number | null;
  yieldGrams: number | null;
  servingSize: number | null;
  servingUnit: ServingUnit | null;
  drinkServingSize: number | null;
  drinkServingUnit: ServingUnit | null;
  dilutionRatio: number | null;
  rating: number | null;
}
export interface YearRowsBean {
  id: string;
  roasterName: string;
  beanName: string;
  batchNumber: string | null;
  country: string | null;
  processId: string | null;
  roastLevel: RoastLevel | null;
  varieties: string[] | null;
  species: CoffeeSpecies[] | null;
  decaf: boolean;
  purchaseDate: string | null;
  createdAt: string;
  archivedAt: string | null;
}
export interface YearRows {
  brews: YearRowsBrew[];
  beans: YearRowsBean[];
  lookups: {
    brewers: Array<Named & { groundsRetention: number | null; measured: Array<{ doseGrams: number; waterGrams: number; iceGrams: number | null; yieldGrams: number }> }>;
    recipes: Array<Named & { createdAt: string }>;
    processes: Named[];
    guests: Named[];
  };
}

// ── What it counts (the browser's RecapFigures and YearFigures) ──

export interface RecapBest {
  brewId: string;
  rating: number;
  day: string;
  bean: string;
  recipe: string | null;
  brewer: string | null;
}
export interface RecapFigures {
  brews: number;
  previousBrews: number;
  daysBrewed: number;
  rating: { mean: number; n: number } | null;
  previousRating: number | null;
  best: RecapBest[];
  caffeineMg: number | null;
  volume: { ml: number; estimated: boolean } | null;
  forOthers: { brews: number; ml: number; estimated: boolean; guests: Array<{ name: string; brews: number }> } | null;
  coffeeGrams: number;
  beansBrewed: Array<{ id: string; label: string; brews: number }>;
  beansAdded: Array<{ id: string; label: string }>;
  beansFinished: Array<{ id: string; label: string }>;
  newRecipes: Array<{ id: string; name: string }>;
  topRecipe: { name: string; brews: number } | null;
  topBrewer: { name: string; brews: number } | null;
}
export interface Ranked {
  name: string;
  brews: number;
}
export interface YearFigures {
  year: number;
  recap: RecapFigures;
  months: number[]; // brews per month, January first
  streak: { days: number; start: string; end: string } | null;
  busiestMonth: { month: number; brews: number } | null; // 0 = January
  busiestWeekday: { weekday: number; brews: number } | null; // 0 = Monday
  favouriteHour: { hour: number; brews: number } | null;
  origins: Ranked[];
  originNames: string[];
  roasterNames: string[];
  roasters: Ranked[];
  processes: Ranked[];
  varieties: Ranked[];
  flavors: Ranked[];
  mostImproved: { kind: "recipe" | "bean"; name: string; from: number; to: number; brews: number } | null;
  people: Array<{ userId: string; brews: number }>;
  topCups: TopCups | null;
}
// The cups at the year's top rating: how many, the bean and recipe behind
// most of them (when 2 or more share one), and who brewed most of them
// (when people is shown and one person brewed more than anyone else).
export interface TopCups {
  rating: number;
  brews: number;
  bean: Ranked | null;
  recipe: Ranked | null;
  by: string | null;
}
// A first year someone joined partway through: compared at its pace.
export interface Covered {
  from: string;
  days: number;
  scale: number;
  tooShort: boolean;
}
export type HistoryYear = YearFigures & { covered?: Covered };

export const TOP = 5;
export const MIN_PATTERN_BREWS = 5;
export const MIN_DISTINCT = 2;
export const MIN_IMPROVE_BREWS = 4;
export const MIN_IMPROVEMENT = 0.5;
export const PARTIAL_AFTER = "01-31";
export const MIN_COVERED_DAYS = 30;
const BEST_MAX = 3;
const DAY_MS = 86_400_000;

// ── Helpers, as the browser's lib/stats.ts, shares.ts, caffeine.ts, scale.ts ──

const shifted = (b: Pick<YearRowsBrew, "timestamp" | "utcOffsetMinutes">) => new Date(Date.parse(b.timestamp) + (b.utcOffsetMinutes ?? 0) * 60_000);
export const localDay = (b: Pick<YearRowsBrew, "timestamp" | "utcOffsetMinutes">): string => shifted(b).toISOString().slice(0, 10);
const localHour = (b: YearRowsBrew) => shifted(b).getUTCHours();
const localWeekday = (b: YearRowsBrew) => (shifted(b).getUTCDay() + 6) % 7;
const within = (day: string, p: RecapPeriod) => day >= p.start && day <= p.end;

function countBy<T>(items: readonly T[], keys: (item: T) => string | readonly string[] | null): Array<{ key: string; n: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = keys(item);
    for (const key of k === null ? [] : typeof k === "string" ? [k] : k) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}
function splitCountries(country: string | null): string[] {
  if (!country) return [];
  return [...new Set(country.split(/\s*[,;/&+]\s*/).map((c) => c.trim()).filter(Boolean))];
}
const beanLabel = (b: Pick<YearRowsBean, "roasterName" | "beanName" | "batchNumber">) => `${b.roasterName} – ${b.beanName}${b.batchNumber ? ` · Batch ${b.batchNumber}` : ""}`;

const ME = "me";
const UNNAMED = "unnamed";
function brewShares(b: YearRowsBrew): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string, n: number) => out.set(k, (out.get(k) ?? 0) + n);
  const poured = b.servings.reduce((n, s) => n + s.concentrateGrams, 0);
  if (poured > 0) {
    for (const s of b.servings) add(s.forGuest ? (s.guestId ?? UNNAMED) : ME, s.concentrateGrams / poured);
    return out;
  }
  const n = (b.forMe ? 1 : 0) + b.guestIds.length + b.unnamedGuests;
  if (n === 0) return out.set(ME, 1);
  if (b.forMe) add(ME, 1 / n);
  for (const g of b.guestIds) add(g, 1 / n);
  if (b.unnamedGuests) add(UNNAMED, b.unnamedGuests / n);
  return out;
}
const myShare = (b: YearRowsBrew) => brewShares(b).get(ME) ?? 0;

const SPECIES_CAFFEINE: Record<CoffeeSpecies, number> = { arabica: 0.012, robusta: 0.022, liberica: 0.012, excelsa: 0.011, eugenioides: 0.006 };
function caffeineMg(b: YearRowsBrew, bean: YearRowsBean | undefined): number {
  const species = bean?.species?.length ? bean.species : (["arabica"] as const);
  const share = species.reduce((sum, s) => sum + SPECIES_CAFFEINE[s], 0) / species.length;
  return b.doseGrams * 1000 * share * (b.waterGrams === null ? 0.8 : 0.9) * (bean?.decaf ? 0.03 : 1);
}

const ROAST_RETENTION: Record<RoastLevel, number> = { light: 2.0, medium_light: 2.05, medium: 2.1, medium_dark: 2.2, dark: 2.3 };
const GRAMS_PER_FL_OZ = 29.5735;
const ratioWater = (water: number, ice: number | null) => Math.round((water + (ice ?? 0)) * 100) / 100;
function brewerRetentions(brewers: YearRows["lookups"]["brewers"]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of brewers) {
    if (b.groundsRetention !== null) {
      out.set(b.id, b.groundsRetention);
      continue;
    }
    const rs = b.measured
      .map((m) => (m.doseGrams > 0 ? (ratioWater(m.waterGrams, m.iceGrams) - m.yieldGrams) / m.doseGrams : null))
      .filter((r): r is number => r !== null && r >= 0.5 && r <= 3.5)
      .sort((x, y) => x - y);
    if (!rs.length) continue;
    const mid = Math.floor(rs.length / 2);
    out.set(b.id, rs.length % 2 ? rs[mid]! : (rs[mid - 1]! + rs[mid]!) / 2);
  }
  return out;
}
function brewVolumeMl(b: YearRowsBrew, roastLevel: RoastLevel | null, recipeRoastLevel: RoastLevel, retention: number | null): { ml: number; estimate: boolean } | null {
  const toMl = (size: number, unit: ServingUnit) => (unit === "fl_oz" ? size * GRAMS_PER_FL_OZ : size);
  if (b.servingSize !== null && b.servingUnit) return { ml: toMl(b.servingSize, b.servingUnit), estimate: false };
  if (b.drinkId && b.drinkServingSize !== null && b.drinkServingUnit) return { ml: toMl(b.drinkServingSize, b.drinkServingUnit), estimate: false };
  const dilute = (ml: number) => ml * (1 + (b.dilutionRatio ?? 0));
  if (b.yieldGrams !== null) return { ml: dilute(b.yieldGrams), estimate: false };
  const water = ratioWater(b.waterGrams ?? 0, b.iceGrams);
  if (!(water > 0)) return null;
  const r = retention ?? ROAST_RETENTION[roastLevel ?? recipeRoastLevel];
  return { ml: dilute(Math.max(0, Math.round(water - r * b.doseGrams))), estimate: true };
}

// ── The year as a recap counts it (the browser's recapFigures) ──

export function recapFigures(data: YearRows, previous: YearRows | null, period: RecapPeriod, recipeRoastLevel: RoastLevel, today: string): RecapFigures {
  const brews = data.brews.filter((b) => within(localDay(b), period));
  const bean = (id: string) => data.beans.find((b) => b.id === id);
  const name = (list: readonly Named[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? null) : null);
  const label = (id: string) => {
    const b = bean(id);
    return b ? beanLabel(b) : "Unknown bean";
  };

  const rated = brews.filter((b) => b.rating !== null);
  const mean = (list: readonly YearRowsBrew[]) => (list.length ? list.reduce((n, b) => n + b.rating!, 0) / list.length : null);
  const prevRated = (previous?.brews ?? []).filter((b) => b.rating !== null);
  const top = rated.length ? Math.max(...rated.map((b) => b.rating!)) : null;
  const best = rated
    .filter((b) => b.rating === top)
    .slice(-BEST_MAX)
    .reverse()
    .map((b) => ({ brewId: b.id, rating: b.rating!, day: localDay(b), bean: label(b.beanId), recipe: name(data.lookups.recipes, b.recipeId), brewer: name(data.lookups.brewers, b.brewerId) }));

  const retentions = brewerRetentions(data.lookups.brewers);
  const volumeOf = (b: YearRowsBrew) => brewVolumeMl(b, bean(b.beanId)?.roastLevel ?? null, recipeRoastLevel, b.brewerId ? (retentions.get(b.brewerId) ?? null) : null);
  const drunk = brews.flatMap((b) => {
    const v = volumeOf(b);
    const share = myShare(b);
    return v && share > 0 ? [{ ...v, share }] : [];
  });
  const volume = drunk.length ? { ml: drunk.reduce((n, v) => n + v.ml * v.share, 0), estimated: drunk.some((v) => v.estimate) } : null;

  // Caffeine: your share, over the brews you had a share of (caffeine.ts).
  const sipped = brews.filter((b) => myShare(b) > 0);
  const caffeine = brews.length ? sipped.reduce((n, b) => n + caffeineMg(b, bean(b.beanId)) * myShare(b), 0) : null;

  const guestBrews = brews.filter((b) => myShare(b) < 1);
  const guestVolumes = guestBrews.flatMap((b) => {
    const v = volumeOf(b);
    return v ? [{ ...v, share: 1 - myShare(b) }] : [];
  });
  const guestName = (id: string) => data.lookups.guests.find((g) => g.id === id)?.name ?? "Removed guest";
  const guestCounts = countBy(guestBrews, (b) => [...brewShares(b).keys()].filter((k) => k !== ME));
  const forOthers = guestBrews.length
    ? {
        brews: guestBrews.length,
        ml: guestVolumes.reduce((n, v) => n + v.ml * v.share, 0),
        estimated: guestVolumes.some((v) => v.estimate),
        guests: [...guestCounts.filter((c) => c.key !== UNNAMED).map((c) => ({ name: guestName(c.key), brews: c.n })), ...guestCounts.filter((c) => c.key === UNNAMED).map((c) => ({ name: "Other guests", brews: c.n }))],
      }
    : null;

  const top1 = (counts: Array<{ key: string; n: number }>, list: readonly Named[]) => {
    const c = counts[0];
    return c ? { name: name(list, c.key) ?? "Unknown", brews: c.n } : null;
  };
  const day = (iso: string) => iso.slice(0, 10);
  void today; // the browser caps the caffeine's days with it; the total doesn't need it

  return {
    brews: brews.length,
    previousBrews: previous?.brews.length ?? 0,
    daysBrewed: new Set(brews.map(localDay)).size,
    rating: rated.length ? { mean: mean(rated)!, n: rated.length } : null,
    previousRating: mean(prevRated),
    best,
    caffeineMg: caffeine,
    volume,
    forOthers,
    coffeeGrams: brews.reduce((n, b) => n + b.doseGrams, 0),
    beansBrewed: countBy(brews, (b) => b.beanId).map((c) => ({ id: c.key, label: label(c.key), brews: c.n })),
    beansAdded: data.beans.filter((b) => within(b.purchaseDate ?? day(b.createdAt), period)).map((b) => ({ id: b.id, label: beanLabel(b) })),
    beansFinished: data.beans.filter((b) => b.archivedAt !== null && within(day(b.archivedAt), period)).map((b) => ({ id: b.id, label: beanLabel(b) })),
    newRecipes: data.lookups.recipes.filter((r) => within(day(r.createdAt), period)).map((r) => ({ id: r.id, name: r.name })),
    topRecipe: top1(countBy(brews, (b) => b.recipeId), data.lookups.recipes),
    topBrewer: top1(countBy(brews, (b) => b.brewerId), data.lookups.brewers),
  };
}

// ── What only a year has ──

// data: rows up to the period's end; previous: the year before's, same dates.
export function yearFigures(data: YearRows, previous: YearRows | null, period: RecapPeriod, recipeRoastLevel: RoastLevel, today: string): YearFigures {
  const year = Number(period.start.slice(0, 4));
  const recap = recapFigures(data, previous, period, recipeRoastLevel, today);
  const brews = data.brews.filter((b) => within(localDay(b), period));
  const bean = (id: string) => data.beans.find((b) => b.id === id);
  const named = (list: readonly Named[], id: string) => list.find((x) => x.id === id)?.name ?? null;
  const ranked = (keys: (b: YearRowsBrew) => string | readonly string[] | null, name: (key: string) => string | null = (k) => k): Ranked[] => {
    const counts = countBy(brews, keys).flatMap((c) => {
      const n = name(c.key);
      return n ? [{ name: n, brews: c.n }] : [];
    });
    return counts.length >= MIN_DISTINCT ? counts.slice(0, TOP) : [];
  };
  const folded = (values: readonly string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

  const months = Array.from({ length: 12 }, () => 0);
  for (const b of brews) months[Number(localDay(b).slice(5, 7)) - 1]! += 1;
  const patterns = brews.length >= MIN_PATTERN_BREWS;
  const month = months.reduce((best, n, i) => (n > months[best]! ? i : best), 0);
  const weekday = countBy(brews, (b) => String(localWeekday(b)))[0];
  const hour = countBy(brews, (b) => String(localHour(b)).padStart(2, "0"))[0];
  const userCounts = countBy(brews, (b) => b.userId);
  const people = userCounts.length >= 2 ? userCounts.map((c) => ({ userId: c.key, brews: c.n })) : [];
  const ratings = brews.flatMap((b) => (b.rating === null ? [] : [b.rating]));
  const top = ratings.length ? Math.max(...ratings) : null;
  const cups = brews.filter((b) => b.rating === top);
  const most = (keys: (b: YearRowsBrew) => string | null, name: (key: string) => string | null): Ranked | null => {
    const c = countBy(cups, keys)[0];
    const n = c && c.n >= 2 ? name(c.key) : null;
    return n && c ? { name: n, brews: c.n } : null;
  };
  const leader = (counts: Array<{ key: string; n: number }>) => (counts[0] && counts[0].n > (counts[1]?.n ?? 0) ? counts[0].key : null);
  const topCups: TopCups | null =
    top === null
      ? null
      : {
          rating: top,
          brews: cups.length,
          bean: most(
            (b) => b.beanId,
            (id) => {
              const b = bean(id);
              return b ? beanLabel(b) : null;
            },
          ),
          recipe: most(
            (b) => b.recipeId,
            (id) => named(data.lookups.recipes, id),
          ),
          by: people.length ? leader(countBy(cups, (b) => b.userId)) : null,
        };

  return {
    year,
    recap,
    months,
    streak: longestStreak(brews.map(localDay)),
    busiestMonth: patterns && months.filter((n) => n > 0).length >= 2 ? { month, brews: months[month]! } : null,
    busiestWeekday: patterns && weekday ? { weekday: Number(weekday.key), brews: weekday.n } : null,
    favouriteHour: patterns && hour ? { hour: Number(hour.key), brews: hour.n } : null,
    origins: ranked((b) => splitCountries(bean(b.beanId)?.country ?? null)),
    originNames: countBy(brews, (b) => splitCountries(bean(b.beanId)?.country ?? null)).map((c) => c.key),
    roasterNames: countBy(brews, (b) => folded([bean(b.beanId)?.roasterName ?? ""])).map((c) => c.key),
    roasters: ranked((b) => folded([bean(b.beanId)?.roasterName ?? ""])),
    processes: ranked(
      (b) => bean(b.beanId)?.processId ?? null,
      (id) => named(data.lookups.processes, id),
    ),
    varieties: ranked((b) => folded(bean(b.beanId)?.varieties ?? [])),
    flavors: ranked((b) => folded(b.flavors)),
    mostImproved: mostImproved(brews, data),
    people,
    topCups,
  };
}

export function longestStreak(days: readonly string[]): YearFigures["streak"] {
  const sorted = [...new Set(days)].sort();
  let best: YearFigures["streak"] = null;
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === addDays(sorted[i - 1]!, 1)) continue;
    const n = i - start;
    if (n >= 2 && (!best || n > best.days)) best = { days: n, start: sorted[start]!, end: sorted[i - 1]! };
    start = i;
  }
  return best;
}

function mostImproved(brews: readonly YearRowsBrew[], data: YearRows): YearFigures["mostImproved"] {
  const rated = brews.filter((b) => b.rating !== null).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const mean = (list: readonly YearRowsBrew[]) => list.reduce((n, b) => n + b.rating!, 0) / list.length;
  let best: YearFigures["mostImproved"] = null;
  const consider = (kind: "recipe" | "bean", key: (b: YearRowsBrew) => string | null, name: (id: string) => string | null) => {
    const groups = new Map<string, YearRowsBrew[]>();
    for (const b of rated) {
      const k = key(b);
      if (k) groups.set(k, [...(groups.get(k) ?? []), b]);
    }
    for (const [id, list] of groups) {
      if (list.length < MIN_IMPROVE_BREWS) continue;
      const half = Math.floor(list.length / 2);
      const from = mean(list.slice(0, half));
      const to = mean(list.slice(list.length - half));
      const label = name(id);
      if (!label || to - from < MIN_IMPROVEMENT) continue;
      if (!best || to - from > best.to - best.from || (to - from === best.to - best.from && list.length > best.brews)) best = { kind, name: label, from, to, brews: list.length };
    }
  };
  consider(
    "recipe",
    (b) => b.recipeId,
    (id) => data.lookups.recipes.find((r) => r.id === id)?.name ?? null,
  );
  consider(
    "bean",
    (b) => b.beanId,
    (id) => {
      const b = data.beans.find((x) => x.id === id);
      return b ? beanLabel(b) : null;
    },
  );
  return best;
}

// Every earlier year with brews, newest first, each cut to the same dates
// (1 January to 6 December). The earliest is partial when its first brew is
// after PARTIAL_AFTER.
export function yearHistory(data: YearRows, year: number, recipeRoastLevel: RoastLevel, today: string): HistoryYear[] {
  const days = data.brews.map(localDay);
  const first = days.reduce((min, d) => (d < min ? d : min), `${year}`);
  const firstYear = Number(first.slice(0, 4));
  const span = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  const out: HistoryYear[] = [];
  for (let y = year - 1; y >= firstYear; y--) {
    const period = yearInCoffeePeriod(y);
    const rows = { ...data, brews: data.brews.filter((_, i) => within(days[i]!, period)) };
    if (!rows.brews.length) continue;
    const f: HistoryYear = yearFigures(rows, null, period, recipeRoastLevel, today);
    if (y === firstYear && first > `${y}-${PARTIAL_AFTER}`) {
      const covered = span(first, period.end);
      f.covered = { from: first, days: covered, scale: span(period.start, period.end) / covered, tooShort: covered < MIN_COVERED_DAYS };
    }
    out.push(f);
  }
  return out;
}

// What's frozen: the year's figures and the earlier years' to compare with.
export interface FrozenYear {
  version: number;
  period: RecapPeriod;
  figures: YearFigures;
  history: HistoryYear[];
}
// all: every row up to the year's end (1 January–6 December; earlier years too).
export function freezeYear(all: YearRows, year: number, recipeRoastLevel: RoastLevel, today: string): FrozenYear {
  const period = yearInCoffeePeriod(year);
  const before = yearInCoffeePeriod(year - 1);
  const previous = { ...all, brews: all.brews.filter((b) => within(localDay(b), before)) };
  return { version: YEAR_FIGURES_VERSION, period, figures: yearFigures(all, previous, period, recipeRoastLevel, today), history: yearHistory(all, year, recipeRoastLevel, today) };
}

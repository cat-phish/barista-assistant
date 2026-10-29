// The Insights page's sums, worked out from the rows of docs/api/stats.md §11
// ("How the client counts" there is the rule this file follows).
import type { RoastLevel, StatsBean, StatsBrew } from '../api/types';
import { extractionYield } from './extraction';
import { effectiveRoastAge } from './roastAge';
import { estimateYield, ratioWater, ROAST_LEVELS } from './scale';
import { toMl } from './servings';

const DAY_MS = 86_400_000;

// The brew's local date and time: shifted by its device's offset, UTC when unknown (as the API filters).
function localShifted(brew: Pick<StatsBrew, 'timestamp' | 'utcOffsetMinutes'>): Date {
  return new Date(Date.parse(brew.timestamp) + (brew.utcOffsetMinutes ?? 0) * 60_000);
}
export const localDay = (brew: Pick<StatsBrew, 'timestamp' | 'utcOffsetMinutes'>): string => localShifted(brew).toISOString().slice(0, 10);
export const localHour = (brew: Pick<StatsBrew, 'timestamp' | 'utcOffsetMinutes'>): number => localShifted(brew).getUTCHours();
// 0 = Monday … 6 = Sunday.
export const localWeekday = (brew: Pick<StatsBrew, 'timestamp' | 'utcOffsetMinutes'>): number => (localShifted(brew).getUTCDay() + 6) % 7;

export type VolumeSource = 'serving' | 'measured' | 'estimate';

// What was drunk, in ml (1 g ≈ 1 ml): a drink's size, else the measured
// yield, else the estimate from the roast-level retention; diluted if served so.
export function brewVolumeMl(
  brew: StatsBrew,
  roastLevel: RoastLevel | null,
  recipeRoastLevel: RoastLevel,
): { ml: number; source: VolumeSource } | null {
  const size = brew.servingSize !== null && brew.servingUnit ? { size: brew.servingSize, unit: brew.servingUnit } : null;
  const drinkSize = brew.drinkId && brew.drinkServingSize !== null && brew.drinkServingUnit ? { size: brew.drinkServingSize, unit: brew.drinkServingUnit } : null;
  const serving = size ?? drinkSize;
  if (serving) return { ml: toMl(serving), source: 'serving' };

  const dilute = (ml: number) => ml * (1 + (brew.dilutionRatio ?? 0));
  if (brew.yieldGrams !== null) return { ml: dilute(brew.yieldGrams), source: 'measured' };
  const water = ratioWater(brew.waterGrams ?? 0, brew.iceGrams);
  if (!(water > 0)) return null;
  const retention = ROAST_LEVELS[roastLevel ?? recipeRoastLevel].retention;
  return { ml: dilute(estimateYield(brew.doseGrams, water, retention)), source: 'estimate' };
}

export function brewEY(brew: StatsBrew): number | null {
  return extractionYield({ tdsPercent: brew.tdsPercent, doseGrams: brew.doseGrams, yieldGrams: brew.yieldGrams, waterGrams: brew.waterGrams, style: brew.brewsLike });
}

// Roast age in days on the brew's local date, frozen days left out; null without a roast date.
export function brewRoastAge(brew: StatsBrew, bean: Pick<StatsBean, 'roastDate' | 'freezes'> | undefined): number | null {
  return bean?.roastDate ? effectiveRoastAge(bean.roastDate, bean.freezes, localDay(brew)).ageDays : null;
}

export type FreezeState = 'frozen' | 'thawed' | 'fresh';
export function freezeState(bean: Pick<StatsBean, 'freezes'>): FreezeState {
  if (bean.freezes.some((f) => f.thawedOn === null)) return 'frozen';
  return bean.freezes.length ? 'thawed' : 'fresh';
}

// In stock and not archived.
export const isAvailable = (bean: Pick<StatsBean, 'archivedAt' | 'inventoryWeightGrams'>): boolean =>
  bean.archivedAt === null && bean.inventoryWeightGrams > 0;

// "Colombia, Ethiopia" / "Kenya & Rwanda" (not "and": Trinidad and Tobago) → each country once, trimmed.
export function splitCountries(country: string | null): string[] {
  if (!country) return [];
  const parts = country.split(/\s*[,;/&+]\s*/).map((c) => c.trim()).filter(Boolean);
  return [...new Set(parts)];
}

// The day a bean counts as bought: its purchase date, else the day it was added.
export const boughtOn = (bean: Pick<StatsBean, 'purchaseDate' | 'createdAt'>): string => bean.purchaseDate ?? bean.createdAt.slice(0, 10);

// Bag prices per currency, for beans bought in the range (inclusive; open ends allowed). Never converted.
export function spendByCurrency(beans: readonly StatsBean[], from?: string, to?: string): Array<{ currency: string; amount: number; bags: number }> {
  const sums = new Map<string, { amount: number; bags: number }>();
  for (const b of beans) {
    if (b.priceAmount === null || !b.priceCurrency) continue;
    const day = boughtOn(b);
    if ((from && day < from) || (to && day > to)) continue;
    const s = sums.get(b.priceCurrency) ?? { amount: 0, bags: 0 };
    sums.set(b.priceCurrency, { amount: Math.round((s.amount + b.priceAmount) * 100) / 100, bags: s.bags + 1 });
  }
  return [...sums].map(([currency, s]) => ({ currency, ...s })).sort((a, b) => b.bags - a.bags || a.currency.localeCompare(b.currency));
}

// Longest run of consecutive local days with a brew.
export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const d of sorted) {
    const t = Date.parse(d);
    run = t - prev === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

// ── Time buckets ──

export type Granularity = 'day' | 'week' | 'month';

// Up to ~3 months by day, ~1.5 years by week, longer by month.
export function pickGranularity(from: string, to: string): Granularity {
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  return days <= 92 ? 'day' : days <= 550 ? 'week' : 'month';
}

// The bucket a day falls in: itself, its week's Monday, or the 1st of its month.
export function bucketOf(day: string, g: Granularity): string {
  if (g === 'day') return day;
  if (g === 'month') return `${day.slice(0, 7)}-01`;
  const t = Date.parse(day);
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

// Every bucket from `from` to `to`, so quiet days show as zero rather than a gap.
export function bucketRange(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let cur = bucketOf(from, g);
  const last = bucketOf(to, g);
  while (cur <= last) {
    out.push(cur);
    const d = new Date(Date.parse(cur));
    if (g === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (g === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return out;
}

// One value per bucket: the sum of `value` over its brews (count when omitted).
export function sumByBucket(brews: readonly StatsBrew[], buckets: readonly string[], g: Granularity, value: (b: StatsBrew) => number | null = () => 1): number[] {
  const index = new Map(buckets.map((k, i) => [k, i]));
  const sums = buckets.map(() => 0);
  for (const b of brews) {
    const i = index.get(bucketOf(localDay(b), g));
    const v = value(b);
    if (i !== undefined && v !== null) sums[i]! += v;
  }
  return sums;
}

// The mean of `value` per bucket; null where no brew has one.
export function meanByBucket(brews: readonly StatsBrew[], buckets: readonly string[], g: Granularity, value: (b: StatsBrew) => number | null): Array<number | null> {
  const totals = sumByBucket(brews, buckets, g, value);
  const counts = sumByBucket(brews, buckets, g, (b) => (value(b) === null ? null : 1));
  return totals.map((t, i) => (counts[i] ? Math.round((t / counts[i]!) * 100) / 100 : null));
}

export function cumulative(values: readonly number[], start = 0): number[] {
  let run = start;
  return values.map((v) => (run += v));
}

// ── Groups ──

// How many items fall under each key (an item with several keys counts under each), most first.
export function countBy<T>(items: readonly T[], keys: (item: T) => string | readonly string[] | null): Array<{ key: string; n: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = keys(item);
    for (const key of k === null ? [] : typeof k === 'string' ? [k] : k) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

// The mean of `value` under each key, with how many items it's from; highest mean first.
export function meanBy<T>(items: readonly T[], keys: (item: T) => string | readonly string[] | null, value: (item: T) => number | null): Array<{ key: string; mean: number; n: number }> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const item of items) {
    const v = value(item);
    const k = keys(item);
    if (v === null || k === null) continue;
    for (const key of typeof k === 'string' ? [k] : k) {
      const s = sums.get(key) ?? { total: 0, n: 0 };
      sums.set(key, { total: s.total + v, n: s.n + 1 });
    }
  }
  return [...sums]
    .map(([key, s]) => ({ key, mean: Math.round((s.total / s.n) * 100) / 100, n: s.n }))
    .sort((a, b) => b.mean - a.mean || b.n - a.n || a.key.localeCompare(b.key));
}

// The slice the long tail folds into (charts draw it grey).
export const OTHER = 'Other';

// The biggest `keep` slices, the rest folded into one "Other" slice.
export function topWithOther(counts: ReadonlyArray<{ key: string; n: number }>, keep = 7, other = OTHER): Array<{ key: string; n: number }> {
  if (counts.length <= keep + 1) return [...counts];
  const rest = counts.slice(keep).reduce((sum, c) => sum + c.n, 0);
  return [...counts.slice(0, keep), { key: other, n: rest }];
}

// ── Formatting ──

// A long total: "2 h 05 min", "12 min", "45 s".
export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return m ? `${m} min` : `${Math.round(totalSec)} s`;
}

// Coffee used: "850 g", "1.24 kg".
export function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
}

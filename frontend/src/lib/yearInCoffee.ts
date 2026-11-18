// Your Year in Coffee (backlog 65, docs/api/recaps.md §11c "Your Year in
// Coffee"): one calendar year of brews, counted from the Insights rows as a
// recap counts them, plus what only a year has: streaks, busiest times, top
// origins and flavors, the most improved recipe or bean, and, for the bar's
// year, who brewed. A figure without enough behind it is null or empty, so
// the slides skip its card rather than show "1 origin".
import type { RoastLevel, StatsBrew, StatsData } from '../api/types';
import { beanLabel } from './beans';
import { recapFigures, type RecapFigures } from './recap';
import { addDays, type RecapPeriod } from './recapPeriods';
import { countBy, localDay, localHour, localWeekday, splitCountries } from './stats';

export interface Ranked {
  name: string;
  brews: number;
}
export interface YearFigures {
  year: number;
  recap: RecapFigures; // the year as a recap counts it, next to the year before
  months: number[]; // brews per month, January first
  streak: { days: number; start: string; end: string } | null; // the longest run of days brewed, 2 or more
  busiestMonth: { month: number; brews: number } | null; // 0 = January
  busiestWeekday: { weekday: number; brews: number } | null; // 0 = Monday
  favouriteHour: { hour: number; brews: number } | null; // local, 0–23
  origins: Ranked[];
  originNames: string[]; // every origin brewed, for "new to you" (yearCompare.ts)
  roasterNames: string[];
  roasters: Ranked[];
  processes: Ranked[];
  varieties: Ranked[];
  flavors: Ranked[];
  mostImproved: { kind: 'recipe' | 'bean'; name: string; from: number; to: number; brews: number } | null;
  people: Array<{ userId: string; brews: number }>; // most brews first; empty unless 2 or more people brewed
  bestCupBy: string | null; // whose brew the newest best cup was, when people is shown
}

export const TOP = 5; // entries per ranked list
export const MIN_PATTERN_BREWS = 5; // busiest month, weekday and hour need this many brews
export const MIN_DISTINCT = 2; // a ranked list needs this many different entries
export const MIN_IMPROVE_BREWS = 4; // rated brews of a recipe or bean to compare its halves
export const MIN_IMPROVEMENT = 0.5; // half a star, early half to late half

// The latest year on offer: this one "so far" from 1 December, else the one
// just ended. It's also the year shown when none is asked for.
export const latestYear = (today: string): number => Number(today.slice(0, 4)) - (today.slice(5, 7) === '12' ? 0 : 1);
export const yearPeriod = (year: number): RecapPeriod => ({ start: `${year}-01-01`, end: `${year}-12-31` });

// data: the year's rows (and the year before's in previous, for "vs last
// year"); today caps the caffeine's days, as Insights does.
export function yearFigures(data: StatsData, previous: StatsData | null, year: number, recipeRoastLevel: RoastLevel, today: string): YearFigures {
  const period = yearPeriod(year);
  const recap = recapFigures(data, previous, period, recipeRoastLevel, today);
  const brews = data.brews.filter((b) => {
    const d = localDay(b);
    return d >= period.start && d <= period.end;
  });
  const bean = (id: string) => data.beans.find((b) => b.id === id);
  const named = (list: ReadonlyArray<{ id: string; name: string }>, id: string) => list.find((x) => x.id === id)?.name ?? null;
  const ranked = (keys: (b: StatsBrew) => string | readonly string[] | null, name: (key: string) => string | null = (k) => k): Ranked[] => {
    const counts = countBy(brews, keys).flatMap((c) => {
      const n = name(c.key);
      return n ? [{ name: n, brews: c.n }] : [];
    });
    return counts.length >= MIN_DISTINCT ? counts.slice(0, TOP) : [];
  };
  // Free-text names (roasters, varieties, flavors): trimmed, each once per brew.
  const folded = (values: readonly string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

  const months = Array.from({ length: 12 }, () => 0);
  for (const b of brews) months[Number(localDay(b).slice(5, 7)) - 1]! += 1;
  const patterns = brews.length >= MIN_PATTERN_BREWS;
  const month = months.reduce((best, n, i) => (n > months[best]! ? i : best), 0);
  const weekday = countBy(brews, (b) => String(localWeekday(b)))[0];
  const hour = countBy(brews, (b) => String(localHour(b)).padStart(2, '0'))[0];

  const userCounts = countBy(brews, (b) => b.userId);
  const people = userCounts.length >= 2 ? userCounts.map((c) => ({ userId: c.key, brews: c.n })) : [];
  const bestId = recap.best[0]?.brewId;

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
    roasterNames: countBy(brews, (b) => folded([bean(b.beanId)?.roasterName ?? ''])).map((c) => c.key),
    roasters: ranked((b) => folded([bean(b.beanId)?.roasterName ?? ''])),
    processes: ranked(
      (b) => bean(b.beanId)?.processId ?? null,
      (id) => named(data.lookups.processes, id),
    ),
    varieties: ranked((b) => folded(bean(b.beanId)?.varieties ?? [])),
    flavors: ranked((b) => folded(b.flavors)),
    mostImproved: mostImproved(brews, data),
    people,
    bestCupBy: people.length && bestId ? (brews.find((b) => b.id === bestId)?.userId ?? null) : null,
  };
}

// The longest run of consecutive days in a list of local days.
export function longestStreak(days: readonly string[]): YearFigures['streak'] {
  const sorted = [...new Set(days)].sort();
  let best: YearFigures['streak'] = null;
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === addDays(sorted[i - 1]!, 1)) continue;
    const days = i - start;
    if (days >= 2 && (!best || days > best.days)) best = { days, start: sorted[start]!, end: sorted[i - 1]! };
    start = i;
  }
  return best;
}

// The recipe or bean whose rating rose most from its early brews to its
// late ones (the first half of its rated brews against the last half).
function mostImproved(brews: readonly StatsBrew[], data: StatsData): YearFigures['mostImproved'] {
  const rated = brews.filter((b) => b.rating !== null).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const mean = (list: readonly StatsBrew[]) => list.reduce((n, b) => n + b.rating!, 0) / list.length;
  let best: YearFigures['mostImproved'] = null;
  const consider = (kind: 'recipe' | 'bean', key: (b: StatsBrew) => string | null, name: (id: string) => string | null) => {
    const groups = new Map<string, StatsBrew[]>();
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
    'recipe',
    (b) => b.recipeId,
    (id) => data.lookups.recipes.find((r) => r.id === id)?.name ?? null,
  );
  consider(
    'bean',
    (b) => b.beanId,
    (id) => {
      const b = data.beans.find((x) => x.id === id);
      return b ? beanLabel(b) : null;
    },
  );
  return best;
}

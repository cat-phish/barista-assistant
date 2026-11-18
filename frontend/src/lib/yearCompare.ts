// Your Year in Coffee compared with earlier years (backlog 65,
// docs/api/recaps.md §11c "Compared with earlier years"): last year, your
// average year, and a record when the year beats every earlier one.
import type { RoastLevel, StatsData } from '../api/types';
import { localDay } from './stats';
import { yearFigures, type YearFigures } from './yearInCoffee';

export interface Chip {
  dir: 'up' | 'down' | 'same';
  text: string;
  record?: boolean;
}
export type CompareKind = 'percent' | 'count' | 'days' | 'stars';

export const MIN_COMPARE_BREWS = 5; // an earlier year needs this many brews to compare with
export const SAME_BAND = 0.02; // within ±2% is "about the same"
export const MIN_AVERAGE_YEARS = 2; // an average or a record needs this many earlier years

// The figures of every earlier year with brews, newest first. With cutoff
// ("MM-DD", for the year in progress) each is cut to the same dates.
export function yearHistory(data: StatsData, year: number, recipeRoastLevel: RoastLevel, today: string, cutoff: string | null): YearFigures[] {
  const days = data.brews.map(localDay);
  const first = days.reduce((min, d) => (d < min ? d : min), `${year}`);
  const out: YearFigures[] = [];
  for (let y = year - 1; y >= Number(first.slice(0, 4)); y--) {
    const end = cutoff ? `${y}-${cutoff}` : `${y}-12-31`;
    const rows = { ...data, brews: data.brews.filter((_, i) => days[i]! >= `${y}-01-01` && days[i]! <= end) };
    if (rows.brews.length) out.push(yearFigures(rows, null, y, recipeRoastLevel, today));
  }
  return out;
}

export interface Earlier {
  year: number;
  value: number | null; // null or 0: nothing to compare
  brews: number;
}

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');

// One comparison: "+5% on 2025", "2.4× an average year", "+3 days on 2025".
export function deltaChip(kind: CompareKind, now: number, then: number, noun: string, suffix = ''): Chip {
  if (kind === 'percent') {
    const ratio = now / then;
    if (Math.abs(ratio - 1) <= SAME_BAND) return { dir: 'same', text: `About the same as ${noun}${suffix}` };
    if (ratio >= 2) return { dir: 'up', text: `${trim(ratio)}× ${noun}${suffix}` };
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    return { dir: ratio > 1 ? 'up' : 'down', text: `${ratio > 1 ? '+' : '−'}${pct}% on ${noun}${suffix}` };
  }
  const diff = kind === 'stars' ? Math.round((now - then) * 10) / 10 : Math.round(now - then);
  if (diff === 0) return { dir: 'same', text: `${kind === 'stars' ? 'About the same' : 'Same'} as ${noun}${suffix}` };
  const unit = kind === 'stars' ? ' ★' : kind === 'days' ? (Math.abs(diff) === 1 ? ' day' : ' days') : '';
  const n = kind === 'stars' ? Math.abs(diff).toFixed(1) : String(Math.abs(diff));
  return { dir: diff > 0 ? 'up' : 'down', text: `${diff > 0 ? '+' : '−'}${n}${unit} on ${noun}${suffix}` };
}

// The chips for one figure: last year, then a record or the average year.
// soFar: the year is in progress, so earlier years were cut to the same dates.
export function compareChips(year: number, now: number | null, earlier: readonly Earlier[], kind: CompareKind, opts: { record?: string; soFar?: boolean; average?: boolean } = {}): Chip[] {
  if (!now) return [];
  const usable = earlier.filter((e): e is Earlier & { value: number } => e.brews >= MIN_COMPARE_BREWS && !!e.value);
  const suffix = opts.soFar ? ' by this date' : '';
  const chips: Chip[] = [];
  const last = usable.find((e) => e.year === year - 1);
  if (last) chips.push(deltaChip(kind, now, last.value, String(last.year), suffix));
  if (usable.length >= MIN_AVERAGE_YEARS) {
    if (opts.record && now > Math.max(...usable.map((e) => e.value))) chips.push({ dir: 'up', text: opts.record, record: true });
    else if (opts.average !== false) chips.push(deltaChip(kind, now, usable.reduce((s, e) => s + e.value, 0) / usable.length, 'an average year', suffix));
  }
  return chips;
}

// Names (origins, roasters) never seen in an earlier year.
export function newToYou(names: readonly string[], history: readonly YearFigures[], pick: (f: YearFigures) => readonly string[]): string[] {
  const seen = new Set(history.flatMap((h) => pick(h).map((n) => n.toLowerCase())));
  return names.filter((n) => !seen.has(n.toLowerCase()));
}

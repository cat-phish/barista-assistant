// The Journal's filters (docs/api/brew-logs.md §6, GET list), kept in the
// URL so Back and reloads keep them. Links from a bean use `?bean=`.
// Only mine is on by default and sits outside the folded filters
// (CLAUDE.md rule 13), so it's written to the URL only when off (`mine=0`).
import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import type { BrewLogQuery, BrewLogStatus } from '../api/brews';
import { RANGES, resolveRange, type RangeKey } from './statsRange';

export const STATUSES: Record<BrewLogStatus, string> = { steeping: 'Steeping', unrated: 'Not rated', unanalyzed: 'Not analyzed' };

export interface JournalFilters {
  bean: string;
  style: string;
  brewer: string;
  recipe: string;
  range: RangeKey;
  from: string; // custom only
  to: string;
  mine: boolean;
  status: BrewLogStatus | '';
}

export const NO_FILTERS: JournalFilters = { bean: '', style: '', brewer: '', recipe: '', range: 'all', from: '', to: '', mine: true, status: '' };

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const isRange = (v: string): v is RangeKey => v in RANGES;
const isStatus = (v: string): v is BrewLogStatus => v in STATUSES;

export function parseJournalQuery(q: LocationQuery): JournalFilters {
  const range = text(q.range);
  const status = text(q.status);
  return {
    bean: text(q.bean),
    style: text(q.style),
    brewer: text(q.brewer),
    recipe: text(q.recipe),
    range: isRange(range) ? range : 'all',
    from: text(q.from),
    to: text(q.to),
    mine: q.mine !== '0',
    status: isStatus(status) ? status : '',
  };
}

// Defaults left out, so a plain Journal link stays `/journal`.
export function toJournalQuery(f: JournalFilters): LocationQueryRaw {
  const q: LocationQueryRaw = {};
  for (const key of ['bean', 'style', 'brewer', 'recipe', 'status'] as const) if (f[key]) q[key] = f[key];
  if (f.range !== 'all') q.range = f.range;
  if (f.range === 'custom') {
    if (f.from) q.from = f.from;
    if (f.to) q.to = f.to;
  }
  if (!f.mine) q.mine = '0';
  return q;
}

// The folded filters only: Only mine isn't one of them.
export const hasFilters = (f: JournalFilters): boolean => Object.keys(toJournalQuery({ ...f, mine: true })).length > 0;

export function toApiQuery(f: JournalFilters, today: string): BrewLogQuery {
  const days = resolveRange({ range: f.range, from: f.from, to: f.to }, today);
  return {
    beanId: f.bean || undefined,
    styleId: f.style || undefined,
    brewerId: f.brewer || undefined,
    recipeId: f.recipe || undefined,
    status: f.status || undefined,
    mine: f.mine || undefined,
    from: days.from ?? undefined,
    to: days.to ?? undefined,
  };
}

// The folded bar's line: "Cold brew · V60 · Last 30 days" (Only mine is shown beside it).
export function journalSummary(f: JournalFilters, name: (id: string) => string | undefined, formatDay: (day: string) => string): string {
  const parts = [f.style, f.brewer, f.recipe, f.bean].filter(Boolean).map((id) => name(id) ?? 'Unknown');
  if (f.range === 'custom' && (f.from || f.to)) parts.push(`${f.from ? formatDay(f.from) : 'the start'} – ${f.to ? formatDay(f.to) : 'today'}`);
  else if (f.range !== 'all' && f.range !== 'custom') parts.push(RANGES[f.range]);
  if (f.status) parts.push(STATUSES[f.status]);
  return parts.length ? parts.join(' · ') : 'All brews';
}

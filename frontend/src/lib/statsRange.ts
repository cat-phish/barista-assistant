// Insights periods: the page's Period filter and an over-time chart's own one
// (docs/roadmap.md, "Insights"). Days are local `YYYY-MM-DD`; null = open.

export const RANGES = { '30d': 'Last 30 days', '90d': 'Last 90 days', '1y': 'Last year', all: 'All time', custom: 'Custom' } as const;
export type RangeKey = keyof typeof RANGES;
const RANGE_DAYS: Partial<Record<RangeKey, number>> = { '30d': 30, '90d': 90, '1y': 365 };

export interface Period {
  range: RangeKey;
  from: string; // custom only
  to: string;
}
export interface DayRange {
  from: string | null;
  to: string | null;
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function daysBefore(day: string, n: number): string {
  return new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);
}

export function resolveRange(p: Period, today: string): DayRange {
  const days = RANGE_DAYS[p.range];
  if (days) return { from: daysBefore(today, days - 1), to: today };
  if (p.range === 'custom') {
    const from = isDay(p.from) ? p.from : null;
    const to = isDay(p.to) ? p.to : null;
    // Typed the wrong way round: swap rather than fail.
    return from && to && from > to ? { from: to, to: from } : { from, to };
  }
  return { from: null, to: null };
}

// What covers them all: the fetch when a chart reaches past the page's period.
export function widestRange(ranges: readonly DayRange[]): DayRange {
  const pick = (vals: Array<string | null>, later: boolean) =>
    vals.some((v) => v === null) ? null : vals.reduce<string | null>((a, b) => (a === null || (later ? b! > a : b! < a) ? b : a), null);
  return { from: pick(ranges.map((r) => r.from), false), to: pick(ranges.map((r) => r.to), true) };
}

export const inRange = (day: string, r: DayRange) => (r.from === null || day >= r.from) && (r.to === null || day <= r.to);

// A chart's own period in the URL, `p.<chart>`: a range key, or `from~to` for
// custom dates (either side may be empty). Anything else follows the page.
// The tab links leave these out, so a chart's period lasts until another tab.
export const CHART_PERIOD_PREFIX = 'p.';

export function parseChartPeriod(v: unknown): Period | null {
  if (typeof v !== 'string') return null;
  if (v.includes('~')) {
    const [from = '', to = ''] = v.split('~');
    return { range: 'custom', from, to };
  }
  return v in RANGES && v !== 'custom' ? { range: v as RangeKey, from: '', to: '' } : null;
}

export function formatChartPeriod(p: Period): string {
  return p.range === 'custom' ? `${p.from}~${p.to}` : p.range;
}

// Chart props and their table views, shared by the Insights tabs.
import type { Series } from '../../components/charts/StatsChart.vue';
import { OTHER, topWithOther } from '../../lib/stats';

export interface Table {
  head: string[];
  rows: Array<Array<string | number>>;
}

type NameOf = (key: string) => string;
const named = (nameOf: NameOf) => (key: string) => (key === OTHER ? OTHER : nameOf(key));

const share = (n: number, total: number) => `${Math.round((n / Math.max(1, total)) * 100)}%`;

// A doughnut of counts: the top 7, the rest as "Other"; the table lists every one.
export function pieOf(counts: ReadonlyArray<{ key: string; n: number }>, nameOf: NameOf, noun: string): { labels: string[]; series: Series[]; table: Table } {
  const name = named(nameOf);
  const slices = topWithOther(counts);
  const total = counts.reduce((s, c) => s + c.n, 0);
  return {
    labels: slices.map((s) => name(s.key)),
    series: [{ label: noun, data: slices.map((s) => s.n) }],
    table: { head: ['', noun, 'Share'], rows: counts.map((c) => [name(c.key), c.n, share(c.n, total)]) },
  };
}

// A bar of counts, busiest first; the top `keep`, the rest as "Other".
export function barOf(counts: ReadonlyArray<{ key: string; n: number }>, nameOf: NameOf, noun: string, keep = 10): { labels: string[]; series: Series[]; table: Table } {
  const name = named(nameOf);
  const bars = topWithOther(counts, keep);
  const total = counts.reduce((s, c) => s + c.n, 0);
  return {
    labels: bars.map((b) => name(b.key)),
    series: [{ label: noun, data: bars.map((b) => b.n) }],
    table: { head: ['', noun, 'Share'], rows: counts.map((c) => [name(c.key), c.n, share(c.n, total)]) },
  };
}

// Coffee used against stock left per bean (Insights → Beans), in grams:
// the first `keep` rows as given, the rest summed into "Other"; the table
// lists every bean. An archived bean's stock counts 0 and shows as "–".
export interface UsageRow {
  label: string;
  used: number;
  left: number;
  archived: boolean;
}
export function usedAndLeftOf(rows: readonly UsageRow[], keep = 10): { labels: string[]; series: Series[]; table: Table } {
  const left = (r: UsageRow) => (r.archived ? 0 : r.left);
  const bars = rows.length <= keep + 1
    ? rows.map((r) => ({ label: r.label, used: r.used, left: left(r) }))
    : [
        ...rows.slice(0, keep).map((r) => ({ label: r.label, used: r.used, left: left(r) })),
        rows.slice(keep).reduce((o, r) => ({ label: OTHER, used: o.used + r.used, left: o.left + left(r) }), { label: OTHER, used: 0, left: 0 }),
      ];
  return {
    labels: bars.map((b) => b.label),
    series: [
      { label: 'Used', data: bars.map((b) => b.used) },
      { label: 'Left', data: bars.map((b) => b.left) },
    ],
    table: {
      head: ['Bean', 'Used (g)', 'Left (g)'],
      rows: rows.map((r) => [r.archived ? `${r.label} (archived)` : r.label, Math.round(r.used), r.archived ? '–' : Math.round(r.left)]),
    },
  };
}

// A bar of average ratings, labelled with how many brews each is from.
export function meansOf(means: ReadonlyArray<{ key: string; mean: number; n: number }>, nameOf: NameOf, keep = 12): { labels: string[]; series: Series[]; table: Table } {
  const shown = means.slice(0, keep);
  return {
    labels: shown.map((m) => `${nameOf(m.key)} (${m.n})`),
    series: [{ label: 'Average rating', data: shown.map((m) => m.mean) }],
    table: { head: ['', 'Average rating', 'Brews'], rows: means.map((m) => [nameOf(m.key), m.mean.toFixed(2), m.n]) },
  };
}

// Several series over the time buckets, as a table: one column each.
export function seriesTable(first: string, labels: readonly string[], series: ReadonlyArray<{ label: string; data: ReadonlyArray<number | null> }>): Table {
  return { head: [first, ...series.map((s) => s.label)], rows: labels.map((l, i) => [l, ...series.map((s) => s.data[i] ?? '–')]) };
}

// A horizontal bar's height: room for each bar plus the axis.
export const barsHeight = (n: number) => Math.max(140, n * 30 + 48);
// The same with two bars side by side per row.
export const pairedBarsHeight = (n: number) => Math.max(160, n * 48 + 72);

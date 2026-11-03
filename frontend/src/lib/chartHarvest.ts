// Insights charts for the chat's attach picker (docs/api/chat.md §12): the
// tab views are drawn out of sight with CHART_HARVEST provided, and each
// ChartCard hands over its title, note and table instead of drawing.
// Attached as a snapshot of those numbers.
import type { InjectionKey } from 'vue';
import type { ChatChartSnapshot } from '../api/chats';

export const CHART_ROWS_MAX = 200;
export const CHART_COLUMNS_MAX = 20;

export interface ChartTable {
  head: string[];
  rows: Array<Array<string | number>>;
}
export interface HarvestedChart {
  id: string; // the card's layout id: "brews.rating", or "pin:<id>" for an added Explore chart
  title: () => string;
  note: () => string | null;
  table: () => ChartTable | null;
  empty: () => boolean;
}
export interface Harvest {
  add: (chart: HarvestedChart) => () => void;
}
export const CHART_HARVEST: InjectionKey<Harvest> = Symbol('chartHarvest');

// The first CHART_ROWS_MAX rows, and how many more there were.
export function chartSnapshot(tab: string, title: string, note: string | null, filters: string, table: ChartTable): ChatChartSnapshot {
  const width = Math.min(table.head.length, CHART_COLUMNS_MAX);
  const cell = (v: string | number) => (typeof v === 'number' ? (Number.isFinite(v) ? v : String(v)) : v.slice(0, 200));
  return {
    tab,
    title: title.slice(0, 200),
    note: note ? note.slice(0, 1000) : null,
    filters: filters.slice(0, 500),
    head: table.head.slice(0, width).map((h) => h.slice(0, 200)),
    rows: table.rows.slice(0, CHART_ROWS_MAX).map((r) => r.slice(0, width).map(cell)),
    cut: Math.max(0, table.rows.length - CHART_ROWS_MAX),
  };
}

export interface FilterWords {
  period: string; // "Last 30 days", "Oct 1 – Oct 31", "All time"
  bean: string | null;
  recipe: string | null;
  brewer: string | null;
  mine: boolean;
  by: string | null; // "Week"; null = automatic
  unit: string; // "ml"
}
// What the numbers cover, in words: "Last 30 days · Bean: Onyx Guji · Only mine".
export function filtersText(f: FilterWords): string {
  return [
    f.period,
    f.bean && `Bean: ${f.bean}`,
    f.recipe && `Recipe: ${f.recipe}`,
    f.brewer && `Brewer: ${f.brewer}`,
    f.mine ? 'Only mine' : "Everyone's brews",
    f.by && `By ${f.by.toLowerCase()}`,
    `Volumes in ${f.unit}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// The same chart under the same filters is the same attachment; under other
// filters, another one. A v4-shaped UUID from a hash of the two.
export function chartAttachId(chartKey: string, filters: string): string {
  const text = `${chartKey}|${filters}`;
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  });
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

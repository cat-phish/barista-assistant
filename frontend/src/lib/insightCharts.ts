// A person's added Insights charts (docs/api/stats.md §11b): Explore views
// kept on a tab, and built-in charts added to the Overview.
import type { ComputedRef, InjectionKey } from 'vue';
import type { ChartPin, ExplorePin, InsightChart, InsightLayout, InsightTab } from '../api/types';
import { MAX_INSIGHT_CHARTS } from '../api/types';

// The tabs a chart can go on, in the tab row's order. A tab whose field the
// workspace hides (Settings → Fields) leaves the row, and takes its charts.
export const INSIGHT_TAB_INFO: ReadonlyArray<{ tab: InsightTab; route: string; label: string; field?: string }> = [
  { tab: 'overview', route: 'stats-overview', label: 'Overview' },
  { tab: 'brews', route: 'stats-brews', label: 'Brews' },
  { tab: 'beans', route: 'stats-beans', label: 'Beans' },
  { tab: 'methods', route: 'stats-methods', label: 'Methods' },
  { tab: 'recipes', route: 'stats-recipes', label: 'Recipes' },
  { tab: 'tools', route: 'stats-tools', label: 'Prep', field: 'brew.prepTools' },
  { tab: 'grinders', route: 'stats-grinders', label: 'Grinders', field: 'brew.grinder' },
];

export const visibleTabs = (hidden: ReadonlySet<string>) => INSIGHT_TAB_INFO.filter((t) => !t.field || !hidden.has(t.field));

export const tabOfChart = (chartId: string) => chartId.split('.')[0] as InsightTab;

// A v4 UUID. crypto.randomUUID needs a secure context; getRandomValues doesn't.
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const canAdd = (list: readonly InsightChart[]) => list.length < MAX_INSIGHT_CHARTS;

export const explorePins = (list: readonly InsightChart[], tab: InsightTab): ExplorePin[] => list.filter((c): c is ExplorePin => c.kind === 'explore' && c.tab === tab);

export const onOverview = (list: readonly InsightChart[], chartId: string): ChartPin | undefined => list.find((c): c is ChartPin => c.kind === 'chart' && c.chart === chartId);

// A built-in chart on or off the Overview.
export function toggleOverview(list: readonly InsightChart[], chartId: string, newId: () => string): InsightChart[] {
  const pin = onOverview(list, chartId);
  return pin ? list.filter((c) => c !== pin) : [...list, { id: newId(), kind: 'chart', tab: 'overview', chart: chartId }];
}

// On the Overview: the built-in charts' ids, by the tab that draws them.
export function overviewCharts(list: readonly InsightChart[]): Map<InsightTab, Set<string>> {
  const out = new Map<InsightTab, Set<string>>();
  for (const c of list) {
    if (c.kind !== 'chart') continue;
    const tab = tabOfChart(c.chart);
    out.set(tab, (out.get(tab) ?? new Set()).add(c.chart));
  }
  return out;
}

// Provided around a tab drawn on the Overview: only these charts show, and
// the tab's own added Explore charts stay on the tab.
export const ONLY_CHARTS: InjectionKey<ComputedRef<ReadonlySet<string>>> = Symbol('onlyCharts');

// ── Layout: each tab's order and hidden charts (backlog: hide and reorder) ──

// The tab a page's charts are laid out under; null on Explore.
export const tabOfRoute = (name: unknown): InsightTab | null => INSIGHT_TAB_INFO.find((t) => t.route === name)?.tab ?? null;

export const pinLayoutId = (pinId: string) => `pin:${pinId}`;
export const isPinLayoutId = (id: string) => id.startsWith('pin:');
// The Overview's stat tiles are laid out too, as their own group.
export const tileLayoutId = (key: string) => `tile.${key}`;
export const isTileId = (id: string) => id.startsWith('tile.');

// A chart on the page: its layout id, title, and where the template (or, on the
// Overview, the added list) puts it.
export interface LaidOutChart {
  id: string;
  title: string;
  rank: number;
}

// Saved ids first, in their order, then the rest by rank: a chart that's new
// since the layout was saved goes at the end.
export function layoutOrder(present: readonly LaidOutChart[], saved: readonly string[] = []): string[] {
  const ids = new Set(present.map((c) => c.id));
  const kept = saved.filter((id) => ids.has(id));
  const placed = new Set(kept);
  return [...kept, ...[...present].sort((a, b) => a.rank - b.rank).map((c) => c.id).filter((id) => !placed.has(id))];
}

// A tab's layout with a new order. Ids saved for charts not on the page now
// (hidden by a setting, say) stay, after the ones shown.
export function withOrder(layout: InsightLayout, tab: InsightTab, order: readonly string[]): InsightLayout {
  const shown = new Set(order);
  const rest = (layout[tab]?.order ?? []).filter((id) => !shown.has(id));
  return tidy({ ...layout, [tab]: { ...layout[tab], order: [...order, ...rest] } });
}

export function withHidden(layout: InsightLayout, tab: InsightTab, id: string, hidden: boolean): InsightLayout {
  const now = (layout[tab]?.hidden ?? []).filter((h) => h !== id);
  return tidy({ ...layout, [tab]: { ...layout[tab], hidden: hidden ? [...now, id] : now } });
}

export function withoutTab(layout: InsightLayout, tab: InsightTab): InsightLayout {
  const { [tab]: _, ...rest } = layout;
  return rest;
}

export function withTilesBelow(layout: InsightLayout, below: boolean): InsightLayout {
  return tidy({ ...layout, overview: { ...layout.overview, tilesBelow: below } });
}

// An added chart is gone: drop it from every tab's order.
export function withoutPin(layout: InsightLayout, pinId: string): InsightLayout {
  const id = pinLayoutId(pinId);
  const out: InsightLayout = {};
  for (const [tab, l] of Object.entries(layout) as Array<[InsightTab, NonNullable<InsightLayout[InsightTab]>]>) {
    out[tab] = { ...l, ...(l.order ? { order: l.order.filter((o) => o !== id) } : {}) };
  }
  return tidy(out);
}

// Empty lists and tabs left out, so a reset tab is simply absent.
function tidy(layout: InsightLayout): InsightLayout {
  const out: InsightLayout = {};
  for (const [tab, l] of Object.entries(layout) as Array<[InsightTab, NonNullable<InsightLayout[InsightTab]>]>) {
    const t: { order?: string[]; hidden?: string[]; tilesBelow?: boolean } = {};
    if (l.order?.length) t.order = l.order;
    if (l.hidden?.length) t.hidden = l.hidden;
    if (l.tilesBelow) t.tilesBelow = true;
    if (t.order || t.hidden || t.tilesBelow) out[tab] = t;
  }
  return out;
}

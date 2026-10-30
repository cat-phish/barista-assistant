// The Insights page's data (docs/api/stats.md §11): the filters live in the URL,
// StatsView fetches once per change, and each tab reads it with useStats().
import { computed, inject, provide, reactive, ref, shallowRef, watch, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { errorMessage } from '../api/client';
import { statsApi, type StatsQuery } from '../api/stats';
import type { InsightChart, InsightLayout, InsightTab, StatsBean, StatsBrew, StatsData, VolumeUnit } from '../api/types';
import { formatDay, localDateInput } from '../lib/format';
import { bucketRange, brewVolumeMl, localDay, pickGranularity, type Granularity, type VolumeSource } from '../lib/stats';
import { canAdd, isTileId, layoutOrder, newUuid, pinLayoutId, toggleOverview, withoutPin, type LaidOutChart } from '../lib/insightCharts';
import { CHART_PERIOD_PREFIX, formatChartPeriod, inRange, parseChartPeriod, RANGES, resolveRange, widestRange, type DayRange, type Period, type RangeKey } from '../lib/statsRange';
import { GRAMS_PER_FL_OZ } from '../lib/scale';
import { VOLUME_LABELS } from '../lib/units';
import { useWorkspaceStore } from '../stores/workspace';
import { usePreferences } from './usePreferences';

export { RANGES, type RangeKey };
export const GROUPINGS = { auto: 'Auto', day: 'Day', week: 'Week', month: 'Month' } as const;
export type Grouping = keyof typeof GROUPINGS;

const FILTER_KEYS = ['range', 'from', 'to', 'bean', 'recipe', 'brewer', 'mine', 'unit', 'by'];

export interface StatsFilters {
  range: RangeKey;
  from: string; // custom range only
  to: string;
  bean: string;
  recipe: string;
  brewer: string;
  mine: boolean;
  unit: VolumeUnit;
  by: Grouping;
}

export interface StatsAxis {
  from: string;
  to: string;
  granularity: Granularity;
  buckets: string[];
}

// One over-time chart: its own period (null = the page's), and the brews and
// date axis that period gives.
export interface ChartView {
  period: ComputedRef<Period | null>;
  setPeriod: (p: Period | null) => void;
  range: ComputedRef<DayRange>;
  brews: ComputedRef<StatsBrew[]>;
  axis: ComputedRef<StatsAxis>;
  labels: ComputedRef<string[]>;
}

export interface StatsContext {
  filters: ComputedRef<StatsFilters>;
  setFilters: (change: Partial<StatsFilters>) => void;
  loading: Ref<boolean>;
  error: Ref<string>;
  data: Ref<StatsData | null>;
  brews: ComputedRef<StatsBrew[]>; // in the page's period
  beans: ComputedRef<StatsBean[]>;
  bean: (id: string) => StatsBean | undefined;
  name: (id: string | null) => string | null; // any lookup's name (ids are UUIDs, so one map)
  hidden: ComputedRef<ReadonlySet<string>>; // settings.hiddenFields keys, e.g. "brew.tds"
  range: ComputedRef<{ from: string | null; to: string | null }>; // what was asked for; null = open
  chart: (id: string) => ChartView; // call in setup
  // The person's added charts (docs/api/stats.md §11b); changes show at once.
  pinned: Ref<InsightChart[]>;
  pinError: Ref<string>;
  addChart: (c: InsightChart) => Promise<boolean>;
  removeChart: (id: string) => void;
  toggleOverview: (chartId: string) => void;
  // Each tab's order and hidden charts; the cards on the page register so the
  // layout editor can list them.
  layout: Ref<InsightLayout>;
  setLayout: (next: InsightLayout) => void;
  register: (tab: InsightTab, id: string, title: () => string) => () => void;
  charts: (tab: InsightTab) => LaidOutChart[]; // in layout order
  placeOf: (tab: InsightTab, id: string) => { order: number; hidden: boolean };
  volume: (brew: StatsBrew) => { ml: number; source: VolumeSource } | null;
  formatVolume: (ml: number) => string;
  volumeIn: (ml: number) => number; // in the chosen unit, for chart values
}

const KEY: InjectionKey<StatsContext> = Symbol('stats');

const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Called once, by StatsView.
export function provideStats(): StatsContext {
  const route = useRoute();
  const router = useRouter();
  const workspaces = useWorkspaceStore();
  const { prefs, recipeRoastLevel, hiddenFields } = usePreferences();

  const filters = computed<StatsFilters>(() => {
    const q = route.query;
    const range = str(q.range) in RANGES ? (str(q.range) as RangeKey) : 'all';
    const unit = str(q.unit) === 'ml' || str(q.unit) === 'fl_oz' ? (str(q.unit) as VolumeUnit) : prefs.value.volumeUnit;
    const by = str(q.by) in GROUPINGS ? (str(q.by) as Grouping) : 'auto';
    return { range, from: str(q.from), to: str(q.to), bean: str(q.bean), recipe: str(q.recipe), brewer: str(q.brewer), mine: q.mine !== '0', unit, by };
  });

  // Defaults stay out of the URL, so a plain /insights link means "all of my brews".
  // A tab's own keys (Explore's picks) and the charts' periods are kept.
  function setFilters(change: Partial<StatsFilters>): void {
    const f = { ...filters.value, ...change };
    const query: LocationQueryRaw = Object.fromEntries(Object.entries(route.query).filter(([k]) => !FILTER_KEYS.includes(k)));
    if (f.range !== 'all') query.range = f.range;
    if (f.range === 'custom') {
      if (f.from) query.from = f.from;
      if (f.to) query.to = f.to;
    }
    if (f.bean) query.bean = f.bean;
    if (f.recipe) query.recipe = f.recipe;
    if (f.brewer) query.brewer = f.brewer;
    if (!f.mine) query.mine = '0';
    if (f.unit !== prefs.value.volumeUnit) query.unit = f.unit;
    if (f.by !== 'auto') query.by = f.by;
    void router.replace({ query });
  }

  const range = computed(() => resolveRange(filters.value, localDateInput()));

  // Charts with their own period (`p.<chart>` in the URL); the fetch covers
  // them all, and the page's brews are cut back to its own period below.
  const chartPeriods = computed(() => {
    const out = new Map<string, Period>();
    for (const [k, v] of Object.entries(route.query)) {
      const p = k.startsWith(CHART_PERIOD_PREFIX) ? parseChartPeriod(v) : null;
      if (p) out.set(k.slice(CHART_PERIOD_PREFIX.length), p);
    }
    return out;
  });
  const fetchRange = computed(() => widestRange([range.value, ...[...chartPeriods.value.values()].map((p) => resolveRange(p, localDateInput()))]));

  const apiQuery = computed<StatsQuery>(() => ({
    from: fetchRange.value.from ?? undefined,
    to: fetchRange.value.to ?? undefined,
    beanId: filters.value.bean || undefined,
    recipeId: filters.value.recipe || undefined,
    brewerId: filters.value.brewer || undefined,
    mine: filters.value.mine,
  }));

  const data = shallowRef<StatsData | null>(null);
  const loading = ref(true);
  const error = ref('');
  let request = 0;
  watch(
    () => [workspaces.current?.id, JSON.stringify(apiQuery.value)] as const,
    async ([ws]) => {
      if (!ws) return;
      const mine = ++request;
      loading.value = true;
      error.value = '';
      try {
        const res = await statsApi.get(ws, apiQuery.value);
        if (mine === request) data.value = res;
      } catch (err) {
        if (mine === request) error.value = errorMessage(err);
      } finally {
        if (mine === request) loading.value = false;
      }
    },
    { immediate: true },
  );

  const fetched = computed(() => data.value?.brews ?? []);
  const within = (r: DayRange) => (r.from === fetchRange.value.from && r.to === fetchRange.value.to ? fetched.value : fetched.value.filter((b) => inRange(localDay(b), r)));
  const brews = computed(() => within(range.value));

  const pinned = ref<InsightChart[]>([]);
  const pinError = ref('');
  const layout = ref<InsightLayout>({});
  let savedLayout: InsightLayout = {};
  watch(
    () => workspaces.current?.id,
    async (ws) => {
      pinned.value = [];
      layout.value = savedLayout = {};
      if (!ws) return;
      try {
        const res = await statsApi.charts(ws);
        if (ws !== workspaces.current?.id) return;
        pinned.value = res.charts;
        layout.value = savedLayout = res.layout;
      } catch (err) {
        pinError.value = errorMessage(err);
      }
    },
    { immediate: true },
  );
  // Saves the whole list; puts the old one back if that fails.
  async function savePinned(next: InsightChart[]): Promise<boolean> {
    const ws = workspaces.current?.id;
    if (!ws) return false;
    const before = pinned.value;
    pinned.value = next;
    pinError.value = '';
    try {
      await statsApi.saveCharts(ws, next);
      return true;
    } catch (err) {
      pinned.value = before;
      pinError.value = errorMessage(err);
      return false;
    }
  }
  // Shown at once; saved after a pause, so a drag is one request. A failed
  // save goes back to what was last saved.
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;
  function setLayout(next: InsightLayout): void {
    layout.value = next;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(async () => {
      const ws = workspaces.current?.id;
      if (!ws) return;
      const sending = layout.value;
      try {
        await statsApi.saveLayout(ws, sending);
        savedLayout = sending;
      } catch (err) {
        if (layout.value === sending) layout.value = savedLayout;
        pinError.value = errorMessage(err);
      }
    }, 400);
  }

  // The cards on the page, by tab. On a tab they rank in template order (the
  // order they set up in); on the Overview, tiles first in their own order,
  // then charts in the order they were added.
  const registry = reactive(new Map<InsightTab, Map<string, { title: () => string; rank: number }>>());
  let registered = 0;
  function register(tab: InsightTab, id: string, title: () => string): () => void {
    const cards = registry.get(tab) ?? registry.set(tab, new Map()).get(tab)!;
    const entry = { title, rank: registered++ };
    cards.set(id, entry);
    return () => {
      if (cards.get(id) === entry) cards.delete(id);
    };
  }
  const overviewRank = (id: string) =>
    pinned.value.findIndex((c) => (c.kind === 'chart' ? c.chart === id : pinLayoutId(c.id) === id));
  const orders = computed(() => {
    const out = new Map<InsightTab, LaidOutChart[]>();
    for (const [tab, cards] of registry) {
      const present = [...cards].map(([id, c]) => ({ id, title: c.title(), rank: tab !== 'overview' ? c.rank : isTileId(id) ? c.rank - 1e9 : overviewRank(id) }));
      const byId = new Map(present.map((c) => [c.id, c]));
      out.set(tab, layoutOrder(present, layout.value[tab]?.order).map((id) => byId.get(id)!));
    }
    return out;
  });
  function placeOf(tab: InsightTab, id: string): { order: number; hidden: boolean } {
    const order = orders.value.get(tab)?.findIndex((c) => c.id === id) ?? -1;
    return { order: Math.max(0, order), hidden: !!layout.value[tab]?.hidden?.includes(id) };
  }

  async function addChart(c: InsightChart): Promise<boolean> {
    if (!canAdd(pinned.value)) {
      pinError.value = 'That’s the most charts you can add. Remove one first.';
      return false;
    }
    return savePinned([...pinned.value, c]);
  }
  const beans = computed(() => data.value?.beans ?? []);
  const beanById = computed(() => new Map(beans.value.map((b) => [b.id, b])));
  const names = computed(() => {
    const out = new Map<string, string>();
    const l = data.value?.lookups;
    if (l) for (const list of Object.values(l)) for (const item of list) out.set(item.id, item.name);
    return out;
  });

  function axisOf(r: DayRange, inIt: readonly StatsBrew[]): StatsAxis {
    const today = localDateInput();
    const first = inIt[0];
    const from = r.from ?? (first ? localDay(first) : today);
    const to = r.to ?? today;
    const granularity = filters.value.by === 'auto' ? pickGranularity(from, to) : filters.value.by;
    return { from, to, granularity, buckets: bucketRange(from, to, granularity) };
  }

  function bucketLabel(key: string, g: Granularity): string {
    if (g !== 'month') return formatDay(key);
    const [y, m] = key.split('-').map(Number);
    return new Date(y ?? 0, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }

  function chart(id: string): ChartView {
    const key = CHART_PERIOD_PREFIX + id;
    const period = computed(() => chartPeriods.value.get(id) ?? null);
    const chartRange = computed(() => (period.value ? resolveRange(period.value, localDateInput()) : range.value));
    const chartBrews = computed(() => within(chartRange.value));
    const axis = computed(() => axisOf(chartRange.value, chartBrews.value));
    return {
      period,
      setPeriod(p) {
        const query: LocationQueryRaw = { ...route.query };
        delete query[key];
        if (p) query[key] = formatChartPeriod(p);
        void router.replace({ query });
      },
      range: chartRange,
      brews: chartBrews,
      axis,
      labels: computed(() => axis.value.buckets.map((k) => bucketLabel(k, axis.value.granularity))),
    };
  }

  const volumes = computed(() => {
    const out = new Map<string, { ml: number; source: VolumeSource } | null>();
    for (const b of brews.value) out.set(b.id, brewVolumeMl(b, beanById.value.get(b.beanId)?.roastLevel ?? null, recipeRoastLevel.value));
    return out;
  });

  const volumeIn = (ml: number) => (filters.value.unit === 'ml' ? Math.round(ml) : Math.round((ml / GRAMS_PER_FL_OZ) * 10) / 10);
  function formatVolume(ml: number): string {
    if (filters.value.unit === 'ml') return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`;
    const oz = ml / GRAMS_PER_FL_OZ;
    return oz >= 128 ? `${(oz / 128).toFixed(1)} gal` : `${oz.toFixed(oz < 10 ? 1 : 0)} ${VOLUME_LABELS.fl_oz}`;
  }

  const ctx: StatsContext = {
    filters,
    setFilters,
    loading,
    error,
    data,
    brews,
    beans,
    bean: (id) => beanById.value.get(id),
    name: (id) => (id ? (names.value.get(id) ?? null) : null),
    hidden: computed(() => new Set(hiddenFields.value)),
    range,
    chart,
    pinned,
    pinError,
    addChart,
    removeChart: (id) => {
      void savePinned(pinned.value.filter((c) => c.id !== id)).then((ok) => {
        if (ok) setLayout(withoutPin(layout.value, id));
      });
    },
    toggleOverview: (chartId) => {
      const next = toggleOverview(pinned.value, chartId, newUuid);
      if (next.length > pinned.value.length && !canAdd(pinned.value)) {
        pinError.value = 'That’s the most charts you can add. Remove one first.';
        return;
      }
      void savePinned(next);
    },
    layout,
    setLayout,
    register,
    charts: (tab) => orders.value.get(tab) ?? [],
    placeOf,
    volume: (brew) => volumes.value.get(brew.id) ?? null,
    formatVolume,
    volumeIn,
  };
  provide(KEY, ctx);
  return ctx;
}

// In a Stats tab.
export function useStats(): StatsContext {
  const ctx = inject(KEY);
  if (!ctx) throw new Error('useStats() outside StatsView');
  return ctx;
}

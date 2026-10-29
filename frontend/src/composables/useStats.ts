// The Insights page's data (docs/api/stats.md §11): the filters live in the URL,
// StatsView fetches once per change, and each tab reads it with useStats().
import { computed, inject, provide, ref, shallowRef, watch, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { errorMessage } from '../api/client';
import { statsApi, type StatsQuery } from '../api/stats';
import type { StatsBean, StatsBrew, StatsData, VolumeUnit } from '../api/types';
import { formatDay, localDateInput } from '../lib/format';
import { bucketRange, brewVolumeMl, localDay, pickGranularity, type Granularity, type VolumeSource } from '../lib/stats';
import { GRAMS_PER_FL_OZ } from '../lib/scale';
import { VOLUME_LABELS } from '../lib/units';
import { useWorkspaceStore } from '../stores/workspace';
import { usePreferences } from './usePreferences';

export const RANGES = { '30d': 'Last 30 days', '90d': 'Last 90 days', '1y': 'Last year', all: 'All time', custom: 'Custom' } as const;
export type RangeKey = keyof typeof RANGES;
const RANGE_DAYS: Partial<Record<RangeKey, number>> = { '30d': 30, '90d': 90, '1y': 365 };
export const GROUPINGS = { auto: 'Auto', day: 'Day', week: 'Week', month: 'Month' } as const;
export type Grouping = keyof typeof GROUPINGS;

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

export interface StatsContext {
  filters: ComputedRef<StatsFilters>;
  setFilters: (change: Partial<StatsFilters>) => void;
  loading: Ref<boolean>;
  error: Ref<string>;
  data: Ref<StatsData | null>;
  brews: ComputedRef<StatsBrew[]>;
  beans: ComputedRef<StatsBean[]>;
  bean: (id: string) => StatsBean | undefined;
  name: (id: string | null) => string | null; // any lookup's name (ids are UUIDs, so one map)
  hidden: ComputedRef<ReadonlySet<string>>; // settings.hiddenFields keys, e.g. "brew.tds"
  range: ComputedRef<{ from: string | null; to: string | null }>; // what was asked for; null = open
  axis: ComputedRef<{ from: string; to: string; granularity: Granularity; buckets: string[] }>;
  bucketLabel: (key: string) => string;
  volume: (brew: StatsBrew) => { ml: number; source: VolumeSource } | null;
  formatVolume: (ml: number) => string;
  volumeIn: (ml: number) => number; // in the chosen unit, for chart values
}

const KEY: InjectionKey<StatsContext> = Symbol('stats');

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function daysBefore(day: string, n: number): string {
  return new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);
}

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
    return { range, from: str(q.from), to: str(q.to), bean: str(q.bean), recipe: str(q.recipe), brewer: str(q.brewer), mine: q.mine === '1', unit, by };
  });

  // Defaults stay out of the URL, so a plain /stats link means "all of it".
  function setFilters(change: Partial<StatsFilters>): void {
    const f = { ...filters.value, ...change };
    const query: LocationQueryRaw = {};
    if (f.range !== 'all') query.range = f.range;
    if (f.range === 'custom') {
      if (f.from) query.from = f.from;
      if (f.to) query.to = f.to;
    }
    if (f.bean) query.bean = f.bean;
    if (f.recipe) query.recipe = f.recipe;
    if (f.brewer) query.brewer = f.brewer;
    if (f.mine) query.mine = '1';
    if (f.unit !== prefs.value.volumeUnit) query.unit = f.unit;
    if (f.by !== 'auto') query.by = f.by;
    void router.replace({ query });
  }

  const range = computed(() => {
    const f = filters.value;
    const today = localDateInput();
    const days = RANGE_DAYS[f.range];
    if (days) return { from: daysBefore(today, days - 1), to: today };
    if (f.range === 'custom') {
      const from = isDay(f.from) ? f.from : null;
      const to = isDay(f.to) ? f.to : null;
      // Typed the wrong way round: swap rather than fail.
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
    return { from: null, to: null };
  });

  const apiQuery = computed<StatsQuery>(() => ({
    from: range.value.from ?? undefined,
    to: range.value.to ?? undefined,
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

  const brews = computed(() => data.value?.brews ?? []);
  const beans = computed(() => data.value?.beans ?? []);
  const beanById = computed(() => new Map(beans.value.map((b) => [b.id, b])));
  const names = computed(() => {
    const out = new Map<string, string>();
    const l = data.value?.lookups;
    if (l) for (const list of Object.values(l)) for (const item of list) out.set(item.id, item.name);
    return out;
  });

  const axis = computed(() => {
    const today = localDateInput();
    const first = brews.value[0];
    const from = range.value.from ?? (first ? localDay(first) : today);
    const to = range.value.to ?? today;
    const granularity = filters.value.by === 'auto' ? pickGranularity(from, to) : filters.value.by;
    return { from, to, granularity, buckets: bucketRange(from, to, granularity) };
  });

  function bucketLabel(key: string): string {
    if (axis.value.granularity !== 'month') return formatDay(key);
    const [y, m] = key.split('-').map(Number);
    return new Date(y ?? 0, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
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
    axis,
    bucketLabel,
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

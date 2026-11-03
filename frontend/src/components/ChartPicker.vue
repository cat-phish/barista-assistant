<script setup lang="ts">
// The chat attach picker's Charts tab (docs/api/chat.md §12): every chart on
// the Insights tabs, the Explore charts the person added included, and the
// Overview's totals, under filters of its own. They start as the Insights
// page has them, and changing them here leaves the page alone. The tab views
// are drawn out of sight (ChartHarvestTab); a ticked chart is attached as a
// snapshot of its numbers (lib/chartHarvest.ts).
import { computed, defineAsyncComponent, reactive, ref, type Component } from 'vue';
import type { LocationQuery } from 'vue-router';
import type { ChatAttachment } from '../api/chats';
import type { InsightTab } from '../api/types';
import { GROUPINGS, provideStats } from '../composables/useStats';
import { beanLabel } from '../lib/beans';
import { chartAttachId, chartSnapshot, filtersText, type HarvestedChart } from '../lib/chartHarvest';
import { isPicked } from '../lib/chatAttach';
import { formatDay } from '../lib/format';
import { INSIGHT_TAB_INFO, visibleTabs } from '../lib/insightCharts';
import { RANGES } from '../lib/statsRange';
import { VOLUME_LABELS } from '../lib/units';
import ChartHarvestTab from './charts/ChartHarvestTab.vue';
import FilterBar from './FilterBar.vue';
import OverviewTotalsHarvest from './charts/OverviewTotalsHarvest.vue';
import PinnedCharts from './charts/PinnedCharts.vue';
import StatsFilters from './StatsFilters.vue';

const props = defineProps<{ selected: ChatAttachment[]; full: boolean }>();
const emit = defineEmits<{ toggle: [item: ChatAttachment]; pickAll: [items: ChatAttachment[]]; clear: [] }>();

const local = ref<LocationQuery>({});
const stats = provideStats(local);

const TAB_VIEWS: Partial<Record<InsightTab, Component>> = {
  brews: defineAsyncComponent(() => import('../views/stats/StatsBrewsView.vue')),
  beans: defineAsyncComponent(() => import('../views/stats/StatsBeansView.vue')),
  methods: defineAsyncComponent(() => import('../views/stats/StatsMethodsView.vue')),
  recipes: defineAsyncComponent(() => import('../views/stats/StatsRecipesView.vue')),
  tools: defineAsyncComponent(() => import('../views/stats/StatsToolsView.vue')),
  grinders: defineAsyncComponent(() => import('../views/stats/StatsGrindersView.vue')),
};
const tabs = computed(() => visibleTabs(stats.hidden.value).flatMap((t) => (TAB_VIEWS[t.tab] ? [{ tab: t.tab, view: TAB_VIEWS[t.tab]! }] : [])));

// What the drawn cards handed over, in the order they set up.
const collected = reactive(new Map<string, { tab: string; chart: HarvestedChart; rank: number }>());
let ranks = 0;
function collect(tab: string, chart: HarvestedChart): () => void {
  const key = `${tab}:${chart.id}`;
  const entry = { tab, chart, rank: ranks++ };
  collected.set(key, entry);
  return () => {
    if (collected.get(key) === entry) collected.delete(key);
  };
}

const words = computed(() => {
  const f = stats.filters.value;
  const period = f.range === 'custom' ? `${f.from ? formatDay(f.from) : 'the start'} – ${f.to ? formatDay(f.to) : 'today'}` : RANGES[f.range];
  const bean = f.bean ? stats.bean(f.bean) : undefined;
  return filtersText({
    period,
    bean: bean ? beanLabel(bean) : null,
    recipe: f.recipe ? stats.name(f.recipe) : null,
    brewer: f.brewer ? stats.name(f.brewer) : null,
    mine: f.mine,
    by: f.by === 'auto' ? null : GROUPINGS[f.by],
    unit: VOLUME_LABELS[f.unit],
  });
});

interface Row {
  key: string;
  title: string;
  note: string | null;
  rows: number;
  item: ChatAttachment | null; // null: nothing to attach under these filters
}
const groups = computed(() => {
  const order = new Map(INSIGHT_TAB_INFO.map((t, i) => [t.tab as string, i]));
  const byTab = new Map<string, Row[]>();
  for (const [key, { tab, chart }] of [...collected].sort((a, b) => (order.get(a[1].tab) ?? 99) - (order.get(b[1].tab) ?? 99) || a[1].rank - b[1].rank)) {
    const title = chart.title();
    const note = chart.note();
    const table = chart.table();
    const usable = table && !chart.empty() && table.rows.length > 0;
    const item: ChatAttachment | null = usable
      ? { kind: 'chart', id: chartAttachId(key, words.value), label: title, chart: chartSnapshot(tab, title, note, words.value, table) }
      : null;
    const list = byTab.get(tab) ?? byTab.set(tab, []).get(tab)!;
    list.push({ key, title, note, rows: table?.rows.length ?? 0, item });
  }
  return INSIGHT_TAB_INFO.filter((t) => byTab.has(t.tab)).map((t) => ({ tab: t.tab, label: t.label, rows: byTab.get(t.tab)! }));
});
const usable = computed(() => groups.value.flatMap((g) => g.rows.flatMap((r) => (r.item ? [r.item] : []))));
const pickedHere = computed(() => props.selected.filter((a) => a.kind === 'chart').length);
</script>

<template>
  <div class="chart-picker">
    <FilterBar :summary="words" describe="Attached as the numbers for">
      <StatsFilters />
    </FilterBar>
    <div class="bulk">
      <span class="muted small" aria-live="polite">{{ stats.loading.value && !stats.data.value ? 'Loading charts…' : `${usable.length} ${usable.length === 1 ? 'chart' : 'charts'} with data` }}</span>
      <button v-if="usable.length" type="button" class="btn-link" :disabled="full" @click="emit('pickAll', usable)">Select all {{ usable.length }}</button>
      <button v-if="pickedHere" type="button" class="btn-link" @click="emit('clear')">Clear</button>
    </div>
    <p v-if="stats.error.value" class="form-error" role="alert">{{ stats.error.value }}</p>

    <div class="rows">
      <section v-for="g in groups" :key="g.tab" class="group" :aria-label="g.label">
        <h3>{{ g.label }}</h3>
        <ul>
          <li v-for="r in g.rows" :key="r.key">
            <label class="row" :class="{ picked: r.item && isPicked(selected, r.item), off: !r.item }">
              <input
                type="checkbox"
                :checked="!!r.item && isPicked(selected, r.item)"
                :disabled="!r.item || (full && !isPicked(selected, r.item))"
                @change="r.item && emit('toggle', r.item)"
              />
              <span class="text">
                <span class="top">
                  <strong>{{ r.title }}</strong>
                  <span class="muted small count">{{ r.item ? `${r.rows} ${r.rows === 1 ? 'row' : 'rows'}` : 'No data' }}</span>
                </span>
                <span v-if="r.note" class="muted small note" :title="r.note">{{ r.note }}</span>
              </span>
            </label>
          </li>
        </ul>
      </section>
      <p v-if="!groups.length && !stats.loading.value" class="muted">No charts yet.</p>
    </div>

    <div v-if="stats.data.value" hidden>
      <ChartHarvestTab tab="overview" :collect="collect">
        <OverviewTotalsHarvest />
        <PinnedCharts tab="overview" />
      </ChartHarvestTab>
      <ChartHarvestTab v-for="t in tabs" :key="t.tab" :tab="t.tab" :collect="collect">
        <component :is="t.view" />
      </ChartHarvestTab>
    </div>
  </div>
</template>

<style scoped>
/* No min-height: 0, so it keeps the list's 12rem and the dialog's panel
   scrolls on a short screen instead. */
.chart-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
}
.bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
}
.bulk > :first-child {
  margin-right: auto;
}
p {
  margin: 0;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  flex: 1 0 12rem;
  overflow-y: auto;
}
h3 {
  margin: 0 0 var(--space-1);
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: 6px var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}
.row:hover,
.row:focus-within {
  border-color: var(--brand);
}
.row.picked {
  border-color: var(--brand-line);
  background: var(--brand-tint);
}
.row.off {
  cursor: default;
  opacity: 0.6;
}
.row input {
  flex: none;
  margin-top: 3px;
}
.text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.count {
  flex: none;
}
.note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

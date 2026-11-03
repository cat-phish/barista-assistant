<script setup lang="ts">
// A chart's card on the Insights page: title, the chart, and the same numbers as
// a table (some series colours are light on a white card, so the figures are
// always one tap away). Empty: says so instead of drawing nothing. An over-time
// chart puts its own period picker in the `period` slot, shown even when empty.
// With `kind` (v-model), a bar chart can be drawn as a line instead. A
// built-in chart's `chart-id` gives it a pin for the Overview; drawn there,
// only the pinned ids show (ONLY_CHARTS). Extra buttons go in `actions`.
// With a layout id (the chart-id, or an added chart's "pin:<id>"), the tab's
// layout places it (CSS order in the grid) or hides it. Copy puts the chart
// on the clipboard as a picture (or downloads it where that can't be done),
// or the table as text while the table is showing (lib/chartImage.ts).
// Drawn for the chat's chart picker (CHART_HARVEST, lib/chartHarvest.ts), it
// hands over its title, note and table and draws nothing.
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useStats } from '../../composables/useStats';
import { saveBlob } from '../../lib/backup';
import { CHART_HARVEST } from '../../lib/chartHarvest';
import { chartFileName, chartPng, tableText } from '../../lib/chartImage';
import type { SwitchableKind } from '../../lib/chartKind';
import { ONLY_CHARTS, tabOfRoute } from '../../lib/insightCharts';
import { readChartColors } from './chartTheme';
import OverviewPin from './OverviewPin.vue';

const kind = defineModel<SwitchableKind>('kind');
const props = defineProps<{
  title: string;
  chartId?: string; // "brews.rating"; a built-in chart
  layoutId?: string; // defaults to chartId
  note?: string; // a line under the title: what's counted
  empty?: boolean;
  emptyText?: string;
  table?: { head: string[]; rows: Array<Array<string | number>> };
}>();

const asTable = ref(false);
const only = inject(ONLY_CHARTS, null);
const stats = useStats();
const tab = tabOfRoute(useRoute().name);
const id = computed(() => props.layoutId ?? props.chartId);
const shown = computed(() => !only || (!!props.chartId && only.value.has(props.chartId)));
// On the page's layout while it's drawn here (not one of a tab's other charts
// filtered out on the Overview).
watch(
  () => [id.value, shown.value] as const,
  ([lid, on], _, onCleanup) => {
    if (tab && lid && on) onCleanup(stats.register(tab, lid, () => props.title));
  },
  { immediate: true },
);
const place = computed(() => (tab && id.value ? stats.placeOf(tab, id.value) : null));

const harvest = inject(CHART_HARVEST, null);
watch(
  id,
  (cardId, _, onCleanup) => {
    if (harvest && cardId)
      onCleanup(harvest.add({ id: cardId, title: () => props.title, note: () => props.note ?? null, table: () => props.table ?? null, empty: () => !!props.empty }));
  },
  { immediate: true },
);

const card = ref<HTMLElement | null>(null);
const copied = ref<'' | 'Copied' | 'Saved' | "Couldn't copy">('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
function copyDone(label: typeof copied.value): void {
  copied.value = label;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = ''), 2000);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copy(): Promise<void> {
  if (asTable.value && props.table) {
    try {
      await navigator.clipboard.writeText(tableText(props.table));
      copyDone('Copied');
    } catch {
      copyDone("Couldn't copy");
    }
    return;
  }
  const canvas = card.value?.querySelector('canvas');
  if (!canvas) return;
  // Handed to the clipboard as a promise, before any await: Safari only
  // allows the write straight from the click.
  const png = chartPng(canvas, props.title, readChartColors());
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('No image clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    copyDone('Copied');
  } catch {
    // No image clipboard (an older browser, a phone, a page that isn't a
    // secure context): download it instead.
    try {
      saveBlob(chartFileName(props.title), await png);
      copyDone('Saved');
    } catch {
      copyDone("Couldn't copy");
    }
  }
}
</script>

<template>
  <section v-if="!harvest && shown && !place?.hidden" ref="card" class="card chart-card" :style="place ? { order: place.order } : undefined">
    <header>
      <div>
        <h2>{{ title }}</h2>
        <p v-if="note" class="muted note">{{ note }}</p>
      </div>
      <div class="actions">
        <button v-if="kind && !asTable && !empty" type="button" class="btn-link" :aria-label="`Show ${title} as a ${kind === 'bar' ? 'line' : 'bar'} chart`" @click="kind = kind === 'bar' ? 'line' : 'bar'">
          {{ kind === 'bar' ? 'Line' : 'Bars' }}
        </button>
        <button v-if="table && !empty" type="button" class="btn-link" :aria-pressed="asTable" @click="asTable = !asTable">
          {{ asTable ? 'Chart' : 'Table' }}
        </button>
        <button v-if="!empty" type="button" class="btn-link" :aria-label="`Copy ${title} as ${asTable && table ? 'a table' : 'an image'}`" @click="copy">
          {{ copied || 'Copy' }}
        </button>
        <OverviewPin v-if="chartId" :chart-id="chartId" :title="title" />
        <slot name="actions" />
      </div>
    </header>
    <slot name="period" />
    <p v-if="empty" class="muted empty-text">{{ emptyText ?? 'Not enough brews yet.' }}</p>
    <div v-else-if="asTable && table" class="table-wrap">
      <table>
        <thead>
          <tr><th v-for="h in table.head" :key="h" scope="col">{{ h }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in table.rows" :key="i">
            <td v-for="(cell, j) in row" :key="j" :class="{ num: j > 0 }">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <slot v-else />
  </section>
</template>

<style scoped>
.chart-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  min-width: 0;
}
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
/* The title keeps its room; on a narrow card the buttons wrap below it. */
header > div:first-child {
  flex: 1 1 12rem;
  min-width: 0;
}
h2 {
  font-size: 1rem;
  margin: 0;
}
.note {
  margin: 0;
  font-size: 0.85rem;
}
header .actions {
  display: flex;
  margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) 0 auto;
  flex: none;
}
.empty-text {
  margin: 0;
  padding: var(--space-4) 0;
  text-align: center;
}
.table-wrap {
  max-height: 320px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th {
  text-align: left;
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--surface);
}
th,
td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
}
td.num,
th:not(:first-child) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>

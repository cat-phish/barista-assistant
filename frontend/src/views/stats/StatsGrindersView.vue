<script setup lang="ts">
// Insights → Grinders (§3b): brews and coffee ground per grinder, over time,
// how each rates, and grind setting against rating.
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import ChartPeriod from '../../components/charts/ChartPeriod.vue';
import StatsChart from '../../components/charts/StatsChart.vue';
import { useStats, type ChartView } from '../../composables/useStats';
import { useChartKind } from '../../lib/chartKind';
import { countBy, meanBy, OTHER, seriesByKey } from '../../lib/stats';
import { barsHeight, meansOf, pieOf, seriesTable } from './charts';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const nameOf = (id: string) => (id === OTHER ? OTHER : (stats.name(id) ?? 'Removed grinder'));
const withGrinder = computed(() => brews.value.filter((b) => b.grinderId !== null));
const without = computed(() => brews.value.length - withGrinder.value.length);

const share = computed(() => pieOf(countBy(brews.value, (b) => b.grinderId), nameOf, 'Brews'));
const useView = stats.chart('grinders');
const groundView = stats.chart('grinders-coffee');
const useKind = useChartKind('grinders');
const groundKind = useChartKind('grinders-coffee');
const over = (v: ChartView, value?: (b: (typeof brews.value)[number]) => number | null) =>
  seriesByKey(v.brews.value, v.axis.value.buckets, v.axis.value.granularity, (b) => b.grinderId, { value }).map((s) => ({
    label: nameOf(s.key),
    data: s.data.map((n) => Math.round(n * 10) / 10),
  }));
const useOverTime = computed(() => over(useView));
const groundOverTime = computed(() => over(groundView, (b) => b.doseGrams));
const rating = computed(() => meansOf(meanBy(brews.value, (b) => b.grinderId, (b) => b.rating), nameOf));

// A grind setting only means something on its own grinder: one series each,
// the three most used (more colours than that blur together on a scatter).
const showGrind = computed(() => !stats.hidden.value.has('brew.grind'));
const grind = computed(() =>
  countBy(withGrinder.value, (b) => b.grinderId)
    .slice(0, 3)
    .map((c) => ({
      label: nameOf(c.key),
      data: withGrinder.value.flatMap((b) => (b.grinderId === c.key && b.grindSetting !== null && b.rating !== null ? [{ x: b.grindSetting, y: b.rating }] : [])),
    }))
    .filter((s) => s.data.length > 0),
);
const noGrinderNote = computed(() => (without.value ? `; ${without.value} brew${without.value === 1 ? '' : 's'} without a grinder left out` : ''));
</script>

<template>
  <div class="charts">
    <ChartCard title="Brews by grinder" :note="`Brews with a grinder recorded${noGrinderNote}`" :empty="share.labels.length === 0" empty-text="No brews with a grinder yet." :table="share.table">
      <StatsChart kind="doughnut" label="Brews by grinder" :labels="share.labels" :series="share.series" />
    </ChartCard>

    <ChartCard title="Grinders over time" note="Brews on each grinder" :empty="useOverTime.length === 0" empty-text="No brews with a grinder yet." :table="seriesTable('', useView.labels.value, useOverTime)" v-model:kind="useKind">
      <template #period><ChartPeriod :view="useView" label="Grinders over time" /></template>
      <StatsChart :kind="useKind" :stacked="useKind === 'bar'" label="Brews on each grinder over time" :labels="useView.labels.value" :series="useOverTime" :height="280" />
    </ChartCard>

    <ChartCard title="Coffee ground" note="Grams through each grinder" :empty="groundOverTime.length === 0" empty-text="No brews with a grinder yet." :table="seriesTable('', groundView.labels.value, groundOverTime)" v-model:kind="groundKind">
      <template #period><ChartPeriod :view="groundView" label="Coffee ground per grinder" /></template>
      <StatsChart :kind="groundKind" :stacked="groundKind === 'bar'" label="Coffee ground on each grinder over time" :labels="groundView.labels.value" :series="groundOverTime" :format="(n) => `${n} g`" :height="280" />
    </ChartCard>

    <ChartCard title="Rating by grinder" note="Average rating; rated brews in brackets" :empty="rating.labels.length === 0" empty-text="No rated brews with a grinder yet." :table="rating.table">
      <StatsChart kind="bar" horizontal label="Average rating by grinder" :labels="rating.labels" :series="rating.series" :y-min="0" :y-max="5" :format="(n) => n.toFixed(1)" :height="barsHeight(rating.labels.length)" />
    </ChartCard>

    <ChartCard
      v-if="showGrind"
      title="Grind setting against rating"
      note="The three most used grinders"
      :empty="grind.length === 0"
      empty-text="No rated brews with a grind setting yet."
      :table="{ head: ['Grinder', 'Setting', 'Rating'], rows: grind.flatMap((s) => s.data.map((p) => [s.label, p.x, p.y])) }"
    >
      <StatsChart kind="scatter" label="Grind setting against rating" :points="grind" x-title="Grind setting" y-title="Rating" :y-min="0.5" :y-max="5.5" :height="280" />
    </ChartCard>
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: var(--space-3);
}
</style>

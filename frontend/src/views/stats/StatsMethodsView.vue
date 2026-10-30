<script setup lang="ts">
// Insights → Methods: brews by brew method (the brewer's group, §3e), over
// time, and how each rates.
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import PinnedCharts from '../../components/charts/PinnedCharts.vue';
import ChartPeriod from '../../components/charts/ChartPeriod.vue';
import StatsChart from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { useChartKind } from '../../lib/chartKind';
import { countBy, meanBy, OTHER, seriesByKey } from '../../lib/stats';
import { barsHeight, meansOf, pieOf, seriesTable } from './charts';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const nameOf = (id: string) => stats.name(id) ?? 'Removed method';

const share = computed(() => pieOf(countBy(brews.value, (b) => b.methodId), nameOf, 'Brews'));
const overView = stats.chart('methods');
const overKind = useChartKind('methods');
const labels = computed(() => overView.labels.value);
const overTime = computed(() =>
  seriesByKey(overView.brews.value, overView.axis.value.buckets, overView.axis.value.granularity, (b) => b.methodId).map((s) => ({ label: s.key === OTHER ? OTHER : nameOf(s.key), data: s.data })),
);
const rating = computed(() => meansOf(meanBy(brews.value, (b) => b.methodId, (b) => b.rating), nameOf));
</script>

<template>
  <div class="charts">
    <ChartCard chart-id="methods.share" title="Brews by method" :empty="share.labels.length === 0" :table="share.table">
      <StatsChart kind="doughnut" label="Brews by method" :labels="share.labels" :series="share.series" />
    </ChartCard>

    <ChartCard chart-id="methods.overTime" title="Methods over time" note="Brews of each method" :empty="overTime.length === 0" :table="seriesTable('', labels, overTime)" v-model:kind="overKind">
      <template #period><ChartPeriod :view="overView" label="Methods over time" /></template>
      <StatsChart :kind="overKind" :stacked="overKind === 'bar'" label="Brews of each method over time" :labels="labels" :series="overTime" :height="280" />
    </ChartCard>

    <ChartCard chart-id="methods.rating" title="Rating by method" note="Average rating; rated brews in brackets" :empty="rating.labels.length === 0" empty-text="No rated brews yet." :table="rating.table">
      <StatsChart kind="bar" horizontal label="Average rating by method" :labels="rating.labels" :series="rating.series" :y-min="0" :y-max="5" :format="(n) => n.toFixed(1)" :height="barsHeight(rating.labels.length)" />
    </ChartCard>
    <PinnedCharts tab="methods" />
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: var(--space-3);
}
</style>

<script setup lang="ts">
// Insights → Methods: brews by brew method (the brewer's group, §3e), over
// time, and how each rates.
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import StatsChart from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { countBy, meanBy, OTHER, seriesByKey } from '../../lib/stats';
import { barsHeight, meansOf, pieOf, seriesTable } from './charts';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const nameOf = (id: string) => stats.name(id) ?? 'Removed method';

const share = computed(() => pieOf(countBy(brews.value, (b) => b.methodId), nameOf, 'Brews'));
const labels = computed(() => stats.axis.value.buckets.map(stats.bucketLabel));
const overTime = computed(() =>
  seriesByKey(brews.value, stats.axis.value.buckets, stats.axis.value.granularity, (b) => b.methodId).map((s) => ({ label: s.key === OTHER ? OTHER : nameOf(s.key), data: s.data })),
);
const rating = computed(() => meansOf(meanBy(brews.value, (b) => b.methodId, (b) => b.rating), nameOf));
</script>

<template>
  <div class="charts">
    <ChartCard title="Brews by method" :empty="share.labels.length === 0" :table="share.table">
      <StatsChart kind="doughnut" label="Brews by method" :labels="share.labels" :series="share.series" />
    </ChartCard>

    <ChartCard title="Methods over time" note="Brews of each method" :empty="overTime.length === 0" :table="seriesTable('', labels, overTime)">
      <StatsChart kind="bar" stacked label="Brews of each method over time" :labels="labels" :series="overTime" :height="280" />
    </ChartCard>

    <ChartCard title="Rating by method" note="Average rating; rated brews in brackets" :empty="rating.labels.length === 0" empty-text="No rated brews yet." :table="rating.table">
      <StatsChart kind="bar" horizontal label="Average rating by method" :labels="rating.labels" :series="rating.series" :y-min="0" :y-max="5" :format="(n) => n.toFixed(1)" :height="barsHeight(rating.labels.length)" />
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

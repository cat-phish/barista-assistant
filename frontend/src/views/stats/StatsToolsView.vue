<script setup lang="ts">
// Insights → Prep tools (§3d): how often each tool is used, over time, and
// the rating with it against without it. A brew can use several tools, so
// shares don't add up to 100% and there's no "Other".
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import StatsChart from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { countBy, ratingWithWithout, seriesByKey } from '../../lib/stats';
import { barsHeight, seriesTable } from './charts';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const nameOf = (id: string) => stats.name(id) ?? 'Removed tool';
const pct = (n: number) => Math.round((n / Math.max(1, brews.value.length)) * 100);

const counts = computed(() => countBy(brews.value, (b) => b.toolIds));
const share = computed(() => ({
  labels: counts.value.map((c) => nameOf(c.key)),
  series: [{ label: 'Share of brews', data: counts.value.map((c) => pct(c.n)) }],
  table: { head: ['Tool', 'Brews', 'Share'], rows: counts.value.map((c) => [nameOf(c.key), c.n, `${pct(c.n)}%`]) },
}));

const labels = computed(() => stats.axis.value.buckets.map(stats.bucketLabel));
// The five most used, as lines: one brew can be under several.
const overTime = computed(() =>
  seriesByKey(brews.value, stats.axis.value.buckets, stats.axis.value.granularity, (b) => b.toolIds, { keep: 5, other: false }).map((s) => ({ label: nameOf(s.key), data: s.data })),
);

// Tools with rated brews both with and without them.
const compare = computed(() => {
  const rows = ratingWithWithout(brews.value, counts.value.map((c) => c.key)).filter((r) => r.with && r.without);
  return {
    labels: rows.map((r) => nameOf(r.key)),
    series: [
      { label: 'With', data: rows.map((r) => r.with!.mean) },
      { label: 'Without', data: rows.map((r) => r.without!.mean) },
    ],
    table: { head: ['Tool', 'With', 'Brews', 'Without', 'Brews'], rows: rows.map((r) => [nameOf(r.key), r.with!.mean.toFixed(2), r.with!.n, r.without!.mean.toFixed(2), r.without!.n]) },
  };
});
</script>

<template>
  <div class="charts">
    <ChartCard title="How often each tool is used" note="Share of brews that ticked it" :empty="counts.length === 0" empty-text="No prep tools ticked in this period." :table="share.table">
      <StatsChart kind="bar" horizontal label="Share of brews using each prep tool" :labels="share.labels" :series="share.series" :y-min="0" :y-max="100" :format="(n) => `${n}%`" :height="barsHeight(share.labels.length)" />
    </ChartCard>

    <ChartCard title="Tools over time" note="Brews using each of the five most used tools" :empty="overTime.length === 0" empty-text="No prep tools ticked in this period." :table="seriesTable('', labels, overTime)">
      <StatsChart kind="line" label="Brews using each prep tool over time" :labels="labels" :series="overTime" :height="280" />
    </ChartCard>

    <ChartCard
      title="Rating with and without"
      note="Average rating of rated brews that did and didn't use each tool"
      :empty="compare.labels.length === 0"
      empty-text="Needs rated brews both with and without a tool."
      :table="compare.table"
    >
      <StatsChart kind="bar" horizontal label="Average rating with and without each prep tool" :labels="compare.labels" :series="compare.series" :y-min="0" :y-max="5" :format="(n) => n.toFixed(1)" :height="barsHeight(compare.labels.length * 2)" />
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

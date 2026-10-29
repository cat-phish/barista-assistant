<script setup lang="ts">
// Stats → Brews: how much and how well, over time; when people brew; the
// extraction chart; what goes wrong (docs/roadmap.md, "Insights").
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import StatsChart, { type Box } from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { VOLUME_LABELS } from '../../lib/units';
import { brewEY, countBy, cumulative, localHour, localWeekday, meanByBucket, sumByBucket } from '../../lib/stats';
import type { RecipeStyle } from '../../api/types';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const axis = computed(() => stats.axis.value);
const labels = computed(() => axis.value.buckets.map(stats.bucketLabel));
const per = computed(() => ({ day: 'day', week: 'week', month: 'month' })[axis.value.granularity]);
const unit = computed(() => VOLUME_LABELS[stats.filters.value.unit]);

const perBucket = computed(() => sumByBucket(brews.value, axis.value.buckets, axis.value.granularity));
const total = computed(() => cumulative(perBucket.value));
const volume = computed(() => sumByBucket(brews.value, axis.value.buckets, axis.value.granularity, (b) => stats.volume(b)?.ml ?? null).map(stats.volumeIn));
const coffee = computed(() => sumByBucket(brews.value, axis.value.buckets, axis.value.granularity, (b) => b.doseGrams).map((g) => Math.round(g * 10) / 10));
const rating = computed(() => meanByBucket(brews.value, axis.value.buckets, axis.value.granularity, (b) => b.rating));
const anyRated = computed(() => rating.value.some((r) => r !== null));

const table = (head: string, values: Array<number | null>, fmt: (n: number) => string = String) => ({
  head: [per.value === 'day' ? 'Day' : per.value === 'week' ? 'Week of' : 'Month', head],
  rows: labels.value.map((l, i) => [l, values[i] === null || values[i] === undefined ? '–' : fmt(values[i]!)]),
});

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const byWeekday = computed(() => WEEKDAYS.map((_, d) => brews.value.filter((b) => localWeekday(b) === d).length));
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const byHour = computed(() => HOURS.map((_, h) => brews.value.filter((b) => localHour(b) === h).length));

// Filter-style brews only: a shot or moka pot sits far outside the brewing chart.
const CONCENTRATED: readonly RecipeStyle[] = ['standard', 'soup', 'moka'];
const showTds = computed(() => !stats.hidden.value.has('brew.tds'));
const extraction = computed(() =>
  brews.value.flatMap((b) => {
    const ey = brewEY(b);
    return ey !== null && b.tdsPercent !== null && !(b.brewsLike && CONCENTRATED.includes(b.brewsLike)) && b.tdsPercent <= 3 ? [{ x: ey, y: b.tdsPercent }] : [];
  }),
);
// The usual brewing-chart target: 18–22% extracted at 1.15–1.45% TDS.
const TARGET: Box = { xMin: 18, xMax: 22, yMin: 1.15, yMax: 1.45 };
const inTarget = computed(() => extraction.value.filter((p) => p.x >= TARGET.xMin && p.x <= TARGET.xMax && p.y >= TARGET.yMin && p.y <= TARGET.yMax).length);

const showProblems = computed(() => !stats.hidden.value.has('brew.problems'));
const problems = computed(() => countBy(brews.value, (b) => b.problemIds).map((c) => ({ name: stats.name(c.key) ?? 'Removed problem', n: c.n })));
const pct = (n: number) => `${Math.round((n / Math.max(1, brews.value.length)) * 100)}%`;
</script>

<template>
  <div class="charts">
    <ChartCard title="Brews over time" note="Running total in this period" :empty="brews.length === 0" :table="table('Total', total)">
      <StatsChart kind="line" label="Running total of brews" :labels="labels" :series="[{ label: 'Brews', data: total }]" fill />
    </ChartCard>

    <ChartCard :title="`Brews per ${per}`" :empty="brews.length === 0" :table="table('Brews', perBucket)">
      <StatsChart kind="bar" :label="`Brews per ${per}`" :labels="labels" :series="[{ label: 'Brews', data: perBucket }]" />
    </ChartCard>

    <ChartCard
      title="Volume drunk"
      :note="`${unit} per ${per}; a drink's size, else the yield (weighed or estimated)`"
      :empty="brews.length === 0"
      :table="table(unit, volume)"
    >
      <StatsChart kind="bar" :label="`Volume drunk per ${per}`" :labels="labels" :series="[{ label: unit, data: volume }]" />
    </ChartCard>

    <ChartCard title="Coffee ground" :note="`Grams per ${per}`" :empty="brews.length === 0" :table="table('Grams', coffee)">
      <StatsChart kind="bar" :label="`Coffee ground per ${per}`" :labels="labels" :series="[{ label: 'g', data: coffee }]" />
    </ChartCard>

    <ChartCard title="Average rating" :note="`Per ${per}, rated brews only`" :empty="!anyRated" empty-text="No rated brews yet." :table="table('Rating', rating)">
      <StatsChart kind="line" label="Average rating over time" :labels="labels" :series="[{ label: 'Rating', data: rating }]" :y-min="1" :y-max="5" />
    </ChartCard>

    <ChartCard title="By day of the week" :empty="brews.length === 0" :table="{ head: ['Day', 'Brews'], rows: WEEKDAYS.map((d, i) => [d, byWeekday[i]!]) }">
      <StatsChart kind="bar" label="Brews by day of the week" :labels="WEEKDAYS" :series="[{ label: 'Brews', data: byWeekday }]" :height="200" />
    </ChartCard>

    <ChartCard title="By time of day" note="Hour the brew was logged, local time" :empty="brews.length === 0" :table="{ head: ['Hour', 'Brews'], rows: HOURS.map((h, i) => [`${h}:00`, byHour[i]!]).filter((r) => r[1] !== 0) }">
      <StatsChart kind="bar" label="Brews by hour of the day" :labels="HOURS" :series="[{ label: 'Brews', data: byHour }]" :height="200" />
    </ChartCard>

    <ChartCard
      v-if="showTds"
      title="Extraction against strength"
      :note="extraction.length ? `${inTarget} of ${extraction.length} in the 18–22% / 1.15–1.45% box (filter brews with a TDS reading)` : undefined"
      :empty="extraction.length === 0"
      empty-text="No filter brews with a TDS reading yet."
      :table="{ head: ['Extraction %', 'TDS %'], rows: extraction.map((p) => [p.x, p.y]) }"
    >
      <StatsChart
        kind="scatter"
        label="Extraction yield against TDS"
        :points="[{ label: 'Brews', data: extraction }]"
        :box="TARGET"
        x-title="Extraction yield %"
        y-title="TDS %"
        :height="280"
      />
    </ChartCard>

    <ChartCard
      v-if="showProblems"
      title="What went wrong"
      note="Brews that ticked each problem"
      :empty="problems.length === 0"
      empty-text="No problems ticked in this period."
      :table="{ head: ['Problem', 'Brews', 'Share'], rows: problems.map((p) => [p.name, p.n, pct(p.n)]) }"
    >
      <StatsChart
        kind="bar"
        horizontal
        label="Brews by problem"
        :labels="problems.map((p) => p.name)"
        :series="[{ label: 'Brews', data: problems.map((p) => p.n) }]"
        :height="Math.max(120, problems.length * 32 + 40)"
      />
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

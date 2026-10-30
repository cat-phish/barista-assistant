<script setup lang="ts">
// Stats → Brews: how much and how well, over time; when people brew; the
// extraction chart; what goes wrong (docs/roadmap.md, "Insights").
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import PinnedCharts from '../../components/charts/PinnedCharts.vue';
import ChartPeriod from '../../components/charts/ChartPeriod.vue';
import StatsChart, { type Box } from '../../components/charts/StatsChart.vue';
import { useStats, type ChartView } from '../../composables/useStats';
import { VOLUME_LABELS } from '../../lib/units';
import { useChartKind } from '../../lib/chartKind';
import { brewEY, countBy, cumulative, localHour, localWeekday, meanByBucket, sumByBucket } from '../../lib/stats';
import type { RecipeStyle, StatsBrew } from '../../api/types';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const unit = computed(() => VOLUME_LABELS[stats.filters.value.unit]);

// Each over-time chart has its own period, so its own brews and buckets.
const totalView = stats.chart('total');
const countView = stats.chart('count');
const volumeView = stats.chart('volume');
const coffeeView = stats.chart('coffee');
const ratingView = stats.chart('rating');
const countKind = useChartKind('count');
const volumeKind = useChartKind('volume');
const coffeeKind = useChartKind('coffee');
const per = (v: ChartView) => v.axis.value.granularity;
const sum = (v: ChartView, value?: (b: StatsBrew) => number | null) => sumByBucket(v.brews.value, v.axis.value.buckets, v.axis.value.granularity, value);

const total = computed(() => cumulative(sum(totalView)));
const perBucket = computed(() => sum(countView));
const volume = computed(() => sum(volumeView, (b) => stats.volume(b)?.ml ?? null).map(stats.volumeIn));
const coffee = computed(() => sum(coffeeView, (b) => b.doseGrams).map((g) => Math.round(g * 10) / 10));
const rating = computed(() => meanByBucket(ratingView.brews.value, ratingView.axis.value.buckets, ratingView.axis.value.granularity, (b) => b.rating));
const anyRated = computed(() => rating.value.some((r) => r !== null));

const table = (v: ChartView, head: string, values: Array<number | null>, fmt: (n: number) => string = String) => ({
  head: [per(v) === 'day' ? 'Day' : per(v) === 'week' ? 'Week of' : 'Month', head],
  rows: v.labels.value.map((l, i) => [l, values[i] === null || values[i] === undefined ? '–' : fmt(values[i]!)]),
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

// Extraction against rating: does the 18–22% band taste better here? Shots and
// moka pots as their own series, as they're judged differently.
const EY_BAND: Box = { xMin: TARGET.xMin, xMax: TARGET.xMax, yMin: 0.5, yMax: 5.5 };
const eyRated = computed(() =>
  brews.value.flatMap((b) => {
    const ey = brewEY(b);
    return ey !== null && b.rating !== null ? [{ x: ey, y: b.rating, concentrated: !!b.brewsLike && CONCENTRATED.includes(b.brewsLike) }] : [];
  }),
);
const eyRatingSeries = computed(() =>
  [
    { label: 'Filter', data: eyRated.value.filter((p) => !p.concentrated).map(({ x, y }) => ({ x, y })) },
    { label: 'Espresso & moka', data: eyRated.value.filter((p) => p.concentrated).map(({ x, y }) => ({ x, y })) },
  ].filter((s) => s.data.length > 0),
);
const eyRatingNote = computed(() => {
  const mean = (ps: Array<{ y: number }>) => (ps.length ? (ps.reduce((sum, p) => sum + p.y, 0) / ps.length).toFixed(1) : '–');
  const inBand = eyRated.value.filter((p) => p.x >= EY_BAND.xMin && p.x <= EY_BAND.xMax);
  const outside = eyRated.value.filter((p) => p.x < EY_BAND.xMin || p.x > EY_BAND.xMax);
  return `Rated brews with a TDS reading. Average rating ${mean(inBand)} in 18–22% (${inBand.length}), ${mean(outside)} outside it (${outside.length})`;
});

const showProblems = computed(() => !stats.hidden.value.has('brew.problems'));
const problems = computed(() => countBy(brews.value, (b) => b.problemIds).map((c) => ({ name: stats.name(c.key) ?? 'Removed problem', n: c.n })));
const pct = (n: number) => `${Math.round((n / Math.max(1, brews.value.length)) * 100)}%`;
</script>

<template>
  <div class="charts">
    <ChartCard chart-id="brews.total" title="Brews over time" note="Running total in this period" :empty="totalView.brews.value.length === 0" :table="table(totalView, 'Total', total)">
      <template #period><ChartPeriod :view="totalView" label="Brews over time" /></template>
      <StatsChart kind="line" label="Running total of brews" :labels="totalView.labels.value" :series="[{ label: 'Brews', data: total }]" fill />
    </ChartCard>

    <ChartCard chart-id="brews.count" :title="`Brews per ${per(countView)}`" :empty="countView.brews.value.length === 0" :table="table(countView, 'Brews', perBucket)" v-model:kind="countKind">
      <template #period><ChartPeriod :view="countView" :label="`Brews per ${per(countView)}`" /></template>
      <StatsChart :kind="countKind" :label="`Brews per ${per(countView)}`" :labels="countView.labels.value" :series="[{ label: 'Brews', data: perBucket }]" />
    </ChartCard>

    <ChartCard chart-id="brews.volume"
      title="Volume drunk"
      :note="`${unit} per ${per(volumeView)}; a drink's size, else the yield (weighed or estimated)`"
      :empty="volumeView.brews.value.length === 0"
      :table="table(volumeView, unit, volume)"
      v-model:kind="volumeKind"
    >
      <template #period><ChartPeriod :view="volumeView" label="Volume drunk" /></template>
      <StatsChart :kind="volumeKind" :label="`Volume drunk per ${per(volumeView)}`" :labels="volumeView.labels.value" :series="[{ label: unit, data: volume }]" />
    </ChartCard>

    <ChartCard chart-id="brews.coffee" title="Coffee ground" :note="`Grams per ${per(coffeeView)}`" :empty="coffeeView.brews.value.length === 0" :table="table(coffeeView, 'Grams', coffee)" v-model:kind="coffeeKind">
      <template #period><ChartPeriod :view="coffeeView" label="Coffee ground" /></template>
      <StatsChart :kind="coffeeKind" :label="`Coffee ground per ${per(coffeeView)}`" :labels="coffeeView.labels.value" :series="[{ label: 'g', data: coffee }]" />
    </ChartCard>

    <ChartCard chart-id="brews.rating"
      title="Average rating"
      :note="`Per ${per(ratingView)}, rated brews only`"
      :empty="!anyRated"
      empty-text="No rated brews yet."
      :table="table(ratingView, 'Rating', rating)"
    >
      <template #period><ChartPeriod :view="ratingView" label="Average rating" /></template>
      <StatsChart kind="line" label="Average rating over time" :labels="ratingView.labels.value" :series="[{ label: 'Rating', data: rating }]" :y-min="1" :y-max="5" />
    </ChartCard>

    <ChartCard chart-id="brews.weekday" title="By day of the week" :empty="brews.length === 0" :table="{ head: ['Day', 'Brews'], rows: WEEKDAYS.map((d, i) => [d, byWeekday[i]!]) }">
      <StatsChart kind="bar" label="Brews by day of the week" :labels="WEEKDAYS" :series="[{ label: 'Brews', data: byWeekday }]" :height="200" />
    </ChartCard>

    <ChartCard chart-id="brews.hour" title="By time of day" note="Hour the brew was logged, local time" :empty="brews.length === 0" :table="{ head: ['Hour', 'Brews'], rows: HOURS.map((h, i) => [`${h}:00`, byHour[i]!]).filter((r) => r[1] !== 0) }">
      <StatsChart kind="bar" label="Brews by hour of the day" :labels="HOURS" :series="[{ label: 'Brews', data: byHour }]" :height="200" />
    </ChartCard>

    <ChartCard chart-id="brews.extraction"
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

    <ChartCard chart-id="brews.eyRating"
      v-if="showTds"
      title="Extraction against rating"
      :note="eyRated.length ? eyRatingNote : undefined"
      :empty="eyRated.length === 0"
      empty-text="No rated brews with a TDS reading yet."
      :table="{ head: ['Extraction %', 'Rating', 'Style'], rows: eyRated.map((p) => [p.x, p.y, p.concentrated ? 'Espresso & moka' : 'Filter']) }"
    >
      <StatsChart
        kind="scatter"
        label="Extraction yield against rating"
        :points="eyRatingSeries"
        :box="EY_BAND"
        x-title="Extraction yield %"
        y-title="Rating"
        :y-min="0.5"
        :y-max="5.5"
        :height="280"
      />
    </ChartCard>

    <ChartCard chart-id="brews.problems"
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
    <PinnedCharts tab="brews" />
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: var(--space-3);
}
</style>

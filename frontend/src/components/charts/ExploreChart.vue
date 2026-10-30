<script setup lang="ts">
// One Explore chart (docs/roadmap.md, "Insights"): two numbers as a scatter
// with a trend line, or a group as a bar of averages. On the Explore tab it
// draws the live picks; on another tab, a chart the person added there
// (`strict`: not drawn when a pick is hidden or no longer known).
import { computed } from 'vue';
import type { StatsBrew } from '../../api/types';
import { useExplore, type ExplorePicks } from '../../composables/useExplore';
import { builtIn, linearFit, strength, type ExploreField, type NumberField } from '../../lib/explore';
import { countBy, meanBy, OTHER } from '../../lib/stats';
import { barsHeight } from '../../views/stats/charts';
import ChartCard from './ChartCard.vue';
import StatsChart, { type PointSeries } from './StatsChart.vue';

const props = defineProps<{ picks: ExplorePicks; strict?: boolean; layoutId?: string }>();
const { stats, ctx, x, y, exact, color, label, grinder, brews } = useExplore(() => props.picks);
const show = computed(() => !props.strict || exact.value);
const xLabel = computed(() => label(x.value));
const yLabel = computed(() => label(y.value));
const grinderNote = computed(() => (grinder.value ? `On ${stats.name(grinder.value) ?? 'a removed grinder'}.` : ''));

// ── A number: one point per brew ──
const points = computed(() =>
  brews.value.flatMap((b) => {
    if (x.value.kind !== 'number') return [];
    const xv = x.value.value(b, ctx.value);
    const yv = y.value.value(b, ctx.value);
    return xv === null || yv === null ? [] : [{ x: xv, y: yv, brew: b }];
  }),
);
// Colour by a category: its three biggest groups (more blur together on a scatter), the rest grey.
const pointSeries = computed<PointSeries[]>(() => {
  const all = points.value.map(({ x: px, y: py }) => ({ x: px, y: py }));
  const by = color.value;
  if (!by) return [{ label: 'Brews', data: all }];
  const keyOf = (b: StatsBrew) => {
    const k = by.value(b, ctx.value);
    return typeof k === 'string' ? k : null;
  };
  const top = countBy(points.value, (p) => keyOf(p.brew)).slice(0, 3).map((c) => c.key);
  const series = top.map((key) => ({ label: by.name(key, ctx.value), data: points.value.filter((p) => keyOf(p.brew) === key).map(({ x: px, y: py }) => ({ x: px, y: py })) }));
  const rest = points.value.filter((p) => !top.includes(keyOf(p.brew) ?? ''));
  if (rest.length) series.push({ label: OTHER, data: rest.map(({ x: px, y: py }) => ({ x: px, y: py })) });
  return series;
});
const fit = computed(() => linearFit(points.value));
const trend = computed(() => {
  const f = fit.value;
  if (!f) return null;
  const xs = points.value.map((p) => p.x);
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  return { x1, y1: f.intercept + f.slope * x1, x2, y2: f.intercept + f.slope * x2 };
});
const fitNote = computed(() => {
  const f = fit.value;
  if (!f) return points.value.length ? 'Needs at least 3 brews with different values for a trend' : undefined;
  const built = builtIn(x.value, y.value) ? ' One is worked out from the other, so part of this link is just arithmetic.' : '';
  return `${f.n} brews: ${strength(f.r)} (r = ${f.r.toFixed(2)}).${built} A link isn't proof of cause; other things change between brews too.`;
});

// ── A category: the average result in each ──
const means = computed(() => {
  const field = x.value;
  if (field.kind !== 'category') return [];
  return meanBy(brews.value, (b) => field.value(b, ctx.value), (b) => y.value.value(b, ctx.value)).slice(0, 15).map((m) => ({ ...m, name: field.name(m.key, ctx.value) }));
});
const fmtOf = (f: NumberField) => (n: number) => (f.decimals !== undefined ? n.toFixed(f.decimals) : Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
const fmtX = computed(() => (x.value.kind === 'number' ? fmtOf(x.value) : String));
const fmtY = computed(() => fmtOf(y.value));
// A rating's axis: half a step of room each side on a scatter, from 0 on bars.
const scatterScale = (f: ExploreField) => (f.kind === 'number' && f.scale ? { min: f.scale.min - 0.5, max: f.scale.max + 0.5 } : { min: undefined, max: undefined });
const xScale = computed(() => scatterScale(x.value));
const yScale = computed(() => scatterScale(y.value));
const barScale = computed(() => (y.value.scale ? { min: 0, max: y.value.scale.max } : { min: undefined, max: undefined }));
</script>

<template>
  <template v-if="show">
  <ChartCard
    :layout-id="layoutId"
    v-if="x.kind === 'number'"
    :title="`${yLabel} against ${xLabel.toLowerCase()}`"
    :note="[grinderNote, fitNote].filter(Boolean).join(' ') || undefined"
    :empty="points.length === 0"
    empty-text="No brews have both of these yet."
    :table="{ head: [xLabel, yLabel], rows: points.map((p) => [fmtX(p.x), fmtY(p.y)]) }"
  >
    <template #actions><slot name="actions" /></template>
    <StatsChart
      kind="scatter"
      :label="`${yLabel} against ${xLabel}`"
      :points="pointSeries"
      :trend="trend"
      :x-title="xLabel"
      :y-title="yLabel"
      :format="fmtY"
      :format-x="fmtX"
      :x-min="xScale.min"
      :x-max="xScale.max"
      :y-min="yScale.min"
      :y-max="yScale.max"
      :height="340"
    />
  </ChartCard>

  <ChartCard
    :layout-id="layoutId"
    v-else
    :title="`${yLabel} by ${xLabel.toLowerCase()}`"
    :note="[grinderNote, 'The average for each; the number of brews in brackets. Small groups swing easily.'].filter(Boolean).join(' ')"
    :empty="means.length === 0"
    empty-text="No brews have both of these yet."
    :table="{ head: [xLabel, `Average ${yLabel.toLowerCase()}`, 'Brews'], rows: means.map((m) => [m.name, fmtY(m.mean), m.n]) }"
  >
    <template #actions><slot name="actions" /></template>
    <StatsChart
      kind="bar"
      horizontal
      :label="`Average ${yLabel} by ${xLabel}`"
      :labels="means.map((m) => `${m.name} (${m.n})`)"
      :series="[{ label: `Average ${yLabel.toLowerCase()}`, data: means.map((m) => m.mean) }]"
      :format="fmtY"
      :y-min="barScale.min"
      :y-max="barScale.max"
      :height="barsHeight(means.length)"
    />
  </ChartCard>
  </template>
</template>

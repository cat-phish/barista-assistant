<script setup lang="ts">
// Insights → Explore: pick a brew detail and a result. A number gives a
// scatter with a trend line; a category gives the average result for each.
// The picks live in the URL (?x=&y=&color=&grinder=), so a view can be shared.
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StatsBrew } from '../../api/types';
import ChartCard from '../../components/charts/ChartCard.vue';
import StatsChart, { type PointSeries } from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { COLOR_BY, INPUTS, linearFit, RESULTS, strength, visible, type CategoryField, type ExploreContext } from '../../lib/explore';
import { countBy, meanBy, OTHER } from '../../lib/stats';
import { VOLUME_LABELS } from '../../lib/units';
import { barsHeight } from './charts';

const stats = useStats();
const route = useRoute();
const router = useRouter();

const ctx = computed<ExploreContext>(() => ({
  bean: stats.bean,
  name: stats.name,
  volume: stats.volume,
  volumeIn: stats.volumeIn,
  volumeLabel: VOLUME_LABELS[stats.filters.value.unit],
}));

const inputs = computed(() => visible(INPUTS, stats.hidden.value));
const results = computed(() => visible(RESULTS, stats.hidden.value));
const colorFields = computed(() => visible(COLOR_BY, stats.hidden.value));

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
function pick(key: string, value: string): void {
  const query = { ...route.query, [key]: value || undefined };
  void router.replace({ query });
}

const x = computed(() => inputs.value.find((f) => f.key === q('x')) ?? inputs.value.find((f) => f.key === 'roastAge')!);
const y = computed(() => results.value.find((f) => f.key === q('y')) ?? results.value[0]!);
const color = computed<CategoryField | null>(() => (x.value.kind === 'number' ? (colorFields.value.find((f) => f.key === q('color')) ?? null) : null));
const yLabel = computed(() => (y.value.key === 'volume' ? `Volume drunk (${ctx.value.volumeLabel})` : y.value.label));

// Grind settings only compare on one grinder: the picked one, else the most used.
const grinders = computed(() => countBy(stats.brews.value.filter((b) => b.grindSetting !== null), (b) => b.grinderId));
const grinder = computed(() => (x.value.key !== 'grind' ? null : (grinders.value.find((g) => g.key === q('grinder'))?.key ?? grinders.value[0]?.key ?? null)));
const brews = computed<StatsBrew[]>(() => (grinder.value ? stats.brews.value.filter((b) => b.grinderId === grinder.value) : stats.brews.value));

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
  return `${f.n} brews: ${strength(f.r)} (r = ${f.r.toFixed(2)}). A link isn't proof of cause; other things change between brews too.`;
});

// ── A category: the average result in each ──
const means = computed(() => {
  const field = x.value;
  if (field.kind !== 'category') return [];
  return meanBy(brews.value, (b) => field.value(b, ctx.value), (b) => y.value.value(b, ctx.value)).slice(0, 15).map((m) => ({ ...m, name: field.name(m.key, ctx.value) }));
});
const fmtY = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(y.value.key === 'tds' ? 2 : 1));
const ratingScale = computed(() => (y.value.key === 'rating' || y.value.key === 'drinkRating' ? { min: 0, max: 5 } : { min: undefined, max: undefined }));

const value = (e: Event) => (e.target as HTMLSelectElement).value;
</script>

<template>
  <div class="explore">
    <div class="picks" role="group" aria-label="What to compare">
      <div class="field">
        <label for="explore-x">Compare</label>
        <select id="explore-x" :value="x.key" @change="pick('x', value($event))">
          <optgroup label="Numbers">
            <option v-for="f in inputs.filter((f) => f.kind === 'number')" :key="f.key" :value="f.key">{{ f.label }}</option>
          </optgroup>
          <optgroup label="Groups">
            <option v-for="f in inputs.filter((f) => f.kind === 'category')" :key="f.key" :value="f.key">{{ f.label }}</option>
          </optgroup>
        </select>
      </div>
      <div class="field">
        <label for="explore-y">With</label>
        <select id="explore-y" :value="y.key" @change="pick('y', value($event))">
          <option v-for="f in results" :key="f.key" :value="f.key">{{ f.key === 'volume' ? yLabel : f.label }}</option>
        </select>
      </div>
      <div v-if="x.key === 'grind' && grinders.length" class="field">
        <label for="explore-grinder">Grinder</label>
        <select id="explore-grinder" :value="grinder ?? ''" @change="pick('grinder', value($event))">
          <option v-for="g in grinders" :key="g.key" :value="g.key">{{ stats.name(g.key) ?? 'Removed grinder' }} ({{ g.n }})</option>
        </select>
      </div>
      <div v-if="x.kind === 'number'" class="field">
        <label for="explore-color">Colour by</label>
        <select id="explore-color" :value="color?.key ?? ''" @change="pick('color', value($event))">
          <option value="">Nothing</option>
          <option v-for="f in colorFields" :key="f.key" :value="f.key">{{ f.label }}</option>
        </select>
      </div>
    </div>

    <ChartCard
      v-if="x.kind === 'number'"
      :title="`${yLabel} against ${x.label.toLowerCase()}`"
      :note="fitNote"
      :empty="points.length === 0"
      empty-text="No brews have both of these yet."
      :table="{ head: [x.label, yLabel], rows: points.map((p) => [p.x, fmtY(p.y)]) }"
    >
      <StatsChart
        kind="scatter"
        :label="`${yLabel} against ${x.label}`"
        :points="pointSeries"
        :trend="trend"
        :x-title="x.label"
        :y-title="yLabel"
        :format="fmtY"
        :y-min="ratingScale.min"
        :y-max="ratingScale.max"
        :height="340"
      />
    </ChartCard>

    <ChartCard
      v-else
      :title="`${yLabel} by ${x.label.toLowerCase()}`"
      note="The average for each; the number of brews in brackets. Small groups swing easily."
      :empty="means.length === 0"
      empty-text="No brews have both of these yet."
      :table="{ head: [x.label, `Average ${yLabel.toLowerCase()}`, 'Brews'], rows: means.map((m) => [m.name, fmtY(m.mean), m.n]) }"
    >
      <StatsChart
        kind="bar"
        horizontal
        :label="`Average ${yLabel} by ${x.label}`"
        :labels="means.map((m) => `${m.name} (${m.n})`)"
        :series="[{ label: `Average ${yLabel.toLowerCase()}`, data: means.map((m) => m.mean) }]"
        :format="fmtY"
        :y-min="ratingScale.min"
        :y-max="ratingScale.max"
        :height="barsHeight(means.length)"
      />
    </ChartCard>
  </div>
</template>

<style scoped>
.explore {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-2) var(--space-3);
}
.field select {
  width: 100%;
}
</style>

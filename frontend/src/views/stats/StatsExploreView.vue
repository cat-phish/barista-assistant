<script setup lang="ts">
// Insights → Explore: pick two numbers for a scatter with a trend line, or a
// group (Compare only) for the average of a number in each. Never one field
// against itself.
// The picks live in the URL (?x=&y=&color=&grinder=), so a view can be shared.
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StatsBrew } from '../../api/types';
import ChartCard from '../../components/charts/ChartCard.vue';
import StatsChart, { type PointSeries } from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { builtIn, COLOR_BY, fieldLabel, GROUPS, linearFit, NUMBERS, pickAxes, strength, visible, type CategoryField, type ExploreContext, type ExploreField, type NumberField } from '../../lib/explore';
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

const numbers = computed(() => visible(NUMBERS, stats.hidden.value));
const groups = computed(() => visible(GROUPS, stats.hidden.value));
const colorFields = computed(() => visible(COLOR_BY, stats.hidden.value));

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
function pick(key: string, value: string): void {
  const query = { ...route.query, [key]: value || undefined };
  void router.replace({ query });
}

const axes = computed(() => pickAxes(q('x'), q('y'), numbers.value, groups.value));
const x = computed(() => axes.value.x);
const y = computed(() => axes.value.y);
const color = computed<CategoryField | null>(() => (x.value.kind === 'number' ? (colorFields.value.find((f) => f.key === q('color')) ?? null) : null));
const label = (f: ExploreField) => fieldLabel(f, ctx.value);
const xLabel = computed(() => label(x.value));
const yLabel = computed(() => label(y.value));
const resultNumbers = computed(() => numbers.value.filter((f) => f.group === 'result'));
const brewNumbers = computed(() => numbers.value.filter((f) => f.group === 'brew'));

// Both numbers: swap which goes across.
const swap = () => void router.replace({ query: { ...route.query, x: y.value.key, y: x.value.key } });

// Grind settings only compare on one grinder: the picked one, else the most used.
const grinders = computed(() => countBy(stats.brews.value.filter((b) => b.grindSetting !== null), (b) => b.grinderId));
const onGrind = computed(() => x.value.key === 'grind' || y.value.key === 'grind');
const grinder = computed(() => (!onGrind.value ? null : (grinders.value.find((g) => g.key === q('grinder'))?.key ?? grinders.value[0]?.key ?? null)));
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

const value = (e: Event) => (e.target as HTMLSelectElement).value;
</script>

<template>
  <div class="explore">
    <div class="picks" role="group" aria-label="What to compare">
      <div class="field">
        <label for="explore-x">Compare</label>
        <select id="explore-x" :value="x.key" @change="pick('x', value($event))">
          <optgroup label="Results">
            <option v-for="f in resultNumbers" :key="f.key" :value="f.key" :disabled="f.key === y.key">{{ label(f) }}</option>
          </optgroup>
          <optgroup label="Brew & bean">
            <option v-for="f in brewNumbers" :key="f.key" :value="f.key" :disabled="f.key === y.key">{{ label(f) }}</option>
          </optgroup>
          <optgroup label="Groups">
            <option v-for="f in groups" :key="f.key" :value="f.key">{{ f.label }}</option>
          </optgroup>
        </select>
      </div>
      <div class="field">
        <label for="explore-y">With</label>
        <div class="with">
          <select id="explore-y" :value="y.key" @change="pick('y', value($event))">
            <optgroup label="Results">
              <option v-for="f in resultNumbers" :key="f.key" :value="f.key" :disabled="f.key === x.key">{{ label(f) }}</option>
            </optgroup>
            <optgroup label="Brew & bean">
              <option v-for="f in brewNumbers" :key="f.key" :value="f.key" :disabled="f.key === x.key">{{ label(f) }}</option>
            </optgroup>
          </select>
          <button v-if="x.kind === 'number'" type="button" class="btn-link swap" aria-label="Swap the two" title="Swap the two" @click="swap">⇅</button>
        </div>
      </div>
      <div v-if="onGrind && grinders.length" class="field">
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
      :title="`${yLabel} against ${xLabel.toLowerCase()}`"
      :note="fitNote"
      :empty="points.length === 0"
      empty-text="No brews have both of these yet."
      :table="{ head: [xLabel, yLabel], rows: points.map((p) => [fmtX(p.x), fmtY(p.y)]) }"
    >
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
      v-else
      :title="`${yLabel} by ${xLabel.toLowerCase()}`"
      note="The average for each; the number of brews in brackets. Small groups swing easily."
      :empty="means.length === 0"
      empty-text="No brews have both of these yet."
      :table="{ head: [xLabel, `Average ${yLabel.toLowerCase()}`, 'Brews'], rows: means.map((m) => [m.name, fmtY(m.mean), m.n]) }"
    >
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
.with {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}
.swap {
  flex: none;
  font-size: 1.1rem;
  min-width: 44px;
  min-height: 44px;
}
</style>

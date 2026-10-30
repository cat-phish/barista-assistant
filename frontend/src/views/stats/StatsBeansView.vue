<script setup lang="ts">
// Insights → Beans: where the coffee came from and how it rated, spend over
// time, rating against roast age, and coffee used vs stock left per bean.
// Which beans: all of them unfiltered; with a filter, the ones it brewed.
import { computed } from 'vue';
import type { CoffeeSpecies, OriginArea, RoastLevel, StatsBean, StatsBrew } from '../../api/types';
import ChartCard from '../../components/charts/ChartCard.vue';
import ChartPeriod from '../../components/charts/ChartPeriod.vue';
import StatsChart from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { useWorkspaceStore } from '../../stores/workspace';
import { beanLabel, COFFEE_SPECIES, formatPrice } from '../../lib/beans';
import { ORIGIN_AREAS } from '../../lib/origins';
import { ROAST_LEVELS } from '../../lib/scale';
import { useChartKind } from '../../lib/chartKind';
import { boughtOn, brewRoastAge, bucketOf, countBy, formatWeight, meanBy, splitCountries, spendByCurrency } from '../../lib/stats';
import { barOf, barsHeight, meansOf, pieOf } from './charts';

const stats = useStats();
const workspaces = useWorkspaceStore();
const brews = computed(() => stats.brews.value);
const filtered = computed(() => {
  const f = stats.filters.value;
  return f.range !== 'all' || !!f.bean || !!f.recipe || !!f.brewer || f.mine;
});
const beans = computed<StatsBean[]>(() => {
  if (!filtered.value) return stats.beans.value;
  const brewed = new Set(brews.value.map((b) => b.beanId));
  return stats.beans.value.filter((b) => brewed.has(b.id));
});
const scope = computed(() => (filtered.value ? 'Beans brewed with these filters' : 'Every bean'));

const same = (k: string) => k;
const country = computed(() => pieOf(countBy(beans.value, (b) => splitCountries(b.country)), same, 'Beans'));
const process = computed(() => pieOf(countBy(beans.value, (b) => b.processId), (id) => stats.name(id) ?? 'Removed process', 'Beans'));
const roaster = computed(() => pieOf(countBy(beans.value, (b) => b.roasterName.trim()), same, 'Beans'));
const area = computed(() => pieOf(countBy(beans.value, (b) => b.originArea), (k) => ORIGIN_AREAS[k as OriginArea]?.label ?? k, 'Beans'));

// Roast levels in their own order, light to dark, not by count.
const roast = computed(() => {
  const counts = countBy(beans.value, (b) => b.roastLevel);
  const levels = (Object.keys(ROAST_LEVELS) as RoastLevel[]).filter((l) => counts.some((c) => c.key === l));
  const n = (l: RoastLevel) => counts.find((c) => c.key === l)?.n ?? 0;
  return {
    labels: levels.map((l) => ROAST_LEVELS[l].label),
    series: [{ label: 'Beans', data: levels.map(n) }],
    table: { head: ['Roast', 'Beans'], rows: levels.map((l) => [ROAST_LEVELS[l].label, n(l)]) },
  };
});
const species = computed(() => barOf(countBy(beans.value, (b) => b.species ?? []), (k) => COFFEE_SPECIES[k as CoffeeSpecies]?.label ?? k, 'Beans'));
const varieties = computed(() => barOf(countBy(beans.value, (b) => (b.varieties ?? []).map((v) => v.trim())), same, 'Beans', 10));

// The brews' rating under each country of their bean (a blend counts under each).
const beanOf = (b: StatsBrew) => stats.bean(b.beanId);
const ratingByCountry = computed(() => meansOf(meanBy(brews.value, (b) => splitCountries(beanOf(b)?.country ?? null), (b) => b.rating), same));

// Spend over time, in the currency most bags were bought in (amounts are never converted).
const spendView = stats.chart('spend');
const spendKind = useChartKind('spend');
const spendAll = computed(() => spendByCurrency(beans.value, spendView.range.value.from ?? undefined, spendView.range.value.to ?? undefined));
const spendCurrency = computed(() => spendAll.value[0]?.currency ?? null);
const spend = computed(() => {
  const { buckets, granularity, from, to } = spendView.axis.value;
  const index = new Map(buckets.map((k, i) => [k, i]));
  const data = buckets.map(() => 0);
  for (const b of beans.value) {
    const day = boughtOn(b);
    if (b.priceCurrency !== spendCurrency.value || b.priceAmount === null || day < from || day > to) continue;
    const i = index.get(bucketOf(day, granularity));
    if (i !== undefined) data[i] = Math.round((data[i]! + b.priceAmount) * 100) / 100;
  }
  return data;
});
const spendLabels = computed(() => spendView.labels.value);
const otherCurrencies = computed(() => spendAll.value.slice(1).map((s) => formatPrice(s.amount, s.currency)).join(', '));

const roastAge = computed(() =>
  brews.value.flatMap((b) => {
    const age = brewRoastAge(b, beanOf(b));
    return age !== null && b.rating !== null ? [{ x: age, y: b.rating }] : [];
  }),
);

// Coffee used in these brews against what's left on the shelf now.
const usage = computed(() => {
  const used = new Map<string, number>();
  for (const b of brews.value) used.set(b.beanId, (used.get(b.beanId) ?? 0) + b.doseGrams);
  return beans.value
    .filter((b) => used.has(b.id) || (b.archivedAt === null && b.inventoryWeightGrams > 0))
    .map((b) => ({ id: b.id, label: beanLabel(b), used: used.get(b.id) ?? 0, left: b.inventoryWeightGrams, archived: b.archivedAt !== null }))
    .sort((a, b) => b.used - a.used || b.left - a.left);
});
</script>

<template>
  <div class="charts">
    <ChartCard title="Beans by country" :note="`${scope}; a blend counts under each country`" :empty="country.labels.length === 0" empty-text="No countries recorded yet." :table="country.table">
      <StatsChart kind="doughnut" label="Beans by country" :labels="country.labels" :series="country.series" />
    </ChartCard>

    <ChartCard title="Beans by process" :note="scope" :empty="process.labels.length === 0" empty-text="No processes recorded yet." :table="process.table">
      <StatsChart kind="doughnut" label="Beans by process" :labels="process.labels" :series="process.series" />
    </ChartCard>

    <ChartCard title="Beans by roaster" :note="scope" :empty="roaster.labels.length === 0" empty-text="No beans yet." :table="roaster.table">
      <StatsChart kind="doughnut" label="Beans by roaster" :labels="roaster.labels" :series="roaster.series" />
    </ChartCard>

    <ChartCard title="Rating by country" note="Average brew rating; the number of rated brews in brackets" :empty="ratingByCountry.labels.length === 0" empty-text="No rated brews of beans with a country yet." :table="ratingByCountry.table">
      <StatsChart
        kind="bar"
        horizontal
        label="Average rating by country"
        :labels="ratingByCountry.labels"
        :series="ratingByCountry.series"
        :y-min="0"
        :y-max="5"
        :format="(n) => n.toFixed(1)"
        :height="barsHeight(ratingByCountry.labels.length)"
      />
    </ChartCard>

    <ChartCard title="Origin" :note="scope" :empty="area.labels.length === 0" empty-text="No origins recorded yet." :table="area.table">
      <StatsChart kind="doughnut" label="Beans by origin area" :labels="area.labels" :series="area.series" />
    </ChartCard>

    <ChartCard title="Roast level" :note="scope" :empty="roast.labels.length === 0" empty-text="No roast levels recorded yet." :table="roast.table">
      <StatsChart kind="bar" label="Beans by roast level" :labels="roast.labels" :series="roast.series" :height="200" />
    </ChartCard>

    <ChartCard title="Species" :note="scope" :empty="species.labels.length === 0" empty-text="No species recorded yet." :table="species.table">
      <StatsChart kind="bar" horizontal label="Beans by species" :labels="species.labels" :series="species.series" :height="barsHeight(species.labels.length)" />
    </ChartCard>

    <ChartCard title="Varieties" :note="`${scope}; the 10 most common`" :empty="varieties.labels.length === 0" empty-text="No varieties recorded yet." :table="varieties.table">
      <StatsChart kind="bar" horizontal label="Beans by variety" :labels="varieties.labels" :series="varieties.series" :height="barsHeight(varieties.labels.length)" />
    </ChartCard>

    <ChartCard
      title="Spent on beans"
      :note="spendCurrency ? `${spendCurrency} by the day bought${otherCurrencies ? `; also ${otherCurrencies}` : ''}` : undefined"
      :empty="!spendCurrency"
      empty-text="No bean prices in this period."
      :table="{ head: ['', spendCurrency ?? ''], rows: spendLabels.map((l, i) => [l, spend[i]!.toFixed(2)]) }"
      v-model:kind="spendKind"
    >
      <template #period><ChartPeriod :view="spendView" label="Spent on beans" /></template>
      <StatsChart :kind="spendKind" label="Spent on beans over time" :labels="spendLabels" :series="[{ label: spendCurrency ?? '', data: spend }]" :format="(n) => n.toFixed(2)" />
    </ChartCard>

    <ChartCard
      title="Rating against roast age"
      note="Days since roasting on the brew day, frozen days left out"
      :empty="roastAge.length === 0"
      empty-text="No rated brews of beans with a roast date yet."
      :table="{ head: ['Roast age (days)', 'Rating'], rows: roastAge.map((p) => [p.x, p.y]) }"
    >
      <StatsChart kind="scatter" label="Rating against roast age" :points="[{ label: 'Brews', data: roastAge }]" x-title="Days since roasting" y-title="Rating" :y-min="0.5" :y-max="5.5" />
    </ChartCard>

    <section class="card usage">
      <h2>Coffee used and stock left</h2>
      <p class="muted note">Used in these brews; left on the shelf now</p>
      <p v-if="usage.length === 0" class="muted">No beans brewed or in stock.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">Bean</th><th scope="col">Used</th><th scope="col">Left</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in usage" :key="u.id">
              <td>
                <RouterLink v-if="workspaces.canEdit" :to="{ name: 'bean-edit', params: { id: u.id } }">{{ u.label }}</RouterLink>
                <template v-else>{{ u.label }}</template>
                <span v-if="u.archived" class="badge">Archived</span>
              </td>
              <td class="num">{{ formatWeight(u.used) }}</td>
              <td class="num">{{ u.archived ? '–' : formatWeight(u.left) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: var(--space-3);
}
.usage {
  grid-column: 1 / -1;
  padding: var(--space-3);
}
.usage h2 {
  font-size: 1rem;
  margin: 0;
}
.note {
  margin: 0 0 var(--space-2);
  font-size: 0.85rem;
}
.table-wrap {
  max-height: 360px;
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
  position: sticky;
  top: 0;
  background: var(--surface);
}
th,
td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
}
th:not(:first-child),
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.badge {
  margin-left: var(--space-2);
}
</style>

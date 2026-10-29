<script setup lang="ts">
// Insights → Recipes: which recipes and styles get brewed, how they rate,
// and how often a brew finished inside its window.
import { computed } from 'vue';
import ChartCard from '../../components/charts/ChartCard.vue';
import StatsChart from '../../components/charts/StatsChart.vue';
import { useStats } from '../../composables/useStats';
import { countBy, finishFit, meanBy, type FinishFit } from '../../lib/stats';
import { barOf, barsHeight, meansOf, pieOf } from './charts';

const stats = useStats();
const brews = computed(() => stats.brews.value);
const recipeName = (id: string) => stats.name(id) ?? 'Removed recipe';
const recipes = computed(() => new Map((stats.data.value?.lookups.recipes ?? []).map((r) => [r.id, r])));

const use = computed(() => barOf(countBy(brews.value, (b) => b.recipeId), recipeName, 'Brews'));
const style = computed(() => pieOf(countBy(brews.value, (b) => b.styleId), (id) => stats.name(id) ?? 'Removed style', 'Brews'));
const rating = computed(() => meansOf(meanBy(brews.value, (b) => b.recipeId, (b) => b.rating), recipeName));

// Per recipe: brews that finished early, inside, or late against the window.
const FITS: Array<{ key: FinishFit; label: string }> = [
  { key: 'early', label: 'Early' },
  { key: 'inside', label: 'In the window' },
  { key: 'late', label: 'Late' },
];
const finish = computed(() => {
  const byRecipe = new Map<string, Record<FinishFit, number>>();
  for (const b of brews.value) {
    const fit = finishFit(b, b.recipeId ? recipes.value.get(b.recipeId) : undefined);
    if (!fit || !b.recipeId) continue;
    const row = byRecipe.get(b.recipeId) ?? { early: 0, inside: 0, late: 0 };
    row[fit] += 1;
    byRecipe.set(b.recipeId, row);
  }
  const rows = [...byRecipe].sort((a, b) => total(b[1]) - total(a[1])).slice(0, 10);
  return {
    labels: rows.map(([id]) => recipeName(id)),
    series: FITS.map((f) => ({ label: f.label, data: rows.map(([, r]) => r[f.key]) })),
    table: {
      head: ['Recipe', ...FITS.map((f) => f.label), 'In the window'],
      rows: rows.map(([id, r]) => [recipeName(id), r.early, r.inside, r.late, `${Math.round((r.inside / total(r)) * 100)}%`]),
    },
  };
});
function total(r: Record<FinishFit, number>): number {
  return r.early + r.inside + r.late;
}
</script>

<template>
  <div class="charts">
    <ChartCard title="Brews by recipe" note="The 10 most brewed" :empty="use.labels.length === 0" empty-text="No brews with a recipe yet." :table="use.table">
      <StatsChart kind="bar" horizontal label="Brews by recipe" :labels="use.labels" :series="use.series" :height="barsHeight(use.labels.length)" />
    </ChartCard>

    <ChartCard title="Brews by style" :empty="style.labels.length === 0" empty-text="No brews with a styled recipe yet." :table="style.table">
      <StatsChart kind="doughnut" label="Brews by recipe style" :labels="style.labels" :series="style.series" />
    </ChartCard>

    <ChartCard title="Rating by recipe" note="Average rating; rated brews in brackets" :empty="rating.labels.length === 0" empty-text="No rated brews with a recipe yet." :table="rating.table">
      <StatsChart kind="bar" horizontal label="Average rating by recipe" :labels="rating.labels" :series="rating.series" :y-min="0" :y-max="5" :format="(n) => n.toFixed(1)" :height="barsHeight(rating.labels.length)" />
    </ChartCard>

    <ChartCard title="Finish time against the window" note="Brews of recipes with a target finish" :empty="finish.labels.length === 0" empty-text="No brews of recipes with a finish window yet." :table="finish.table">
      <StatsChart kind="bar" horizontal stacked label="Finish time against the window, by recipe" :labels="finish.labels" :series="finish.series" :height="barsHeight(finish.labels.length) + 30" />
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

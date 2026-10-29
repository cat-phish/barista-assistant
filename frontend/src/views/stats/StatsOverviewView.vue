<script setup lang="ts">
// Stats → Overview: the headline totals for the filtered brews, plus the
// bean shelf as it is now (docs/api/stats.md §11, "How the client counts").
import { computed } from 'vue';
import { useStats } from '../../composables/useStats';
import { beanLabel, formatPrice } from '../../lib/beans';
import { countBy, formatDuration, formatWeight, freezeState, isAvailable, localDay, longestStreak, spendByCurrency } from '../../lib/stats';

const stats = useStats();

interface Tile {
  label: string;
  value: string;
  sub?: string;
}

const tiles = computed<Tile[]>(() => {
  const brews = stats.brews.value;
  const beans = stats.beans.value;
  const lookups = stats.data.value!.lookups;
  const distinct = (ids: Array<string | null>) => new Set(ids.filter((id): id is string => id !== null)).size;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const dose = brews.reduce((sum, b) => sum + b.doseGrams, 0);
  const volumes = brews.map((b) => stats.volume(b)).filter((v) => v !== null);
  const ml = volumes.reduce((sum, v) => sum + v.ml, 0);
  const estimated = volumes.filter((v) => v.source === 'estimate').length;
  const rated = brews.filter((b) => b.rating !== null);
  const meanRating = rated.length ? rated.reduce((sum, b) => sum + b.rating!, 0) / rated.length : null;

  const available = beans.filter(isAvailable);
  const states = countBy(available, freezeState);
  const stateCount = (s: string) => states.find((c) => c.key === s)?.n ?? 0;

  const { from, to } = stats.range.value;
  const spentOn = stats.filters.value.bean ? beans.filter((b) => b.id === stats.filters.value.bean) : beans;
  const spend = spendByCurrency(spentOn, from ?? undefined, to ?? undefined);

  const top = countBy(brews, (b) => b.beanId)[0];
  const topBean = top ? stats.bean(top.key) : undefined;

  return [
    { label: 'Brews', value: String(brews.length), sub: rated.length ? `${rated.length} rated` : undefined },
    { label: 'Coffee used', value: formatWeight(dose), sub: brews.length ? `${formatWeight(dose / brews.length)} a brew` : undefined },
    { label: 'Volume drunk', value: `${estimated ? '≈ ' : ''}${stats.formatVolume(ml)}`, sub: estimated ? `${Math.round((estimated / volumes.length) * 100)}% estimated` : undefined },
    { label: 'Total brew time', value: formatDuration(brews.reduce((sum, b) => sum + b.timeSec, 0)) },
    { label: 'Average rating', value: meanRating === null ? '–' : `${meanRating.toFixed(1)} / 5`, sub: rated.length ? `from ${plural(rated.length, 'brew')}` : undefined },
    { label: 'Beans explored', value: String(distinct(brews.map((b) => b.beanId))), sub: `of ${plural(beans.length, 'bean')}` },
    {
      label: 'Beans available',
      value: String(available.length),
      sub: available.length ? `${stateCount('frozen')} frozen · ${stateCount('thawed')} thawed · ${stateCount('fresh')} fresh` : 'none in stock',
    },
    {
      label: 'Money spent on beans',
      value: spend[0] ? formatPrice(spend[0].amount, spend[0].currency) : '–',
      sub: spend.length > 1 ? spend.slice(1).map((s) => `+ ${formatPrice(s.amount, s.currency)}`).join(' ') : spend[0] ? plural(spend[0].bags, 'bag') : 'no prices recorded',
    },
    { label: 'Grinders used', value: String(distinct(brews.map((b) => b.grinderId))), sub: `${lookups.grinders.length} in Bar setup` },
    { label: 'Brew methods used', value: String(distinct(brews.map((b) => b.methodId))), sub: plural(distinct(brews.map((b) => b.recipeId)), 'recipe') },
    { label: 'Prep tools used', value: String(new Set(brews.flatMap((b) => b.toolIds)).size) },
    { label: 'Bean photos', value: String(beans.reduce((sum, b) => sum + b.photoCount, 0)) },
    { label: 'Longest streak', value: plural(longestStreak(brews.map(localDay)), 'day'), sub: 'brewing every day' },
    { label: 'Most brewed bean', value: topBean ? beanLabel(topBean) : '–', sub: top ? plural(top.n, 'brew') : undefined },
  ];
});
</script>

<template>
  <div class="tiles">
    <section v-for="t in tiles" :key="t.label" class="card tile" :class="{ wide: t.value.length > 14 }">
      <h2>{{ t.label }}</h2>
      <p class="value">{{ t.value }}</p>
      <p v-if="t.sub" class="muted sub">{{ t.sub }}</p>
    </section>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-3);
}
.tile {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tile.wide {
  grid-column: span 2;
}
h2 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.sub {
  margin: 0;
  font-size: 0.85rem;
}
@media (max-width: 360px) {
  .tile.wide {
    grid-column: auto;
  }
}
</style>

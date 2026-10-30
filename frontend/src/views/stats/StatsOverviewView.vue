<script setup lang="ts">
// Stats → Overview: the headline totals for the filtered brews, plus the
// bean shelf as it is now (docs/api/stats.md §11, "How the client counts").
// Below them, the charts the person added (§11b): built-in ones drawn by
// their own tab, then Explore charts, in the order added. Edit layout orders
// and hides the tiles (as their own group) and the charts, and can put the
// tiles below the charts.
import { computed, defineAsyncComponent, onBeforeUnmount, type Component } from 'vue';
import type { InsightTab } from '../../api/types';
import OnlyCharts from '../../components/charts/OnlyCharts.vue';
import PinnedCharts from '../../components/charts/PinnedCharts.vue';
import { explorePins, overviewCharts, tileLayoutId, visibleTabs } from '../../lib/insightCharts';
import { useStats } from '../../composables/useStats';
import { beanLabel, formatPrice } from '../../lib/beans';
import { caffeineSummary, formatCaffeine } from '../../lib/caffeine';
import { localDateInput } from '../../lib/format';
import { countBy, formatDuration, formatWeight, freezeState, isAvailable, localDay, longestStreak, spendByCurrency } from '../../lib/stats';

const stats = useStats();

const TAB_VIEWS: Partial<Record<InsightTab, Component>> = {
  brews: defineAsyncComponent(() => import('./StatsBrewsView.vue')),
  beans: defineAsyncComponent(() => import('./StatsBeansView.vue')),
  methods: defineAsyncComponent(() => import('./StatsMethodsView.vue')),
  recipes: defineAsyncComponent(() => import('./StatsRecipesView.vue')),
  tools: defineAsyncComponent(() => import('./StatsToolsView.vue')),
  grinders: defineAsyncComponent(() => import('./StatsGrindersView.vue')),
};
const pinnedTabs = computed(() => {
  const byTab = overviewCharts(stats.pinned.value);
  return visibleTabs(stats.hidden.value).flatMap((t) => {
    const ids = byTab.get(t.tab);
    const view = TAB_VIEWS[t.tab];
    return ids && view ? [{ tab: t.tab, ids, view }] : [];
  });
});
const anyPinned = computed(() => pinnedTabs.value.length > 0 || explorePins(stats.pinned.value, 'overview').length > 0);

interface Tile {
  key: string; // its layout id is tile.<key>
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

  const caffeine = caffeineSummary(brews, stats.bean, stats.range.value, localDateInput());

  const available = beans.filter(isAvailable);
  const states = countBy(available, freezeState);
  const stateCount = (s: string) => states.find((c) => c.key === s)?.n ?? 0;

  const { from, to } = stats.range.value;
  const spentOn = stats.filters.value.bean ? beans.filter((b) => b.id === stats.filters.value.bean) : beans;
  const spend = spendByCurrency(spentOn, from ?? undefined, to ?? undefined);

  const top = countBy(brews, (b) => b.beanId)[0];
  const topBean = top ? stats.bean(top.key) : undefined;

  return [
    { key: 'brews', label: 'Brews', value: String(brews.length), sub: rated.length ? `${rated.length} rated` : undefined },
    { key: 'coffee', label: 'Coffee used', value: formatWeight(dose), sub: brews.length ? `${formatWeight(dose / brews.length)} a brew` : undefined },
    { key: 'volume', label: 'Volume drunk', value: `${estimated ? '≈ ' : ''}${stats.formatVolume(ml)}`, sub: estimated ? `${Math.round((estimated / volumes.length) * 100)}% estimated` : undefined },
    { key: 'caffeineTotal', label: 'Caffeine Total', value: caffeine ? formatCaffeine(caffeine.totalMg) : '–' },
    { key: 'caffeinePerBrew', label: 'Caffeine/Brew', value: caffeine ? formatCaffeine(caffeine.perBrewMg) : '–', sub: caffeine ? `from ${plural(brews.length, 'brew')}` : undefined },
    { key: 'caffeinePerDay', label: 'Caffeine/Day', value: caffeine ? formatCaffeine(caffeine.perDayMg) : '–', sub: caffeine ? `over ${plural(caffeine.days, 'day')}` : undefined },
    { key: 'time', label: 'Total brew time', value: formatDuration(brews.reduce((sum, b) => sum + b.timeSec, 0)) },
    { key: 'rating', label: 'Average rating', value: meanRating === null ? '–' : `${meanRating.toFixed(1)} / 5`, sub: rated.length ? `from ${plural(rated.length, 'brew')}` : undefined },
    { key: 'beans', label: 'Beans explored', value: String(distinct(brews.map((b) => b.beanId))), sub: `of ${plural(beans.length, 'bean')}` },
    {
      key: 'available', label: 'Beans available',
      value: String(available.length),
      sub: available.length ? `${stateCount('frozen')} frozen · ${stateCount('thawed')} thawed · ${stateCount('fresh')} fresh` : 'none in stock',
    },
    {
      key: 'spend', label: 'Money spent on beans',
      value: spend[0] ? formatPrice(spend[0].amount, spend[0].currency) : '–',
      sub: spend.length > 1 ? spend.slice(1).map((s) => `+ ${formatPrice(s.amount, s.currency)}`).join(' ') : spend[0] ? plural(spend[0].bags, 'bag') : 'no prices recorded',
    },
    { key: 'grinders', label: 'Grinders used', value: String(distinct(brews.map((b) => b.grinderId))), sub: `${lookups.grinders.length} in Bar setup` },
    { key: 'methods', label: 'Brew methods used', value: String(distinct(brews.map((b) => b.methodId))), sub: plural(distinct(brews.map((b) => b.recipeId)), 'recipe') },
    { key: 'tools', label: 'Prep tools used', value: String(new Set(brews.flatMap((b) => b.toolIds)).size) },
    { key: 'photos', label: 'Bean photos', value: String(beans.reduce((sum, b) => sum + b.photoCount, 0)) },
    { key: 'streak', label: 'Longest streak', value: plural(longestStreak(brews.map(localDay)), 'day'), sub: 'brewing every day' },
    { key: 'topBean', label: 'Most brewed bean', value: topBean ? beanLabel(topBean) : '–', sub: top ? plural(top.n, 'brew') : undefined },
  ];
});

// The tiles are on the Overview's layout (their labels never change).
const TILE_LABELS = computed(() => new Map(tiles.value.map((t) => [t.key, t.label])));
const unregister = [...TILE_LABELS.value.keys()].map((key) => stats.register('overview', tileLayoutId(key), () => TILE_LABELS.value.get(key) ?? key));
onBeforeUnmount(() => unregister.forEach((off) => off()));
const shownTiles = computed(() =>
  tiles.value.flatMap((t) => {
    const place = stats.placeOf('overview', tileLayoutId(t.key));
    return place.hidden ? [] : [{ ...t, order: place.order }];
  }),
);
const tilesBelow = computed(() => !!stats.layout.value.overview?.tilesBelow);
</script>

<template>
  <div class="overview">
    <div class="tiles" :style="{ order: tilesBelow ? 1 : 0 }">
      <section v-for="t in shownTiles" :key="t.key" class="card tile" :class="{ wide: t.value.length > 14 }" :style="{ order: t.order }">
        <h2>{{ t.label }}</h2>
        <p class="value">{{ t.value }}</p>
        <p v-if="t.sub" class="muted sub">{{ t.sub }}</p>
      </section>
    </div>

    <section class="pinned" aria-label="Your charts">
      <OnlyCharts v-for="p in pinnedTabs" :key="p.tab" :ids="p.ids">
        <component :is="p.view" />
      </OnlyCharts>
      <div class="charts">
        <PinnedCharts tab="overview" />
      </div>
      <p v-if="!anyPinned" class="muted hint">Add charts here with the pin on any chart, or “Add to a tab…” on Explore.</p>
    </section>
  </div>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pinned {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: var(--space-3);
}
/* One grid for every added chart: each tab view's own chart grid (and the
   Explore charts' wrapper) steps aside, so cards from different tabs share
   rows instead of each sitting alone in its tab's left column. */
.pinned :deep(.charts) {
  display: contents;
}
.hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.9rem;
}
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

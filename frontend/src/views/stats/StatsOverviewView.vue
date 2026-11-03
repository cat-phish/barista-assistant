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
import { useOverviewTiles } from '../../composables/useOverviewTiles';
import { useStats } from '../../composables/useStats';

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

const tiles = useOverviewTiles();

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

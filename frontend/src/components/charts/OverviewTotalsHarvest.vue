<script setup lang="ts">
// The Overview's tiles as one chart for the chat's chart picker: "Overview
// totals", a row per tile.
import { inject, onBeforeUnmount } from 'vue';
import { useOverviewTiles } from '../../composables/useOverviewTiles';
import { CHART_HARVEST } from '../../lib/chartHarvest';

const tiles = useOverviewTiles();
const harvest = inject(CHART_HARVEST, null);
const off = harvest?.add({
  id: 'overview.totals',
  title: () => 'Overview totals',
  note: () => 'The headline totals for these brews, and the bean shelf as it is now',
  table: () => ({ head: ['Total', 'Value', 'Detail'], rows: tiles.value.map((t) => [t.label, t.value, t.sub ?? '']) }),
  empty: () => tiles.value.length === 0,
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <span hidden></span>
</template>

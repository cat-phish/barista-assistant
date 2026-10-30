<script setup lang="ts">
// The Explore charts a person added to this tab (docs/api/stats.md §11b), at
// the end of its chart grid, each with Remove. Not drawn when this tab is
// itself drawn on the Overview (ONLY_CHARTS): they belong to the tab.
import { computed, inject } from 'vue';
import type { InsightTab } from '../../api/types';
import { useStats } from '../../composables/useStats';
import { explorePins, ONLY_CHARTS, pinLayoutId } from '../../lib/insightCharts';
import ExploreChart from './ExploreChart.vue';

const props = defineProps<{ tab: InsightTab }>();
const stats = useStats();
const only = inject(ONLY_CHARTS, null);
const pins = computed(() => (only ? [] : explorePins(stats.pinned.value, props.tab)));
</script>

<template>
  <ExploreChart v-for="p in pins" :key="p.id" :picks="p" :layout-id="pinLayoutId(p.id)" strict>
    <template #actions>
      <button type="button" class="btn-link" aria-label="Remove this chart from the tab" @click="stats.removeChart(p.id)">Remove</button>
    </template>
  </ExploreChart>
</template>

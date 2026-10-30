<script setup lang="ts">
// Draws its tab view with only these built-in charts showing (ChartCard reads
// ONLY_CHARTS): how the Overview shows the charts pinned to it.
import { computed, provide } from 'vue';
import { ONLY_CHARTS } from '../../lib/insightCharts';

const props = defineProps<{ ids: ReadonlySet<string> }>();
provide(ONLY_CHARTS, computed(() => props.ids));
</script>

<template>
  <slot />
</template>

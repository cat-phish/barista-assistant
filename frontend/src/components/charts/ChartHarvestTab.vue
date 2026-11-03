<script setup lang="ts">
// One Insights tab drawn for the chat's chart picker (ChartPicker): its
// ChartCards hand their numbers to `collect` instead of drawing.
import { provide } from 'vue';
import { CHART_HARVEST, type HarvestedChart } from '../../lib/chartHarvest';

const props = defineProps<{ tab: string; collect: (tab: string, chart: HarvestedChart) => () => void }>();
provide(CHART_HARVEST, { add: (chart) => props.collect(props.tab, chart) });
</script>

<template>
  <slot />
</template>

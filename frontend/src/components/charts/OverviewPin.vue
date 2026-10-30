<script setup lang="ts">
// A built-in chart's pin (docs/api/stats.md §11b): adds it to the person's
// Overview, or takes it off (from the tab or from the Overview itself).
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useStats } from '../../composables/useStats';
import { onOverview } from '../../lib/insightCharts';

const props = defineProps<{ chartId: string; title: string }>();
const stats = useStats();
const route = useRoute();
const on = computed(() => !!onOverview(stats.pinned.value, props.chartId));
const label = computed(() => (on.value ? `Remove ${props.title} from the Overview` : `Add ${props.title} to the Overview`));
</script>

<template>
  <button type="button" class="btn-link pin" :class="{ on }" :aria-pressed="on" :aria-label="label" :title="label" @click="stats.toggleOverview(chartId)">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" :fill="on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
    <span v-if="route.name === 'stats-overview'" class="pin-text">Remove</span>
  </button>
</template>

<style scoped>
.pin {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pin:not(.on) {
  color: var(--text-muted);
}
</style>

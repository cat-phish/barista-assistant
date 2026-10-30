<script setup lang="ts">
// Statistics (docs/roadmap.md, "Insights"): the filters and the data, shared by
// every tab (child routes; composables/useStats.ts).
import AppHeader from '../components/AppHeader.vue';
import StatsFilters from '../components/StatsFilters.vue';
import StatsTabs from '../components/StatsTabs.vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import LayoutEditor from '../components/charts/LayoutEditor.vue';
import { provideStats } from '../composables/useStats';
import { tabOfRoute } from '../lib/insightCharts';

const stats = provideStats();
const route = useRoute();

// Edit layout, on every tab but Explore; closes on leaving the tab.
const tab = computed(() => tabOfRoute(route.name));
const editing = ref(false);
watch(tab, () => (editing.value = false));
const hiddenCount = computed(() => {
  const t = tab.value;
  if (!t) return 0;
  const hidden = new Set(stats.layout.value[t]?.hidden ?? []);
  return stats.charts(t).filter((c) => hidden.has(c.id)).length;
});
</script>

<template>
  <AppHeader />
  <main class="page stats-page">
    <div class="page-header">
      <h1>Insights</h1>
    </div>
    <StatsFilters />
    <StatsTabs />
    <p v-if="stats.pinError.value" class="form-error" role="alert">Your added charts: {{ stats.pinError.value }}</p>
    <p v-if="stats.error.value" class="form-error" role="alert">{{ stats.error.value }}</p>
    <p v-else-if="stats.loading.value && !stats.data.value" class="muted" aria-live="polite">Loading insights…</p>
    <div v-else-if="stats.data.value && stats.brews.value.length === 0 && stats.beans.value.length === 0" class="card empty">
      <p>No brews or beans yet. Log a brew and the insights fill in here.</p>
    </div>
    <template v-else-if="stats.data.value">
      <div v-if="tab && !editing" class="layout-bar">
        <button type="button" class="btn-link" @click="editing = true">Edit layout</button>
      </div>
      <LayoutEditor v-if="tab && editing" :tab="tab" @done="editing = false" />
      <RouterView :class="{ stale: stats.loading.value }" />
      <p v-if="tab && hiddenCount && !editing" class="muted hidden-note">
        {{ hiddenCount }}{{ tab === 'overview' ? '' : hiddenCount === 1 ? ' chart' : ' charts' }} hidden ·
        <button type="button" class="btn-link" @click="editing = true">Edit layout</button>
      </p>
    </template>
  </main>
</template>

<style scoped>
.stats-page {
  max-width: 1080px;
}
.layout-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: calc(-1 * var(--space-2));
}
.hidden-note {
  margin: 0;
  font-size: 0.9rem;
}
.stale {
  opacity: 0.6;
  transition: opacity 0.15s;
}
</style>

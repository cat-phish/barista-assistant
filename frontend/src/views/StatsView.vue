<script setup lang="ts">
// Statistics (docs/backlog.md item 12): the filters and the data, shared by
// every tab (child routes; composables/useStats.ts).
import AppHeader from '../components/AppHeader.vue';
import StatsFilters from '../components/StatsFilters.vue';
import StatsTabs from '../components/StatsTabs.vue';
import { provideStats } from '../composables/useStats';

const stats = provideStats();
</script>

<template>
  <AppHeader />
  <main class="page stats-page">
    <div class="page-header">
      <h1>Insights</h1>
    </div>
    <StatsFilters />
    <StatsTabs />
    <p v-if="stats.error.value" class="form-error" role="alert">{{ stats.error.value }}</p>
    <p v-else-if="stats.loading.value && !stats.data.value" class="muted" aria-live="polite">Loading insights…</p>
    <div v-else-if="stats.data.value && stats.brews.value.length === 0 && stats.beans.value.length === 0" class="card empty">
      <p>No brews or beans yet. Log a brew and the insights fill in here.</p>
    </div>
    <RouterView v-else-if="stats.data.value" :class="{ stale: stats.loading.value }" />
  </main>
</template>

<style scoped>
.stats-page {
  max-width: 1080px;
}
.stale {
  opacity: 0.6;
  transition: opacity 0.15s;
}
</style>

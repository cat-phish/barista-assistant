<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { beansApi } from '../api/beans';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { Bean, BrewLog } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import RatingStars from '../components/RatingStars.vue';
import { formatDoseLine, formatGrams, formatTime, formatWhen } from '../lib/format';
import { formatSize } from '../lib/servings';
import { useWorkspaceStore } from '../stores/workspace';

const PAGE_SIZE = 20;

const workspaces = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const beans = ref<Bean[]>([]);
const logs = ref<BrewLog[]>([]);
const total = ref(0);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');

// The bean filter lives in the URL (?bean=), so Back and reloads keep it.
const beanFilter = computed({
  get: () => (typeof route.query.bean === 'string' ? route.query.bean : ''),
  set: (id: string) => void router.replace({ query: id ? { bean: id } : {} }),
});

async function load(reset: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  if (reset) loading.value = true;
  else loadingMore.value = true;
  error.value = '';
  try {
    const page = await brewLogsApi.list(ws, {
      beanId: beanFilter.value || undefined,
      limit: PAGE_SIZE,
      offset: reset ? 0 : logs.value.length,
    });
    logs.value = reset ? page.brewLogs : [...logs.value, ...page.brewLogs];
    total.value = page.total;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (ws) beansApi.list(ws).then((r) => (beans.value = r.beans)).catch(() => undefined);
  await load(true);
});
watch(beanFilter, () => load(true));
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Journal</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'brew' }">New brew</RouterLink>
    </div>

    <div v-if="beans.length > 1" class="field">
      <label for="filter">Bean</label>
      <select id="filter" v-model="beanFilter">
        <option value="">All beans</option>
        <option v-for="b in beans" :key="b.id" :value="b.id">{{ b.roasterName }} – {{ b.beanName }}</option>
      </select>
    </div>

    <p v-if="loading" class="muted" aria-live="polite">Loading brews…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="logs.length === 0" class="card empty">
      <p>{{ beanFilter ? 'No brews with this bean yet.' : 'No brews logged yet.' }}</p>
    </div>

    <template v-else>
      <p class="muted count">{{ total }} brew{{ total === 1 ? '' : 's' }}</p>
      <ul class="list">
        <li v-for="log in logs" :key="log.id">
          <RouterLink class="card entry" :to="{ name: 'journal-entry', params: { id: log.id } }">
            <div class="head">
              <span class="when">{{ formatWhen(log.timestamp) }}</span>
              <RatingStars :rating="log.rating" />
            </div>
            <strong>{{ log.bean.roasterName }} {{ log.bean.beanName }}</strong>
            <span v-if="log.drink || log.recipe" class="muted">{{ [log.drink?.name, log.servingSize !== null && log.servingUnit ? formatSize({ size: log.servingSize, unit: log.servingUnit }) : null, log.recipe?.name].filter(Boolean).join(' · ') }}</span>
            <span class="facts">
              <span>{{ formatDoseLine(log.actualDoseGrams, log.actualWaterGrams, log.actualYieldGrams) }}</span>
              <span v-if="log.actualYieldGrams !== null && log.actualWaterGrams !== null">→ {{ formatGrams(log.actualYieldGrams) }} g yield</span>
              <span>{{ formatTime(log.actualTimeSec) }}</span>
              <span v-if="log.actualTempC !== null">{{ log.actualTempC }} °C</span>
              <span v-if="log.actualGrindSetting || log.grinder">{{ [log.actualGrindSetting, log.grinder?.name].filter(Boolean).join(' · ') }}</span>
            </span>
            <span v-if="log.tastingNotes" class="notes">{{ log.tastingNotes }}</span>
          </RouterLink>
        </li>
      </ul>
      <button v-if="logs.length < total" class="btn btn-secondary" type="button" :disabled="loadingMore" @click="load(false)">
        {{ loadingMore ? 'Loading…' : `Load more (${total - logs.length} left)` }}
      </button>
    </template>
  </main>
</template>

<style scoped>
.count {
  margin: 0;
  font-size: 0.9rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  color: var(--text);
  text-decoration: none;
}
.entry:hover {
  border-color: var(--brand);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.when {
  font-size: 0.85rem;
  color: var(--text-muted);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 0.95rem;
}
.notes {
  font-size: 0.9rem;
  color: var(--text-muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>

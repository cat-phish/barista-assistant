<script setup lang="ts">
// Roast mode → Resting (docs/roadmap.md, Home roasting): roasts still resting,
// soonest ready first, then ready ones whose bean is still in use. A roast
// opens its page. The rest-done reminder is in Settings → Notifications.
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { roastsApi } from '../api/roasts';
import type { Roast } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { daysBetween, ROAST_TYPES } from '../lib/beans';
import { formatListDay, localDateInput } from '../lib/format';
import { formatStock, readyOn, restingRoasts, roastDay } from '../lib/roasting';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const roasts = ref<Roast[]>([]);
const loading = ref(true);
const error = ref('');
const today = localDateInput();

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    roasts.value = (await roastsApi.list(ws)).roasts;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

const lists = computed(() => restingRoasts(roasts.value, today));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const toGo = (r: Roast) => {
  const days = daysBetween(today, readyOn(r));
  return days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`;
};
const title = (r: Roast) => `${r.greenCoffee?.name ?? 'Deleted green coffee'}${r.batchNumber ? ` · batch ${r.batchNumber}` : ''}`;
const roasted = (r: Roast) => `Roasted ${formatListDay(roastDay(r))}${r.roastType ? ` for ${ROAST_TYPES[r.roastType].label.toLowerCase()}` : ''} · ${plural(r.restDays, 'day')}' rest`;
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Resting</h1>
    </div>

    <p v-if="loading" class="muted" aria-live="polite">Loading roasts…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-else-if="!loading">
      <section class="stack" aria-labelledby="resting">
        <h2 id="resting">Resting</h2>
        <div v-if="lists.resting.length === 0" class="card empty"><p>Nothing resting. A roast rests here until it's ready to brew.</p></div>
        <ul v-else class="list">
          <li v-for="r in lists.resting" :key="r.id">
            <RouterLink class="card item" :to="{ name: 'roast', params: { id: r.id } }">
              <span class="head">
                <strong>{{ title(r) }}</strong>
                <span class="badge resting">Ready {{ formatListDay(readyOn(r)) }}</span>
              </span>
              <span class="muted small">{{ roasted(r) }} · ready {{ toGo(r) }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="stack" aria-labelledby="ready">
        <h2 id="ready">Ready</h2>
        <div v-if="lists.ready.length === 0" class="card empty"><p>No rested roasts left to brew.</p></div>
        <ul v-else class="list">
          <li v-for="r in lists.ready" :key="r.id">
            <RouterLink class="card item" :to="{ name: 'roast', params: { id: r.id } }">
              <span class="head">
                <strong>{{ title(r) }}</strong>
                <span class="badge">{{ formatStock(r.bean?.inventoryWeightGrams ?? 0) }} left</span>
              </span>
              <span class="muted small">{{ roasted(r) }} · ready {{ readyOn(r) === today ? 'today' : `since ${formatListDay(readyOn(r))}` }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
h2 {
  font-size: 1.05rem;
  margin: 0;
}
section + section {
  margin-top: var(--space-4);
}
.small {
  font-size: 0.85rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text);
  text-decoration: none;
}
.item:hover {
  border-color: var(--brand-edge);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
.badge {
  flex-shrink: 0;
}
</style>

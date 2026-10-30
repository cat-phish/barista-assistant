<script setup lang="ts">
// Roast mode → Green (docs/api/green-coffees.md §4e): the green coffee the
// workspace has to roast, with what's left of each. Archive the used-up ones;
// deleting is on the edit page.
import { computed, onMounted, ref } from 'vue';
import { beanProcessesApi } from '../api/beanProcesses';
import { errorMessage } from '../api/client';
import { greenCoffeesApi } from '../api/greenCoffees';
import type { BeanProcess, GreenCoffee } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { ORIGIN_AREAS } from '../lib/origins';
import { formatStock, greenPrice, greenStock } from '../lib/roasting';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const greens = ref<GreenCoffee[]>([]);
const processes = ref<BeanProcess[]>([]);
const loading = ref(true);
const error = ref('');
const showArchived = ref(false);
const archivedCount = computed(() => greens.value.filter((g) => g.archivedAt).length);
const shown = computed(() => greens.value.filter((g) => !g.archivedAt || showArchived.value));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [list, procs] = await Promise.all([greenCoffeesApi.list(ws), beanProcessesApi.list(ws)]);
    greens.value = list.greenCoffees;
    processes.value = procs.processes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

// "Ethiopia · Guji · Washed": where it's from and how it was processed.
function origin(g: GreenCoffee): string {
  const process = processes.value.find((p) => p.id === g.processId)?.name;
  const area = !g.country && g.originArea ? ORIGIN_AREAS[g.originArea].label : null;
  return [g.country ?? area, g.region, process].filter(Boolean).join(' · ');
}
const STOCK_LABELS = { out: 'None left', low: 'Low', ok: null } as const;

const busyId = ref<string | null>(null);
async function setArchived(g: GreenCoffee, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = g.id;
  error.value = '';
  try {
    const { greenCoffee } = await greenCoffeesApi.update(ws, g.id, { archived });
    greens.value = greens.value.map((x) => (x.id === greenCoffee.id ? greenCoffee : x));
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Green coffee</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'green-coffee-new' }">Add green coffee</RouterLink>
    </div>
    <p class="muted intro">What you have to roast, and how much is left.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading green coffee…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="greens.length === 0" class="card empty"><p>No green coffee yet.</p></div>
      <template v-else>
        <label v-if="archivedCount" class="checkbox">
          <input v-model="showArchived" type="checkbox" />
          Show archived ({{ archivedCount }})
        </label>
        <ul class="list">
          <li v-for="g in shown" :key="g.id" class="card item">
            <div class="head">
              <div class="text">
                <strong>{{ g.name }}</strong><span v-if="g.archivedAt" class="muted"> (archived)</span>
                <span v-if="origin(g)" class="muted small">{{ origin(g) }}</span>
              </div>
              <span v-if="STOCK_LABELS[greenStock(g).state]" class="badge" :class="greenStock(g).state">{{ STOCK_LABELS[greenStock(g).state] }}</span>
            </div>
            <div class="stock">
              <span>
                <strong>{{ formatStock(g.weightLeftGrams) }}</strong> left<template v-if="g.weightBoughtGrams"> of {{ formatStock(g.weightBoughtGrams) }}</template>
              </span>
              <!-- Decorative: the numbers beside it say the same. -->
              <span v-if="greenStock(g).percent !== null" class="bar" aria-hidden="true"><span :style="{ width: `${greenStock(g).percent}%` }" /></span>
            </div>
            <span v-if="greenPrice(g) || g.supplier" class="muted small">{{ [g.supplier, greenPrice(g)].filter(Boolean).join(' · ') }}</span>
            <div v-if="workspaces.canEdit" class="actions">
              <RouterLink class="btn-link" :to="{ name: 'green-coffee-edit', params: { id: g.id } }">Edit</RouterLink>
              <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setArchived(g, !g.archivedAt)">{{ g.archivedAt ? 'Restore' : 'Archive' }}</button>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
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
  gap: var(--space-2);
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.badge.low {
  background: var(--warning-tint);
  color: var(--warning);
}
.badge.out {
  background: var(--danger-tint);
  color: var(--danger);
}
.stock {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.bar {
  flex: 1 1 8rem;
  max-width: 16rem;
  height: 6px;
  border-radius: 999px;
  background: var(--brand-line);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--brand);
}
.actions {
  display: flex;
  gap: var(--space-3);
}
</style>

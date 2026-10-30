<script setup lang="ts">
// Roast mode → Roasters (docs/api/roasting-machines.md §3f): the machines
// the workspace roasts on. Archive keeps history; deleting is on the edit page.
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { roastingMachinesApi } from '../api/roastingMachines';
import type { RoastingMachine } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { formatStock } from '../lib/roasting';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const machines = ref<RoastingMachine[]>([]);
const loading = ref(true);
const error = ref('');
const showArchived = ref(false);
const archivedCount = computed(() => machines.value.filter((m) => m.archivedAt).length);
const shown = computed(() => machines.value.filter((m) => !m.archivedAt || showArchived.value));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    machines.value = (await roastingMachinesApi.list(ws)).machines;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

const busyId = ref<string | null>(null);
async function setArchived(m: RoastingMachine, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = m.id;
  error.value = '';
  try {
    const { machine } = await roastingMachinesApi.update(ws, m.id, { archived });
    machines.value = machines.value.map((x) => (x.id === machine.id ? machine : x));
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
      <h1>Roasters</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'roasting-machine-new' }">Add roaster</RouterLink>
    </div>
    <p class="muted intro">The machines you roast on. Each roast will record which one it was.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading roasters…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="machines.length === 0" class="card empty"><p>No roasters yet.</p></div>
      <template v-else>
        <label v-if="archivedCount" class="checkbox">
          <input v-model="showArchived" type="checkbox" />
          Show archived ({{ archivedCount }})
        </label>
        <ul class="list">
          <li v-for="m in shown" :key="m.id" class="card item">
            <div class="text">
              <strong>{{ m.name }}</strong><span v-if="m.archivedAt" class="muted"> (archived)</span>
              <span v-if="m.capacityGrams" class="muted small">Up to {{ formatStock(m.capacityGrams) }} a batch</span>
              <span v-if="m.notes" class="muted small">{{ m.notes }}</span>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <RouterLink class="btn-link" :to="{ name: 'roasting-machine-edit', params: { id: m.id } }">Edit</RouterLink>
              <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setArchived(m, !m.archivedAt)">{{ m.archivedAt ? 'Restore' : 'Archive' }}</button>
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
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.actions {
  display: flex;
  gap: var(--space-3);
  flex-shrink: 0;
}
</style>

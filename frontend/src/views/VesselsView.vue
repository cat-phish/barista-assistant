<script setup lang="ts">
// Bar setup → Vessels (docs/api/vessels.md §3g): the carafes, mugs and cups a
// yield is weighed in. Archive keeps history; deleting is on the edit page.
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { Vessel } from '../api/types';
import { vesselsApi } from '../api/vessels';
import AppHeader from '../components/AppHeader.vue';
import ListDataBar from '../components/ListDataBar.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { useSelection } from '../composables/useSelection';
import { formatGrams } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const vessels = ref<Vessel[]>([]);
const loading = ref(true);
const error = ref('');
const showArchived = ref(false);
const archivedCount = computed(() => vessels.value.filter((v) => v.archivedAt).length);
const shown = computed(() => vessels.value.filter((v) => !v.archivedAt || showArchived.value));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    vessels.value = (await vesselsApi.list(ws)).vessels;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const busyId = ref<string | null>(null);
async function setArchived(v: Vessel, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = v.id;
  error.value = '';
  try {
    const { vessel } = await vesselsApi.update(ws, v.id, { archived });
    vessels.value = vessels.value.map((x) => (x.id === vessel.id ? vessel : x));
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Select mode for exporting some vessels (components/ExportBar.vue).
const selection = useSelection();
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'vessel-new' }">Add vessel</RouterLink>
    </div>
    <SetupTabs />
    <p class="muted intro">Carafes, mugs and cups. Weigh a brew in one and its weight is taken off the yield.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading vessels…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="vessels.length === 0" class="card empty"><p>No vessels yet.</p></div>
      <template v-else>
        <label v-if="archivedCount" class="checkbox">
          <input v-model="showArchived" type="checkbox" />
          Show archived ({{ archivedCount }})
        </label>
        <ListDataBar list="vessels" noun="vessels" :selection="selection" :visible-ids="shown.map((v) => v.id)" @imported="load()" />
        <ul class="list">
          <li v-for="v in shown" :key="v.id" class="card item">
            <input v-if="selection.selecting" type="checkbox" :checked="selection.has(v.id)" :aria-label="`Select ${v.name}`" @change="selection.toggle(v.id)" />
            <div class="text">
              <strong>{{ v.name }}</strong><span v-if="v.archivedAt" class="muted"> (archived)</span>
              <span class="muted small">{{ formatGrams(v.weightGrams) }} g</span>
            </div>
            <div v-if="workspaces.canEdit && !selection.selecting" class="actions">
              <RouterLink class="btn-link" :to="{ name: 'vessel-edit', params: { id: v.id } }">Edit</RouterLink>
              <button class="btn-link" type="button" :disabled="busyId === v.id" @click="setArchived(v, !v.archivedAt)">{{ v.archivedAt ? 'Restore' : 'Archive' }}</button>
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
  gap: var(--space-3);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.actions {
  display: flex;
  gap: var(--space-3);
  flex-shrink: 0;
}
</style>

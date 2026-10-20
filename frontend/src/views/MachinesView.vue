<script setup lang="ts">
// Espresso machine management (docs/api_spec.md §3c), one tab of Equipment.
// Works like grinders: retire keeps history; delete only for unused machines.
import { computed, onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { machinesApi } from '../api/machines';
import type { Machine } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EquipmentTabs from '../components/EquipmentTabs.vue';
import MachineFields, { type MachineForm } from '../components/MachineFields.vue';
import { machineSummary } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const machines = ref<Machine[]>([]);
const loading = ref(true);
const error = ref('');
const active = computed(() => machines.value.filter((m) => !m.retiredAt));
const retired = computed(() => machines.value.filter((m) => m.retiredAt));

function machineForm(m?: Machine): MachineForm {
  return {
    name: m?.name ?? '',
    notes: m?.notes ?? '',
    preinfusion: m?.preinfusion ?? 'none',
    flowControl: m?.flowControl ?? 'none',
    pressureControl: m?.pressureControl ?? 'none',
  };
}
function input(f: MachineForm) {
  return { ...f, name: f.name.trim(), notes: f.notes.trim() || null };
}
const duplicate = (err: unknown) => (err instanceof ApiError && err.status === 409 ? 'A machine with that name already exists.' : errorMessage(err));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    machines.value = (await machinesApi.list(ws)).machines;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function replace(updated: Machine): void {
  machines.value = machines.value.map((m) => (m.id === updated.id ? updated : m));
}

// Add
const newForm = ref(machineForm());
const addSubmitted = ref(false);
const adding = ref(false);
const addError = ref('');
async function add(): Promise<void> {
  addSubmitted.value = true;
  const ws = workspaces.current?.id;
  if (!ws || !newForm.value.name.trim()) return;
  adding.value = true;
  addError.value = '';
  try {
    await machinesApi.create(ws, input(newForm.value));
    newForm.value = machineForm();
    addSubmitted.value = false;
    await load();
  } catch (err) {
    addError.value = duplicate(err);
  } finally {
    adding.value = false;
  }
}

// Edit (one at a time, inline)
const editingId = ref<string | null>(null);
const editForm = ref(machineForm());
const editError = ref('');
const busyId = ref<string | null>(null);
function startEdit(m: Machine): void {
  editingId.value = m.id;
  editForm.value = machineForm(m);
  editError.value = '';
}
async function saveEdit(m: Machine): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !editForm.value.name.trim()) return;
  busyId.value = m.id;
  editError.value = '';
  try {
    replace((await machinesApi.update(ws, m.id, input(editForm.value))).machine);
    editingId.value = null;
  } catch (err) {
    editError.value = duplicate(err);
  } finally {
    busyId.value = null;
  }
}

async function setRetired(m: Machine, value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = m.id;
  error.value = '';
  try {
    replace((await machinesApi.update(ws, m.id, { retired: value })).machine);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Delete: confirm; if brews used it, the server says how many and we offer Retire.
const pending = ref<Machine | null>(null);
const usedCount = ref<number | null>(null);
const deleting = ref(false);
const dialogError = ref('');
function askDelete(m: Machine): void {
  pending.value = m;
  usedCount.value = null;
  dialogError.value = '';
}
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const m = pending.value;
  if (!ws || !m) return;
  deleting.value = true;
  dialogError.value = '';
  try {
    await machinesApi.remove(ws, m.id);
    pending.value = null;
    await load();
  } catch (err) {
    const count = err instanceof ApiError && err.status === 409 ? err.body?.brewLogCount : undefined;
    if (typeof count === 'number') usedCount.value = count;
    else dialogError.value = errorMessage(err);
  } finally {
    deleting.value = false;
  }
}
async function retireInstead(): Promise<void> {
  const m = pending.value;
  pending.value = null;
  if (m) await setRetired(m, true);
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Equipment</h1>
    </div>
    <EquipmentTabs />
    <p class="muted intro">Espresso brews record the machine, and the shot timer follows what it can do.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading machines…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="machines.length === 0" class="card empty"><p>No machines yet.</p></div>

      <ul v-if="active.length" class="list">
        <li v-for="m in active" :key="m.id" class="card item">
          <form v-if="editingId === m.id" class="stack" novalidate @submit.prevent="saveEdit(m)">
            <MachineFields v-model="editForm" :id-prefix="`edit-${m.id}`" :show-errors="true" />
            <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
            <div class="buttons">
              <button class="btn btn-secondary" type="button" @click="editingId = null">Cancel</button>
              <button class="btn btn-primary" type="submit" :disabled="busyId === m.id || !editForm.name.trim()">Save</button>
            </div>
          </form>
          <template v-else>
            <div>
              <h2>{{ m.name }}</h2>
              <p class="muted">{{ machineSummary(m) }}</p>
              <p v-if="m.notes" class="muted">{{ m.notes }}</p>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" @click="startEdit(m)">Edit</button>
              <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setRetired(m, true)">Retire</button>
              <button class="btn-link danger" type="button" @click="askDelete(m)">Delete</button>
            </div>
          </template>
        </li>
      </ul>

      <section v-if="retired.length" class="stack">
        <h2 class="section-title">Retired</h2>
        <p class="muted small">Hidden when brewing; past brews still show them.</p>
        <ul class="list">
          <li v-for="m in retired" :key="m.id" class="card item retired">
            <div>
              <h2>{{ m.name }}</h2>
              <p class="muted">{{ machineSummary(m) }}</p>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setRetired(m, false)">Restore</button>
            </div>
          </li>
        </ul>
      </section>

      <form v-if="workspaces.canEdit" class="card stack" novalidate @submit.prevent="add">
        <h2>Add a machine</h2>
        <MachineFields v-model="newForm" id-prefix="new" :show-errors="addSubmitted" />
        <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="adding">{{ adding ? 'Adding…' : 'Add machine' }}</button>
      </form>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" :title="usedCount === null ? 'Delete this machine?' : 'This machine has brew history'" @cancel="pending = null">
    <p v-if="usedCount === null">{{ pending?.name }} will be removed.</p>
    <p v-else>
      {{ usedCount }} shot{{ usedCount === 1 ? ' was' : 's were' }} pulled on {{ pending?.name }}, so it can't be deleted.
      Retire it instead: it's hidden when brewing, and past brews keep showing it.
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button v-if="usedCount === null" class="btn btn-danger" type="button" :disabled="deleting" @click="confirmDelete">Delete</button>
      <button v-else class="btn btn-primary" type="button" @click="retireInstead">Retire instead</button>
      <button class="btn btn-secondary" type="button" :disabled="deleting" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
.section-title {
  margin-top: var(--space-2);
  color: var(--text-muted);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}
.item.retired {
  opacity: 0.75;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

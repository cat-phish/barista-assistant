<script setup lang="ts">
// Grinder management (docs/api_spec.md §3b), one tab of Equipment. Retire
// keeps history; delete only works for grinders no brew used.
import { computed, onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { grindersApi } from '../api/grinders';
import type { Grinder } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EquipmentTabs from '../components/EquipmentTabs.vue';
import GrinderFields from '../components/GrinderFields.vue';
import { grinderForm, grinderSummary, parseGrinderForm } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const grinders = ref<Grinder[]>([]);
const loading = ref(true);
const error = ref('');
const active = computed(() => grinders.value.filter((g) => !g.retiredAt));
const retired = computed(() => grinders.value.filter((g) => g.retiredAt));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    grinders.value = (await grindersApi.list(ws)).grinders;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function replace(updated: Grinder): void {
  grinders.value = grinders.value.map((g) => (g.id === updated.id ? updated : g));
}

// Add
const newForm = ref(grinderForm());
const newParsed = computed(() => parseGrinderForm(newForm.value));
const addSubmitted = ref(false);
const adding = ref(false);
const addError = ref('');
async function add(): Promise<void> {
  addSubmitted.value = true;
  const ws = workspaces.current?.id;
  const values = newParsed.value.values;
  if (!ws || !values) return;
  adding.value = true;
  addError.value = '';
  try {
    const { name, ...details } = values;
    await grindersApi.create(ws, name, details);
    newForm.value = grinderForm();
    addSubmitted.value = false;
    await load();
  } catch (err) {
    addError.value = err instanceof ApiError && err.status === 409 ? 'A grinder with that name already exists.' : errorMessage(err);
  } finally {
    adding.value = false;
  }
}

// Edit (one at a time, inline)
const editingId = ref<string | null>(null);
const editForm = ref(grinderForm());
const editParsed = computed(() => parseGrinderForm(editForm.value));
const editError = ref('');
const busyId = ref<string | null>(null);
function startEdit(g: Grinder): void {
  editingId.value = g.id;
  editForm.value = grinderForm(g);
  editError.value = '';
}
async function saveEdit(g: Grinder): Promise<void> {
  const ws = workspaces.current?.id;
  const values = editParsed.value.values;
  if (!ws || !values) return;
  busyId.value = g.id;
  editError.value = '';
  try {
    replace((await grindersApi.update(ws, g.id, values)).grinder);
    editingId.value = null;
  } catch (err) {
    editError.value = err instanceof ApiError && err.status === 409 ? 'A grinder with that name already exists.' : errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

async function setRetired(g: Grinder, value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = g.id;
  error.value = '';
  try {
    replace((await grindersApi.update(ws, g.id, { retired: value })).grinder);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Delete: confirm; if brews used it, the server says how many and we offer Retire.
const pending = ref<Grinder | null>(null);
const usedCount = ref<number | null>(null);
const deleting = ref(false);
const dialogError = ref('');
function askDelete(g: Grinder): void {
  pending.value = g;
  usedCount.value = null;
  dialogError.value = '';
}
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const g = pending.value;
  if (!ws || !g) return;
  deleting.value = true;
  dialogError.value = '';
  try {
    await grindersApi.remove(ws, g.id);
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
  const g = pending.value;
  pending.value = null;
  if (g) await setRetired(g, true);
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Equipment</h1>
    </div>
    <EquipmentTabs />
    <p class="muted intro">Brews record which grinder you used, so grind settings stay meaningful.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading grinders…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="grinders.length === 0" class="card empty"><p>No grinders yet.</p></div>

      <ul v-if="active.length" class="list">
        <li v-for="g in active" :key="g.id" class="card grinder">
          <template v-if="editingId === g.id">
            <form class="stack" novalidate @submit.prevent="saveEdit(g)">
              <GrinderFields v-model="editForm" :id-prefix="`edit-${g.id}`" :errors="editParsed.errors" :show-errors="true" />
              <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
              <div class="buttons">
                <button class="btn btn-secondary" type="button" @click="editingId = null">Cancel</button>
                <button class="btn btn-primary" type="submit" :disabled="busyId === g.id || !editParsed.values">Save</button>
              </div>
            </form>
          </template>
          <template v-else>
            <div>
              <h2>{{ g.name }}</h2>
              <p v-if="grinderSummary(g)" class="muted">{{ grinderSummary(g) }}</p>
              <p v-if="g.notes" class="muted">{{ g.notes }}</p>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" @click="startEdit(g)">Edit</button>
              <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setRetired(g, true)">Retire</button>
              <button class="btn-link danger" type="button" @click="askDelete(g)">Delete</button>
            </div>
          </template>
        </li>
      </ul>

      <section v-if="retired.length" class="stack">
        <h2 class="section-title">Retired</h2>
        <p class="muted small">Hidden when brewing; past brews still show them.</p>
        <ul class="list">
          <li v-for="g in retired" :key="g.id" class="card grinder retired">
            <div>
              <h2>{{ g.name }}</h2>
              <p v-if="g.notes" class="muted">{{ g.notes }}</p>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setRetired(g, false)">Restore</button>
            </div>
          </li>
        </ul>
      </section>

      <form v-if="workspaces.canEdit" class="card stack" novalidate @submit.prevent="add">
        <h2>Add a grinder</h2>
        <p class="muted small">Only the name is needed; the rest helps the AI and is easy to add later.</p>
        <GrinderFields v-model="newForm" id-prefix="new" :errors="newParsed.errors" :show-errors="addSubmitted" />
        <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="adding">{{ adding ? 'Adding…' : 'Add grinder' }}</button>
      </form>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" :title="usedCount === null ? 'Delete this grinder?' : 'This grinder has brew history'" @cancel="pending = null">
    <p v-if="usedCount === null">{{ pending?.name }} will be removed.</p>
    <p v-else>
      {{ usedCount }} brew{{ usedCount === 1 ? ' was' : 's were' }} made with {{ pending?.name }}, so it can't be deleted.
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
.grinder {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}
.grinder.retired {
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

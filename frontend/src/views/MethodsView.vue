<script setup lang="ts">
// Brew methods (docs/api_spec.md §3), one tab of Equipment: rename, change
// kind (refused while recipes use the method), delete (refused while recipes
// use it), add.
import { onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { brewMethodsApi } from '../api/recipes';
import type { BrewMethod, MethodKind } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EquipmentTabs from '../components/EquipmentTabs.vue';
import { METHOD_KINDS } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const methods = ref<BrewMethod[]>([]);
const loading = ref(true);
const error = ref('');

// 409s: a taken name, or recipes that pin the kind / block the delete.
function conflictMessage(err: unknown, action: 'kind' | 'delete' | 'name'): string {
  if (!(err instanceof ApiError) || err.status !== 409) return errorMessage(err);
  const count = err.body?.recipeCount;
  if (typeof count === 'number') {
    const recipes = `${count} recipe${count === 1 ? ' uses' : 's use'} this method`;
    return action === 'delete'
      ? `${recipes}. Move them to another method or delete them first.`
      : `${recipes}, so its kind can't change: their fields depend on it. Create a new method instead.`;
  }
  return 'A method with that name already exists.';
}

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    methods.value = (await brewMethodsApi.list(ws)).brewMethods;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Add
const newName = ref('');
const newKind = ref<MethodKind>('pour_over');
const adding = ref(false);
const addError = ref('');
async function add(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !newName.value.trim()) return;
  adding.value = true;
  addError.value = '';
  try {
    await brewMethodsApi.create(ws, newName.value.trim(), newKind.value);
    newName.value = '';
    newKind.value = 'pour_over';
    await load();
  } catch (err) {
    addError.value = conflictMessage(err, 'name');
  } finally {
    adding.value = false;
  }
}

// Edit (one at a time, inline)
const editingId = ref<string | null>(null);
const editName = ref('');
const editKind = ref<MethodKind>('pour_over');
const editError = ref('');
const busy = ref(false);
function startEdit(m: BrewMethod): void {
  editingId.value = m.id;
  editName.value = m.name;
  editKind.value = m.kind;
  editError.value = '';
}
async function saveEdit(m: BrewMethod): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !editName.value.trim()) return;
  busy.value = true;
  editError.value = '';
  try {
    const { brewMethod } = await brewMethodsApi.update(ws, m.id, { name: editName.value.trim(), kind: editKind.value });
    methods.value = methods.value.map((x) => (x.id === m.id ? brewMethod : x)).sort((a, b) => a.name.localeCompare(b.name));
    editingId.value = null;
  } catch (err) {
    editError.value = conflictMessage(err, editKind.value !== m.kind ? 'kind' : 'name');
  } finally {
    busy.value = false;
  }
}

// Delete
const pending = ref<BrewMethod | null>(null);
const dialogError = ref('');
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const m = pending.value;
  if (!ws || !m) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await brewMethodsApi.remove(ws, m.id);
    pending.value = null;
    await load();
  } catch (err) {
    dialogError.value = conflictMessage(err, 'delete');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Equipment</h1>
    </div>
    <EquipmentTabs />
    <p class="muted intro">Recipes pick a method; its kind decides which recipe fields apply.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading brew methods…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <ul class="list">
        <li v-for="m in methods" :key="m.id" class="card item">
          <form v-if="editingId === m.id" class="stack" novalidate @submit.prevent="saveEdit(m)">
            <div class="form-row">
              <div class="field">
                <label :for="`edit-name-${m.id}`">Name</label>
                <input :id="`edit-name-${m.id}`" v-model="editName" maxlength="100" />
              </div>
              <div class="field">
                <label :for="`edit-kind-${m.id}`">Kind</label>
                <select :id="`edit-kind-${m.id}`" v-model="editKind">
                  <option v-for="(k, key) in METHOD_KINDS" :key="key" :value="key">{{ k.label }}</option>
                </select>
              </div>
            </div>
            <p class="muted small">{{ METHOD_KINDS[editKind].hint }}</p>
            <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
            <div class="buttons">
              <button class="btn btn-secondary" type="button" @click="editingId = null">Cancel</button>
              <button class="btn btn-primary" type="submit" :disabled="busy || !editName.trim()">Save</button>
            </div>
          </form>
          <div v-else class="row">
            <div class="head">
              <h2>{{ m.name }}</h2>
              <span class="badge">{{ METHOD_KINDS[m.kind].label }}</span>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" @click="startEdit(m)">Edit</button>
              <button class="btn-link danger" type="button" @click="pending = m; dialogError = ''">Delete</button>
            </div>
          </div>
        </li>
      </ul>

      <form v-if="workspaces.canEdit" class="card stack" novalidate @submit.prevent="add">
        <h2>Add a brew method</h2>
        <div class="form-row">
          <div class="field">
            <label for="new-name">Name</label>
            <input id="new-name" v-model="newName" maxlength="100" placeholder="e.g. Chemex" />
          </div>
          <div class="field">
            <label for="new-kind">Kind</label>
            <select id="new-kind" v-model="newKind">
              <option v-for="(k, key) in METHOD_KINDS" :key="key" :value="key">{{ k.label }}</option>
            </select>
          </div>
        </div>
        <p class="muted small">{{ METHOD_KINDS[newKind].hint }}</p>
        <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="adding || !newName.trim()">{{ adding ? 'Adding…' : 'Add method' }}</button>
      </form>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" title="Delete this brew method?" @cancel="pending = null">
    <p>{{ pending?.name }} will be removed.</p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
  margin: 0;
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
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
/* Name + kind on the left, actions on the right: methods are one-liners. */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.actions {
  display: flex;
  flex-shrink: 0;
  margin-right: calc(-1 * var(--space-2));
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

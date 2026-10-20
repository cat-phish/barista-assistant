<script setup lang="ts">
// Ingredients (docs/api_spec.md §5b): reusable preps that finish drinks, with
// free-text instructions. Deleting is refused while drinks use one.
import { onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { ingredientsApi, type IngredientInput } from '../api/ingredients';
import type { Ingredient, IngredientType } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import MenuTabs from '../components/MenuTabs.vue';
import { INGREDIENT_TYPES } from '../lib/drinks';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const list = ref<Ingredient[]>([]);
const loading = ref(true);
const error = ref('');

interface Form {
  name: string;
  ingredientType: IngredientType;
  instructions: string;
}
const emptyForm = (c?: Ingredient): Form => ({ name: c?.name ?? '', ingredientType: c?.ingredientType ?? 'other', instructions: c?.instructions ?? '' });
const input = (f: Form): IngredientInput => ({ name: f.name.trim(), ingredientType: f.ingredientType, instructions: f.instructions.trim() || null });
const conflict = (err: unknown) => (err instanceof ApiError && err.status === 409 ? 'An ingredient with that name already exists.' : errorMessage(err));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    list.value = (await ingredientsApi.list(ws)).ingredients;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Add
const newForm = ref(emptyForm());
const adding = ref(false);
const addError = ref('');
async function add(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !newForm.value.name.trim()) return;
  adding.value = true;
  addError.value = '';
  try {
    await ingredientsApi.create(ws, input(newForm.value));
    newForm.value = emptyForm();
    await load();
  } catch (err) {
    addError.value = conflict(err);
  } finally {
    adding.value = false;
  }
}

// Edit (one at a time, inline)
const editingId = ref<string | null>(null);
const editForm = ref(emptyForm());
const editError = ref('');
const busy = ref(false);
function startEdit(c: Ingredient): void {
  editingId.value = c.id;
  editForm.value = emptyForm(c);
  editError.value = '';
}
async function saveEdit(c: Ingredient): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !editForm.value.name.trim()) return;
  busy.value = true;
  editError.value = '';
  try {
    const { ingredient } = await ingredientsApi.update(ws, c.id, input(editForm.value));
    list.value = list.value.map((x) => (x.id === c.id ? ingredient : x)).sort((a, b) => a.name.localeCompare(b.name));
    editingId.value = null;
  } catch (err) {
    editError.value = conflict(err);
  } finally {
    busy.value = false;
  }
}

// Delete
const pending = ref<Ingredient | null>(null);
const dialogError = ref('');
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const c = pending.value;
  if (!ws || !c) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await ingredientsApi.remove(ws, c.id);
    pending.value = null;
    await load();
  } catch (err) {
    const count = err instanceof ApiError && err.status === 409 ? err.body?.drinkCount : undefined;
    dialogError.value =
      typeof count === 'number' ? `${count} drink${count === 1 ? ' uses' : 's use'} it. Remove it from ${count === 1 ? 'that drink' : 'those drinks'} first.` : errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Ingredients</h1>
    </div>
    <MenuTabs />
    <p class="muted intro">What finishes a drink besides the coffee: milk, foam, syrup, ice…</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading ingredients…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="list.length === 0" class="card empty"><p>No ingredients yet.</p></div>
      <ul v-else class="list">
        <li v-for="c in list" :key="c.id" class="card item">
          <form v-if="editingId === c.id" class="stack" novalidate @submit.prevent="saveEdit(c)">
            <div class="form-row">
              <div class="field">
                <label :for="`edit-name-${c.id}`">Name</label>
                <input :id="`edit-name-${c.id}`" v-model="editForm.name" maxlength="100" />
              </div>
              <div class="field">
                <label :for="`edit-type-${c.id}`">Type</label>
                <select :id="`edit-type-${c.id}`" v-model="editForm.ingredientType">
                  <option v-for="(label, key) in INGREDIENT_TYPES" :key="key" :value="key">{{ label }}</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label :for="`edit-instructions-${c.id}`">Instructions <span class="muted">(optional)</span></label>
              <textarea :id="`edit-instructions-${c.id}`" v-model="editForm.instructions" rows="4" maxlength="5000" />
            </div>
            <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
            <div class="buttons">
              <button class="btn btn-secondary" type="button" @click="editingId = null">Cancel</button>
              <button class="btn btn-primary" type="submit" :disabled="busy || !editForm.name.trim()">Save</button>
            </div>
          </form>
          <template v-else>
            <div class="head">
              <h2>{{ c.name }}</h2>
              <span class="badge">{{ INGREDIENT_TYPES[c.ingredientType] }}</span>
            </div>
            <p v-if="c.instructions" class="instructions">{{ c.instructions }}</p>
            <p class="muted small">{{ c.drinkCount === 0 ? 'Not in any drink yet' : `In ${c.drinkCount} drink${c.drinkCount === 1 ? '' : 's'}` }}</p>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" @click="startEdit(c)">Edit</button>
              <button class="btn-link danger" type="button" @click="pending = c; dialogError = ''">Delete</button>
            </div>
          </template>
        </li>
      </ul>

      <form v-if="workspaces.canEdit" class="card stack" novalidate @submit.prevent="add">
        <h2>Add an ingredient</h2>
        <div class="form-row">
          <div class="field">
            <label for="new-name">Name</label>
            <input id="new-name" v-model="newForm.name" maxlength="100" placeholder="e.g. Orange cold foam" />
          </div>
          <div class="field">
            <label for="new-type">Type</label>
            <select id="new-type" v-model="newForm.ingredientType">
              <option v-for="(label, key) in INGREDIENT_TYPES" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="new-instructions">Instructions <span class="muted">(optional)</span></label>
          <textarea id="new-instructions" v-model="newForm.instructions" rows="4" maxlength="5000" placeholder="e.g. Steep orange peel in cream overnight, then froth cold." />
        </div>
        <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="adding || !newForm.name.trim()">{{ adding ? 'Adding…' : 'Add ingredient' }}</button>
      </form>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" title="Delete this ingredient?" @cancel="pending = null">
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
.instructions {
  white-space: pre-line;
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
textarea {
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: max(1rem, 16px);
  resize: vertical;
}
</style>

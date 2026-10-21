<script setup lang="ts">
// Drink categories (docs/api/drink-categories.md §5d): the ordered menu sections. Add,
// rename, move up/down, delete (its drinks and brewers become uncategorised).
import { ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import type { DrinkCategory } from '../api/types';
import { useWorkspaceStore } from '../stores/workspace';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{ categories: DrinkCategory[] }>();
const emit = defineEmits<{ changed: [] }>();
const workspaces = useWorkspaceStore();

const busy = ref(false);
const error = ref('');
const conflict = (err: unknown) => (err instanceof ApiError && err.status === 409 ? 'A category with that name already exists.' : errorMessage(err));

async function run(action: (ws: string) => Promise<unknown>): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws) return false;
  busy.value = true;
  error.value = '';
  try {
    await action(ws);
    emit('changed');
    return true;
  } catch (err) {
    error.value = conflict(err);
    return false;
  } finally {
    busy.value = false;
  }
}

const newName = ref('');
async function add(): Promise<void> {
  const name = newName.value.trim();
  if (name && (await run((ws) => drinkCategoriesApi.create(ws, name)))) newName.value = '';
}

const editingId = ref<string | null>(null);
const editName = ref('');
function startEdit(c: DrinkCategory): void {
  editingId.value = c.id;
  editName.value = c.name;
  error.value = '';
}
async function saveEdit(c: DrinkCategory): Promise<void> {
  const name = editName.value.trim();
  if (name && (await run((ws) => drinkCategoriesApi.rename(ws, c.id, name)))) editingId.value = null;
}

async function move(index: number, by: -1 | 1): Promise<void> {
  const ids = props.categories.map((c) => c.id);
  const [id] = ids.splice(index, 1);
  if (!id) return;
  ids.splice(index + by, 0, id);
  await run((ws) => drinkCategoriesApi.reorder(ws, ids));
}

const pending = ref<DrinkCategory | null>(null);
async function confirmDelete(): Promise<void> {
  const c = pending.value;
  if (c && (await run((ws) => drinkCategoriesApi.remove(ws, c.id)))) pending.value = null;
}
</script>

<template>
  <section class="card stack" aria-labelledby="categories-title">
    <h2 id="categories-title">Categories</h2>
    <p class="muted small">What you pick first when you brew, and the menu's sections, in this order. Drinks and brewers can each be in one, and a category can mix brewers: Specialty Drinks might hold a V60 drink and an espresso drink.</p>
    <ol v-if="categories.length" class="categories">
      <li v-for="(c, i) in categories" :key="c.id">
        <form v-if="editingId === c.id" class="row" novalidate @submit.prevent="saveEdit(c)">
          <label class="visually-hidden" :for="`category-${c.id}`">Name</label>
          <input :id="`category-${c.id}`" v-model="editName" maxlength="100" />
          <button class="btn-link" type="submit" :disabled="busy || !editName.trim()">Save</button>
          <button class="btn-link" type="button" @click="editingId = null">Cancel</button>
        </form>
        <div v-else class="row">
          <span class="name">{{ c.name }}</span>
          <template v-if="workspaces.canEdit">
            <button class="btn-link" type="button" :disabled="busy || i === 0" :aria-label="`Move ${c.name} up`" @click="move(i, -1)">↑</button>
            <button class="btn-link" type="button" :disabled="busy || i === categories.length - 1" :aria-label="`Move ${c.name} down`" @click="move(i, 1)">↓</button>
            <button class="btn-link" type="button" @click="startEdit(c)">Rename</button>
            <button class="btn-link danger" type="button" @click="pending = c">Delete</button>
          </template>
        </div>
      </li>
    </ol>
    <p v-else class="muted small">No categories yet.</p>
    <form v-if="workspaces.canEdit" class="row" novalidate @submit.prevent="add">
      <label class="visually-hidden" for="new-category">New category</label>
      <input id="new-category" v-model="newName" maxlength="100" placeholder="e.g. Espresso milk drinks" />
      <button class="btn btn-secondary" type="submit" :disabled="busy || !newName.trim()">Add</button>
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>

  <ConfirmDialog :open="pending !== null" title="Delete this category?" @cancel="pending = null">
    <p>{{ pending?.name }} will be removed. Its drinks and brewers stay, uncategorised.</p>
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
.small {
  font-size: 0.85rem;
}
.categories {
  margin: 0;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.row input {
  flex: 1;
  min-width: 10rem;
}
.name {
  flex: 1;
}
</style>

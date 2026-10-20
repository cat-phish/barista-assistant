<script setup lang="ts">
// Brewers (docs/api_spec.md §3), one tab of Equipment: whatever makes the
// coffee, from a V60 to an espresso machine. Works like grinders: retire keeps
// history; delete only for brewers no recipe, drink or brew uses.
import { computed, onMounted, ref } from 'vue';
import { brewersApi, type BrewerInput } from '../api/brewers';
import { ApiError, errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import type { Brewer, DrinkCategory } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import BrewerFields, { type BrewerForm } from '../components/BrewerFields.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EquipmentTabs from '../components/EquipmentTabs.vue';
import { machineSummary, METHOD_KINDS } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const brewers = ref<Brewer[]>([]);
const categories = ref<DrinkCategory[]>([]);
const loading = ref(true);
const error = ref('');
const active = computed(() => brewers.value.filter((m) => !m.retiredAt));
const retired = computed(() => brewers.value.filter((m) => m.retiredAt));
const categoryName = (id: string | null) => categories.value.find((c) => c.id === id)?.name ?? null;

function brewerForm(m?: Brewer): BrewerForm {
  return {
    name: m?.name ?? '',
    kind: m?.kind ?? 'pour_over',
    notes: m?.notes ?? '',
    preinfusion: m?.preinfusion ?? 'none',
    flowControl: m?.flowControl ?? 'none',
    pressureControl: m?.pressureControl ?? 'none',
    showOnPublicMenu: m?.showOnPublicMenu ?? false,
    menuName: m?.menuName ?? '',
    description: m?.description ?? '',
    categoryId: m?.categoryId ?? '',
  };
}
function input(f: BrewerForm): BrewerInput & { name: string } {
  const espresso = f.kind === 'espresso';
  return {
    name: f.name.trim(),
    kind: f.kind,
    notes: f.notes.trim() || null,
    // Capabilities only mean something for espresso.
    preinfusion: espresso ? f.preinfusion : 'none',
    flowControl: espresso ? f.flowControl : 'none',
    pressureControl: espresso ? f.pressureControl : 'none',
    showOnPublicMenu: f.showOnPublicMenu,
    menuName: f.menuName.trim() || null,
    description: f.description.trim() || null,
    categoryId: f.categoryId || null,
  };
}
// 409s: a taken name, or recipes that pin the kind.
function conflict(err: unknown): string {
  if (!(err instanceof ApiError) || err.status !== 409) return errorMessage(err);
  const count = err.body?.recipeCount;
  if (typeof count === 'number') {
    return `${count} recipe${count === 1 ? ' uses' : 's use'} this brewer, so its kind can't change: their fields depend on it. Add a new brewer instead.`;
  }
  return 'A brewer with that name already exists.';
}

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, c] = await Promise.all([brewersApi.list(ws), drinkCategoriesApi.list(ws)]);
    brewers.value = b.brewers;
    categories.value = c.categories;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function replace(updated: Brewer): void {
  brewers.value = brewers.value.map((m) => (m.id === updated.id ? updated : m));
}

// Add
const newForm = ref(brewerForm());
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
    await brewersApi.create(ws, input(newForm.value));
    newForm.value = brewerForm();
    addSubmitted.value = false;
    await load();
  } catch (err) {
    addError.value = conflict(err);
  } finally {
    adding.value = false;
  }
}

// Edit (one at a time, inline)
const editingId = ref<string | null>(null);
const editForm = ref(brewerForm());
const editError = ref('');
const busyId = ref<string | null>(null);
function startEdit(m: Brewer): void {
  editingId.value = m.id;
  editForm.value = brewerForm(m);
  editError.value = '';
}
async function saveEdit(m: Brewer): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !editForm.value.name.trim()) return;
  busyId.value = m.id;
  editError.value = '';
  try {
    replace((await brewersApi.update(ws, m.id, input(editForm.value))).brewer);
    editingId.value = null;
  } catch (err) {
    editError.value = conflict(err);
  } finally {
    busyId.value = null;
  }
}

async function setRetired(m: Brewer, value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = m.id;
  error.value = '';
  try {
    replace((await brewersApi.update(ws, m.id, { retired: value })).brewer);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Delete: confirm; if brews used it, the server says how many and we offer Retire.
const pending = ref<Brewer | null>(null);
const usedCount = ref<number | null>(null);
const deleting = ref(false);
const dialogError = ref('');
function askDelete(m: Brewer): void {
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
    await brewersApi.remove(ws, m.id);
    pending.value = null;
    await load();
  } catch (err) {
    // Recipes and drinks must move first; brew history means retire instead.
    const body = err instanceof ApiError && err.status === 409 ? err.body : null;
    const uses = Number(body?.recipeCount ?? 0) + Number(body?.drinkCount ?? 0);
    if (body && uses === 0 && typeof body.brewLogCount === 'number') usedCount.value = body.brewLogCount;
    else dialogError.value = body ? `${body.recipeCount} recipe(s) and ${body.drinkCount} drink(s) use ${m.name}. Move them to another brewer or delete them first.` : errorMessage(err);
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
    <p class="muted intro">Recipes and drinks are made with a brewer; its kind decides the recipe fields, and an espresso machine's controls shape the shot timer.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading brewers…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="brewers.length === 0" class="card empty"><p>No brewers yet.</p></div>

      <ul v-if="active.length" class="list">
        <li v-for="m in active" :key="m.id" class="card item">
          <form v-if="editingId === m.id" class="stack" novalidate @submit.prevent="saveEdit(m)">
            <BrewerFields v-model="editForm" :id-prefix="`edit-${m.id}`" :show-errors="true" :categories="categories" />
            <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
            <div class="buttons">
              <button class="btn btn-secondary" type="button" @click="editingId = null">Cancel</button>
              <button class="btn btn-primary" type="submit" :disabled="busyId === m.id || !editForm.name.trim()">Save</button>
            </div>
          </form>
          <template v-else>
            <div class="stack-tight">
              <div class="head">
                <h2>{{ m.name }}</h2>
                <span class="badge">{{ METHOD_KINDS[m.kind].label }}</span>
                <span v-if="categoryName(m.categoryId)" class="badge">{{ categoryName(m.categoryId) }}</span>
                <span v-if="m.showOnPublicMenu" class="badge muted-badge">On menu{{ m.menuName ? ` as ${m.menuName}` : '' }}</span>
              </div>
              <p v-if="m.kind === 'espresso'" class="muted">{{ machineSummary(m) }}</p>
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
            <div class="head">
              <h2>{{ m.name }}</h2>
              <span class="badge">{{ METHOD_KINDS[m.kind].label }}</span>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setRetired(m, false)">Restore</button>
            </div>
          </li>
        </ul>
      </section>

      <form v-if="workspaces.canEdit" class="card stack" novalidate @submit.prevent="add">
        <h2>Add a brewer</h2>
        <BrewerFields v-model="newForm" id-prefix="new" :show-errors="addSubmitted" :categories="categories" />
        <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="adding">{{ adding ? 'Adding…' : 'Add brewer' }}</button>
      </form>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" :title="usedCount === null ? 'Delete this brewer?' : 'This brewer has brew history'" @cancel="pending = null">
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
.stack-tight {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
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

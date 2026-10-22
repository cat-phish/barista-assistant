<script setup lang="ts">
// Brewers (docs/api/brewers.md §3), one tab of Bar setup: whatever makes the
// coffee, from a V60 to an espresso machine. A table: filter by type (or
// Retired), sort by any column; a row expands to its details and actions.
// Works like grinders: retire keeps history; delete only for brewers no
// recipe or brew uses.
import { computed, onMounted, ref, watch } from 'vue';
import { brewersApi } from '../api/brewers';
import { recipesApi } from '../api/recipes';
import { ApiError, errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import type { Brewer, DrinkCategory, Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SetupTabs from '../components/SetupTabs.vue';
import ListControls from '../components/ListControls.vue';
import { machineSummary, METHOD_KINDS, RECIPE_STYLES, STYLE_ORDER } from '../lib/equipment';
import { formatAdded } from '../lib/format';
import {
  addedColumn,
  enumColumn,
  isSortKey,
  nameColumn,
  recallView,
  rememberView,
  sortArrow,
  sortBy,
  sortLabel,
  sortColumnOptions,
  toggleHeader,
  type SortColumns,
} from '../lib/listSort';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const brewers = ref<Brewer[]>([]);
const categories = ref<DrinkCategory[]>([]);
const loading = ref(true);
const error = ref('');
const categoryName = (id: string | null) => categories.value.find((c) => c.id === id)?.name ?? null;
const recipes = ref<Recipe[]>([]);
// "2 recipes: pour over, immersion": how this brewer is used (styles live on recipes).
function recipeSummary(brewerId: string): string {
  const mine = recipes.value.filter((r) => r.brewer.id === brewerId);
  if (mine.length === 0) return 'No recipes yet';
  const styles = STYLE_ORDER.filter((st) => mine.some((r) => r.style === st)).map((st) => RECIPE_STYLES[st].toLowerCase());
  return `${mine.length} recipe${mine.length === 1 ? '' : 's'}${styles.length ? `: ${styles.join(', ')}` : ''}`;
}

// View choices, remembered per workspace.
const viewKey = (what: string) => `brewers.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const RETIRED = 'retired';
const KINDS = Object.keys(METHOD_KINDS) as Array<keyof typeof METHOD_KINDS>;
const columns: SortColumns<Brewer> = {
  name: nameColumn(),
  kind: enumColumn('Method', KINDS, (b) => b.kind),
  category: { label: 'Category', value: (b) => categoryName(b.categoryId) },
  added: addedColumn(),
};
const sortChoices = sortColumnOptions(columns);
const filter = ref(ALL);
const sort = ref('name_asc');
watch(filter, (v) => rememberView(viewKey('filter'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));
const filterOptions = computed(() => [
  { value: ALL, label: 'All brewers' },
  ...KINDS.map((k) => ({ value: k, label: METHOD_KINDS[k].label })),
  ...(brewers.value.some((b) => b.retiredAt) ? [{ value: RETIRED, label: 'Retired' }] : []),
]);
const filterName = computed(() => filterOptions.value.find((o) => o.value === filter.value)?.label ?? '');
const shown = computed(() => {
  const f = filter.value;
  const list = f === RETIRED ? brewers.value.filter((b) => b.retiredAt) : brewers.value.filter((b) => !b.retiredAt && (f === ALL || b.kind === f));
  return sortBy(list, sort.value, columns);
});
// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, c, r] = await Promise.all([brewersApi.list(ws), drinkCategoriesApi.list(ws), recipesApi.list(ws)]);
    brewers.value = b.brewers;
    categories.value = c.categories;
    recipes.value = r.recipes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  const savedSort = recallView(viewKey('sort'));
  if (isSortKey(savedSort, columns)) sort.value = savedSort;
  await load();
  const savedFilter = recallView(viewKey('filter'));
  if (savedFilter && filterOptions.value.some((o) => o.value === savedFilter)) filter.value = savedFilter;
});

function replace(updated: Brewer): void {
  brewers.value = brewers.value.map((m) => (m.id === updated.id ? updated : m));
}

const busyId = ref<string | null>(null);
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
    // Recipes must move first; brew history means retire instead.
    const body = err instanceof ApiError && err.status === 409 ? err.body : null;
    const uses = Number(body?.recipeCount ?? 0);
    if (body && uses === 0 && typeof body.brewLogCount === 'number') usedCount.value = body.brewLogCount;
    else dialogError.value = body ? `${body.recipeCount} recipe(s) use ${m.name}. Move them to another brewer or delete them first.` : errorMessage(err);
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
      <h1>Bar setup</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'brewer-new' }">Add brewer</RouterLink>
    </div>
    <SetupTabs />
    <p class="muted intro">Recipes and drinks are made with a brewer; its kind decides the recipe fields, and an espresso machine's controls shape the shot timer.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading brewers…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="brewers.length === 0" class="card empty"><p>No brewers yet.</p></div>
      <template v-else>
        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="brewers" filter-label="Brew method" :filter-options="filterOptions" />
        <p v-if="filter === RETIRED" class="muted small">Retired brewers are hidden when brewing; past brews still show them.</p>
        <p v-if="shown.length === 0" class="card empty">No {{ filter === ALL ? 'brewers' : `${filterName.toLowerCase()} brewers` }} yet.</p>
        <div v-else class="data-table" style="--cols: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.3fr) 5.5rem">
          <div class="data-row data-head">
            <button v-for="c in ['name', 'kind', 'category']" :key="c" class="data-th" type="button" :aria-label="sortLabel(sort, c, columns[c]!.label)" @click="sort = toggleHeader(sort, c, columns)">
              {{ columns[c]!.label }} <span aria-hidden="true">{{ sortArrow(sort, c) }}</span>
            </button>
            <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
              Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
            </button>
          </div>
          <div v-for="m in shown" :key="m.id" class="data-item" :class="{ open: openId === m.id }">
            <button class="data-row" type="button" :aria-expanded="openId === m.id" @click="toggle(m.id)">
              <span class="data-td primary">{{ m.name }}</span>
              <span class="data-td">{{ METHOD_KINDS[m.kind].label }}</span>
              <span class="data-td">{{ categoryName(m.categoryId) ?? '–' }}</span>
              <span class="data-td end">{{ formatAdded(m.createdAt) }}</span>
            </button>
            <div v-if="openId === m.id" class="data-details">
              <p v-if="m.kind === 'espresso'" class="muted">{{ machineSummary(m) }}</p>
              <p v-if="m.notes" class="muted">{{ m.notes }}</p>
              <p class="muted">{{ recipeSummary(m.id) }}</p>
              <p class="muted">{{ m.showOnPublicMenu ? `On the menu${m.menuName ? ` as ${m.menuName}` : ''}` : 'Not on the menu' }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <template v-if="m.retiredAt">
                  <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setRetired(m, false)">Restore</button>
                </template>
                <template v-else>
                  <RouterLink class="btn-link" :to="{ name: 'brewer-edit', params: { id: m.id } }">Edit</RouterLink>
                  <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setRetired(m, true)">Retire</button>
                </template>
                <button class="btn-link danger" type="button" @click="askDelete(m)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </template>
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
</style>

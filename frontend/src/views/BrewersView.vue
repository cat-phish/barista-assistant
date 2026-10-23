<script setup lang="ts">
// Brewers (docs/api/brewers.md §3), one tab of Bar setup: whatever makes the
// coffee, from a V60 to an espresso machine. A table: filter by type (or
// Archived), sort by any column; a row expands to its details and actions.
// Works like grinders: archive keeps history; delete only for brewers no
// recipe or brew uses.
import { computed, onMounted, ref, watch } from 'vue';
import { brewerMethodsApi } from '../api/brewerMethods';
import { brewersApi } from '../api/brewers';
import { recipesApi } from '../api/recipes';
import { errorMessage } from '../api/client';
import type { Brewer, Recipe, BrewerMethod } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import SetupTabs from '../components/SetupTabs.vue';
import ListControls from '../components/ListControls.vue';
import { machineSummary, METHOD_KINDS } from '../lib/equipment';
import { formatAdded } from '../lib/format';
import {
  addedColumn,
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
const methods = ref<BrewerMethod[]>([]); // names and order (docs/api/brewer-methods.md §3e)
const methodKey = (b: Brewer) => b.methodId ?? b.kind;
const methodName = (b: Brewer) => methods.value.find((m) => m.id === b.methodId)?.name ?? METHOD_KINDS[b.kind].label;
const loading = ref(true);
const error = ref('');
const recipes = ref<Recipe[]>([]);
const recipeCount = (brewerId: string) => recipes.value.filter((r) => r.brewer.id === brewerId).length;
// "2 recipes: pour over, immersion": how this brewer is used (styles live on recipes).
function recipeSummary(brewerId: string): string {
  const mine = recipes.value.filter((r) => r.brewer.id === brewerId);
  if (mine.length === 0) return 'No recipes yet';
  const styles = [...new Set(mine.flatMap((r) => (r.style ? [r.style.name.toLowerCase()] : [])))];
  return `${mine.length} recipe${mine.length === 1 ? '' : 's'}${styles.length ? `: ${styles.join(', ')}` : ''}`;
}

// View choices, remembered per workspace.
const viewKey = (what: string) => `brewers.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const columns: SortColumns<Brewer> = {
  name: nameColumn(),
  // By the workspace's method order; brewers without one after, by kind.
  kind: {
    label: 'Method',
    value: (b) => {
      const i = methods.value.findIndex((m) => m.id === b.methodId);
      return i >= 0 ? i : methods.value.length + Object.keys(METHOD_KINDS).indexOf(b.kind);
    },
    asc: 'In list order',
    desc: 'Reversed',
  },
  recipes: { label: 'Recipes', value: (b) => recipeCount(b.id), asc: 'Fewest first', desc: 'Most first', firstDir: 'desc' },
  added: addedColumn(),
};
const sortChoices = sortColumnOptions(columns);
const filter = ref(ALL);
const showArchived = ref(false);
const archivedCount = computed(() => brewers.value.filter((b) => b.archivedAt).length);
const sort = ref('name_asc');
watch(filter, (v) => rememberView(viewKey('filter'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));
// The methods that have brewers, in the workspace's order.
const filterOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const b of [...brewers.value].sort((x, y) => (columns.kind!.value(x) as number) - (columns.kind!.value(y) as number))) {
    if (!seen.has(methodKey(b))) seen.set(methodKey(b), methodName(b));
  }
  return [{ value: ALL, label: 'All brewers' }, ...[...seen].map(([value, label]) => ({ value, label }))];
});
const filterName = computed(() => filterOptions.value.find((o) => o.value === filter.value)?.label ?? '');
const shown = computed(() => {
  const f = filter.value;
  const list = brewers.value.filter((b) => (!b.archivedAt || showArchived.value) && (f === ALL || methodKey(b) === f));
  return sortBy(list, sort.value, columns);
});
// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, r, bm] = await Promise.all([brewersApi.list(ws), recipesApi.list(ws), brewerMethodsApi.list(ws).catch(() => ({ methods: [] }))]);
    methods.value = bm.methods;
    brewers.value = b.brewers;
    recipes.value = r.recipes;
    if (archivedCount.value === 0) showArchived.value = false;
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
async function setArchived(m: Brewer, value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = m.id;
  error.value = '';
  try {
    replace((await brewersApi.update(ws, m.id, { archived: value })).brewer);
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
        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="brewers" filter-label="Brew method" :filter-options="filterOptions" v-model:show-archived="showArchived" :archived-count="archivedCount" />
        <p v-if="showArchived" class="muted small">Archived brewers are hidden when brewing; past brews still show them.</p>
        <p v-if="shown.length === 0" class="card empty">No {{ filter === ALL ? 'brewers' : `${filterName.toLowerCase()} brewers` }} yet.</p>
        <div v-else class="data-table" style="--cols: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.3fr) 5.5rem">
          <div class="data-row data-head">
            <button v-for="c in ['name', 'kind', 'recipes']" :key="c" class="data-th" type="button" :aria-label="sortLabel(sort, c, columns[c]!.label)" @click="sort = toggleHeader(sort, c, columns)">
              {{ columns[c]!.label }} <span aria-hidden="true">{{ sortArrow(sort, c) }}</span>
            </button>
            <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
              Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
            </button>
          </div>
          <div v-for="m in shown" :key="m.id" class="data-item" :class="{ open: openId === m.id }">
            <button class="data-row" type="button" :aria-expanded="openId === m.id" @click="toggle(m.id)">
              <span class="data-td primary">{{ m.name }}<span v-if="m.archivedAt" class="muted"> (archived)</span></span>
              <span class="data-td">{{ methodName(m) }}</span>
              <span class="data-td">{{ recipeCount(m.id) }}</span>
              <span class="data-td end">{{ formatAdded(m.createdAt) }}</span>
            </button>
            <div v-if="openId === m.id" class="data-details">
              <p v-if="m.kind === 'espresso'" class="muted">{{ machineSummary(m) }}</p>
              <p v-if="m.notes" class="muted">{{ m.notes }}</p>
              <p class="muted">{{ recipeSummary(m.id) }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <RouterLink class="btn-link" :to="{ name: 'brewer-edit', params: { id: m.id } }">Edit</RouterLink>
                <template v-if="m.archivedAt">
                  <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setArchived(m, false)">Restore</button>
                </template>
                <template v-else>
                  <button class="btn-link" type="button" :disabled="busyId === m.id" @click="setArchived(m, true)">Archive</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </main>
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

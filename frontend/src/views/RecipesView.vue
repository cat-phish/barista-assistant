<script setup lang="ts">
// Recipes (docs/api/recipes.md §5) as a table: filter by brewer, sort by name,
// brewer, style, dose or date added (headers or the dropdown), Show archived; a row expands to its
// details. Archived recipes leave the brew page and drink forms.
import { computed, onMounted, ref, watch } from 'vue';
import { brewersApi } from '../api/brewers';
import { errorMessage } from '../api/client';
import { recipesApi } from '../api/recipes';
import type { Brewer, Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ListControls from '../components/ListControls.vue';
import ListDataBar from '../components/ListDataBar.vue';
import ColumnsDialog from '../components/ColumnsDialog.vue';
import TableHead from '../components/TableHead.vue';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import { useTableColumns, type TableColumn } from '../lib/tableColumns';
import { useSelection } from '../composables/useSelection';
import MenuTabs from '../components/MenuTabs.vue';
import { formatAdded, formatDoseLine, formatGrams, formatGrind, formatTime } from '../lib/format';
import { addedColumn, isSortKey, nameColumn, recallView, rememberView, sortBy, sortColumnOptions, type SortColumns } from '../lib/listSort';
import { formatFinishWindow, plannedEnd, splitPrep, stepTitle } from '../lib/steps';
import { formatTemp } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { temperatureUnit } = usePreferences();
const recipes = ref<Recipe[]>([]);
const brewers = ref<Brewer[]>([]);
const loading = ref(true);
const error = ref('');

// View choices, remembered per workspace.
const viewKey = (what: string) => `recipes.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const columns: SortColumns<Recipe> = {
  name: nameColumn(),
  brewer: { label: 'Brewer', value: (r) => r.brewer.name, asc: 'A–Z', desc: 'Z–A' },
  style: { label: 'Style', value: (r) => r.style?.name ?? null, asc: 'A–Z', desc: 'Z–A' },
  // The coffee dose in grams, the first figure in the Dose cell.
  dose: { label: 'Dose', value: (r) => r.targetDoseGrams, asc: 'Lowest first', desc: 'Highest first' },
  added: addedColumn(),
};

const { show } = useFieldVisibility();
// Table columns: shown, hidden and moved in the Columns dialog, resizable
// from the header (ColumnResizers). The ones in `columns` sort.
const TABLE: TableColumn[] = [
  { id: 'name', label: 'Name', track: 'minmax(0, 2fr)' },
  { id: 'brewer', label: 'Brewer', track: 'minmax(0, 1.1fr)' },
  { id: 'style', label: 'Style', track: 'minmax(0, 0.9fr)' },
  { id: 'dose', label: 'Dose', track: 'minmax(0, 1.2fr)' },
  { id: 'added', label: 'Added', title: 'Date added', track: '5.5rem', end: true },
];
const table = useTableColumns({ key: 'recipes', workspace: () => workspaces.current?.id ?? '', available: (id) => id !== 'style' || show('recipe.style'), columns: TABLE });
const choosingColumns = ref(false);
const cell = (r: Recipe, id: string): string => {
  if (id === 'brewer') return r.brewer.name;
  if (id === 'style') return r.style?.name ?? '–';
  if (id === 'dose') return formatDoseLine(r.targetDoseGrams, r.targetWaterGrams, r.expectedYieldGrams, r.targetIceGrams);
  return formatAdded(r.createdAt);
};
const sortChoices = sortColumnOptions(columns);
const brewerFilter = ref(ALL);
const showArchived = ref(false);
const archivedCount = computed(() => recipes.value.filter((r) => r.archivedAt).length);
const sort = ref('added_desc');
watch(brewerFilter, (v) => rememberView(viewKey('brewer'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));

async function load(): Promise<void> {
  const id = workspaces.current?.id;
  if (!id) return;
  try {
    const [r, b] = await Promise.all([recipesApi.list(id), brewersApi.list(id)]);
    recipes.value = r.recipes;
    brewers.value = b.brewers;
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
  const savedBrewer = recallView(viewKey('brewer'));
  if (savedBrewer && brewerOptions.value.some((o) => o.value === savedBrewer)) brewerFilter.value = savedBrewer;
});

// Brewers that have recipes, by name; archived ones marked.
const brewerOptions = computed(() => {
  const used = new Set(recipes.value.map((r) => r.brewer.id));
  return [
    { value: ALL, label: 'All brewers' },
    ...brewers.value
      .filter((b) => used.has(b.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => ({ value: b.id, label: b.archivedAt ? `${b.name} (archived)` : b.name })),
  ];
});
const filterName = computed(() => brewerOptions.value.find((o) => o.value === brewerFilter.value)?.label ?? '');
const shown = computed(() =>
  sortBy(
    recipes.value.filter((r) => (!r.archivedAt || showArchived.value) && (brewerFilter.value === ALL || r.brewer.id === brewerFilter.value)),
    sort.value,
    columns,
  ),
);

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

// "Prep: Rinse the filter · Bloom → Swirl → Main pour → Drawdown · ends 3:00":
// the planned end, when the steps have one (≈ when a step waits for a tap or
// first drop).
function stepsSummary(recipe: Recipe): string | null {
  if (!recipe.steps.length) return null;
  const { prep, brew } = splitPrep(recipe.steps);
  const end = plannedEnd(recipe.steps);
  const parts = [
    prep.length ? `Prep: ${prep.map(stepTitle).join(', ')}` : '',
    brew.map(stepTitle).join(' → '),
    end ? `${end.exact ? 'ends' : 'ends ≈'} ${formatTime(end.at)}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

const busyId = ref<string | null>(null);
async function setArchived(r: Recipe, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = r.id;
  error.value = '';
  try {
    const { recipe } = await recipesApi.update(ws, r.id, { archived });
    recipes.value = recipes.value.map((x) => (x.id === recipe.id ? recipe : x));
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Select mode for exporting some items (components/ExportBar.vue).
const selection = useSelection();
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Recipes</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'recipe-new' }">Add recipe</RouterLink>
    </div>
    <MenuTabs />

    <p v-if="loading" class="muted" aria-live="polite">Loading recipes…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="recipes.length === 0" class="card empty">
      <p>No recipes yet.</p>
      <p v-if="workspaces.canEdit">Add your go-to recipe, with its pours, to use the brew timer.</p>
    </div>

    <template v-else>
      <ListControls v-model:filter="brewerFilter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="recipes" filter-label="Brewer" :filter-options="brewerOptions" v-model:show-archived="showArchived" :archived-count="archivedCount" />
      <ListDataBar list="recipes" noun="recipes" :selection="selection" :visible-ids="shown.map((x) => x.id)" @imported="load()">
        <template v-if="shown.length">
          <button v-if="table.widths.resized" class="btn-link widths-reset" type="button" @click="table.widths.reset()">Reset widths</button>
          <button class="btn-link" type="button" @click="choosingColumns = true">Columns…</button>
        </template>
      </ListDataBar>
      <ColumnsDialog :open="choosingColumns" :state="table" noun="recipe" @close="choosingColumns = false" />
      <p v-if="showArchived" class="muted small">Archived recipes are hidden when brewing and in drink forms; past brews still show them.</p>
      <p v-if="shown.length === 0" class="card empty">No recipes for {{ filterName }} yet.</p>
      <div v-else class="data-table" :style="{ '--cols': table.widths.template }">
        <TableHead v-model:sort="sort" :state="table" :sort-columns="columns" />
        <div v-for="recipe in shown" :key="recipe.id" class="data-item" :class="{ open: openId === recipe.id }">
          <button class="data-row" type="button" :aria-expanded="selection.selecting ? undefined : openId === recipe.id" :aria-pressed="selection.selecting ? selection.has(recipe.id) : undefined" @click="selection.selecting ? selection.toggle(recipe.id) : toggle(recipe.id)">
            <span class="data-td primary"><span v-if="selection.selecting" class="tick" aria-hidden="true">{{ selection.has(recipe.id) ? '☑' : '☐' }}</span>{{ recipe.name }}<span v-if="recipe.archivedAt" class="muted"> (archived)</span></span>
            <span v-for="col in table.shown.slice(1)" :key="col.id" class="data-td" :class="[col.class, { end: table.isEnd(col) }]">{{ cell(recipe, col.id) }}</span>
          </button>
          <div v-if="openId === recipe.id" class="data-details">
            <p class="facts">
              <span v-if="recipe.expectedYieldGrams !== null && recipe.targetWaterGrams !== null">≈{{ formatGrams(recipe.expectedYieldGrams) }} g yield</span>
              <span v-if="formatFinishWindow(recipe.firstDropMinSec, recipe.firstDropMaxSec)">first drop {{ formatFinishWindow(recipe.firstDropMinSec, recipe.firstDropMaxSec) }}</span>
              <span v-if="formatFinishWindow(recipe.expectedFinishMinSec, recipe.expectedFinishMaxSec)">{{ recipe.brewer.kind === 'espresso' ? 'shot' : 'finish' }} {{ formatFinishWindow(recipe.expectedFinishMinSec, recipe.expectedFinishMaxSec) }}</span>
              <span v-if="recipe.targetTempC !== null">{{ formatTemp(recipe.targetTempC, temperatureUnit) }}</span>
            </p>
            <p v-if="recipe.grindSettings.length" class="muted small">
              Grind ≈ {{ recipe.grindSettings.map((g) => `${formatGrind(g.setting)} on ${g.grinderName}`).join(' · ') }}
            </p>
            <p v-if="stepsSummary(recipe)" class="small">{{ stepsSummary(recipe) }}</p>
            <div v-if="workspaces.canEdit" class="data-actions">
              <RouterLink class="btn-link" :to="{ name: 'recipe-new', query: { from: recipe.id } }">Duplicate</RouterLink>
              <RouterLink class="btn-link" :to="{ name: 'recipe-edit', params: { id: recipe.id } }">Edit</RouterLink>
              <button v-if="recipe.archivedAt" class="btn-link" type="button" :disabled="busyId === recipe.id" @click="setArchived(recipe, false)">Restore</button>
              <button v-else class="btn-link" type="button" :disabled="busyId === recipe.id" @click="setArchived(recipe, true)">Archive</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.9rem;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 0.95rem;
}
</style>

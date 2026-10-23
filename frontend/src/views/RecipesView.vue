<script setup lang="ts">
// Recipes (docs/api/recipes.md §5) as a table: filter by brewer, sort by name or
// date added (headers or the dropdown), Show archived; a row expands to its
// details. Archived recipes leave the brew page and drink forms.
import { computed, onMounted, ref, watch } from 'vue';
import { brewersApi } from '../api/brewers';
import { errorMessage } from '../api/client';
import { recipesApi } from '../api/recipes';
import type { Brewer, Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ListControls from '../components/ListControls.vue';
import MenuTabs from '../components/MenuTabs.vue';
import { RECIPE_STYLES, STYLE_ORDER } from '../lib/equipment';
import { formatAdded, formatDoseLine, formatGrams, formatTime } from '../lib/format';
import { addedColumn, enumColumn, isSortKey, nameColumn, recallView, rememberView, sortArrow, sortBy, sortLabel, sortColumnOptions, toggleHeader, type SortColumns } from '../lib/listSort';
import { formatFinishWindow, plannedStarts, stepTitle } from '../lib/steps';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const recipes = ref<Recipe[]>([]);
const brewers = ref<Brewer[]>([]);
const loading = ref(true);
const error = ref('');
const pending = ref<Recipe | null>(null);
const busy = ref(false);
const dialogError = ref('');

// View choices, remembered per workspace.
const viewKey = (what: string) => `recipes.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const columns: SortColumns<Recipe> = {
  name: nameColumn(),
  style: enumColumn('Style', STYLE_ORDER, (r) => r.style),
  added: addedColumn(),
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

// "Bloom → Swirl → Main pour → Drawdown · ≈ 3:00": the planned end, when the
// steps have one (≈ when a step waits for a tap or first drop).
function stepsSummary(recipe: Recipe): string | null {
  const last = recipe.steps[recipe.steps.length - 1];
  if (!last) return null;
  const starts = plannedStarts(recipe.steps);
  const lastStart = starts[starts.length - 1];
  const end = lastStart && last.durationSec !== null ? lastStart.at + last.durationSec : null;
  const titles = recipe.steps.map(stepTitle).join(' → ');
  return end === null ? titles : `${titles} · ${lastStart?.exact ? 'ends' : 'ends ≈'} ${formatTime(end)}`;
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

async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !pending.value) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await recipesApi.remove(ws, pending.value.id);
    pending.value = null;
    await load();
  } catch (err) {
    dialogError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

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
      <p v-if="showArchived" class="muted small">Archived recipes are hidden when brewing and in drink forms; past brews still show them.</p>
      <p v-if="shown.length === 0" class="card empty">No recipes for {{ filterName }} yet.</p>
      <div v-else class="data-table" style="--cols: minmax(0, 2fr) minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 1.2fr) 5.5rem">
        <div class="data-row data-head">
          <button class="data-th" type="button" :aria-label="sortLabel(sort, 'name', 'Name')" @click="sort = toggleHeader(sort, 'name', columns)">
            Name <span aria-hidden="true">{{ sortArrow(sort, 'name') }}</span>
          </button>
          <span class="data-th">Brewer</span>
          <button class="data-th" type="button" :aria-label="sortLabel(sort, 'style', 'Style')" @click="sort = toggleHeader(sort, 'style', columns)">
            Style <span aria-hidden="true">{{ sortArrow(sort, 'style') }}</span>
          </button>
          <span class="data-th">Dose</span>
          <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
            Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
          </button>
        </div>
        <div v-for="recipe in shown" :key="recipe.id" class="data-item" :class="{ open: openId === recipe.id }">
          <button class="data-row" type="button" :aria-expanded="openId === recipe.id" @click="toggle(recipe.id)">
            <span class="data-td primary">{{ recipe.name }}<span v-if="recipe.archivedAt" class="muted"> (archived)</span></span>
            <span class="data-td">{{ recipe.brewer.name }}</span>
            <span class="data-td">{{ recipe.style ? RECIPE_STYLES[recipe.style] : '–' }}</span>
            <span class="data-td">{{ formatDoseLine(recipe.targetDoseGrams, recipe.targetWaterGrams, recipe.expectedYieldGrams) }}</span>
            <span class="data-td end">{{ formatAdded(recipe.createdAt) }}</span>
          </button>
          <div v-if="openId === recipe.id" class="data-details">
            <p class="facts">
              <span v-if="recipe.expectedYieldGrams !== null && recipe.targetWaterGrams !== null">≈{{ formatGrams(recipe.expectedYieldGrams) }} g yield</span>
              <span v-if="formatFinishWindow(recipe.firstDropMinSec, recipe.firstDropMaxSec)">first drop {{ formatFinishWindow(recipe.firstDropMinSec, recipe.firstDropMaxSec) }}</span>
              <span v-if="formatFinishWindow(recipe.expectedFinishMinSec, recipe.expectedFinishMaxSec)">{{ recipe.brewer.kind === 'espresso' ? 'shot' : 'finish' }} {{ formatFinishWindow(recipe.expectedFinishMinSec, recipe.expectedFinishMaxSec) }}</span>
              <span v-if="recipe.targetTempC !== null">{{ recipe.targetTempC }} °C</span>
            </p>
            <p v-if="recipe.grindSettings.length" class="muted small">
              Grind ≈ {{ recipe.grindSettings.map((g) => `${g.setting} on ${g.grinderName}`).join(' · ') }}
            </p>
            <p v-if="stepsSummary(recipe)" class="small">{{ stepsSummary(recipe) }}</p>
            <div v-if="workspaces.canEdit" class="data-actions">
              <RouterLink class="btn-link" :to="{ name: 'recipe-new', query: { from: recipe.id } }">Duplicate</RouterLink>
              <RouterLink class="btn-link" :to="{ name: 'recipe-edit', params: { id: recipe.id } }">Edit</RouterLink>
              <button v-if="recipe.archivedAt" class="btn-link" type="button" :disabled="busyId === recipe.id" @click="setArchived(recipe, false)">Restore</button>
              <button v-else class="btn-link" type="button" :disabled="busyId === recipe.id" @click="setArchived(recipe, true)">Archive</button>
              <button class="btn-link danger" type="button" @click="pending = recipe; dialogError = ''">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" title="Delete this recipe?" @cancel="pending = null">
    <p>
      "{{ pending?.name }}" and its steps will be removed. Brews already logged with it are kept.
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete recipe</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
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

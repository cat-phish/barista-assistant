<script setup lang="ts">
// Ingredients (docs/api/ingredients.md §5b): reusable preps that finish drinks, as a
// table like Recipes: filter by type (or the unused ones), sort by name, type,
// how many drinks use it, or date added; a row expands to its instructions,
// the drinks it's in and the units they measure it in. Adding and editing
// happen on their own page (IngredientFormView). Deleting is refused while
// drinks use one.
import { computed, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { drinksApi } from '../api/drinks';
import { ingredientsApi } from '../api/ingredients';
import type { Drink, Ingredient, IngredientType } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ListControls from '../components/ListControls.vue';
import ListDataBar from '../components/ListDataBar.vue';
import { useSelection } from '../composables/useSelection';
import MenuTabs from '../components/MenuTabs.vue';
import { INGREDIENT_TYPES, ingredientUsage } from '../lib/drinks';
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
const list = ref<Ingredient[]>([]);
const drinks = ref<Drink[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [i, d] = await Promise.all([ingredientsApi.list(ws), drinksApi.list(ws)]);
    list.value = i.ingredients;
    drinks.value = d.drinks;
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

// View choices, remembered per workspace.
const viewKey = (what: string) => `ingredients.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const UNUSED = 'unused';
const TYPES = Object.keys(INGREDIENT_TYPES) as IngredientType[];
const columns: SortColumns<Ingredient> = {
  name: nameColumn(),
  type: enumColumn('Type', TYPES, (i) => i.ingredientType),
  used: { label: 'Used in', value: (i) => i.drinkCount, asc: 'Least used first', desc: 'Most used first', firstDir: 'desc' },
  added: addedColumn(),
};
const sortChoices = sortColumnOptions(columns);
const filter = ref(ALL);
const showArchived = ref(false);
const archivedCount = computed(() => list.value.filter((i) => i.archivedAt).length);
const sort = ref('name_asc');
watch(filter, (v) => rememberView(viewKey('filter'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));
onMounted(async () => {
  const savedSort = recallView(viewKey('sort'));
  if (isSortKey(savedSort, columns)) sort.value = savedSort;
  await load();
  const savedFilter = recallView(viewKey('filter'));
  if (savedFilter && filterOptions.value.some((o) => o.value === savedFilter)) filter.value = savedFilter;
});

// Types that have ingredients, in their order; then the unused ones.
const filterOptions = computed(() => [
  { value: ALL, label: 'All ingredients' },
  ...TYPES.filter((t) => list.value.some((i) => i.ingredientType === t)).map((t) => ({ value: t, label: INGREDIENT_TYPES[t] })),
  ...(list.value.some((i) => i.drinkCount === 0) ? [{ value: UNUSED, label: 'Not in any drink' }] : []),
]);
const shown = computed(() => {
  const f = filter.value;
  const kept = list.value.filter(
    (i) => (!i.archivedAt || showArchived.value) && (f === ALL || (f === UNUSED ? i.drinkCount === 0 : i.ingredientType === f)),
  );
  return sortBy(kept, sort.value, columns);
});
const usage = computed(() => ingredientUsage(drinks.value));
const usedLabel = (n: number) => (n === 0 ? 'Not used' : `${n} drink${n === 1 ? '' : 's'}`);

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

const busyId = ref<string | null>(null);
async function setArchived(c: Ingredient, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = c.id;
  error.value = '';
  try {
    const { ingredient } = await ingredientsApi.update(ws, c.id, { archived });
    list.value = list.value.map((x) => (x.id === ingredient.id ? ingredient : x));
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
      <h1>Ingredients</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'ingredient-new' }">Add ingredient</RouterLink>
    </div>
    <MenuTabs />
    <p class="muted intro">What finishes a drink besides the coffee: milk, foam, syrup, ice…</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading ingredients…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-else>
      <div v-if="list.length === 0" class="card empty"><p>No ingredients yet.</p></div>
      <template v-else>
        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="ingredients" filter-label="Show" :filter-options="filterOptions" v-model:show-archived="showArchived" :archived-count="archivedCount" />
        <ListDataBar list="ingredients" noun="ingredients" :selection="selection" :visible-ids="shown.map((x) => x.id)" @imported="load()" />
        <p v-if="showArchived" class="muted small">Archived ingredients can't be added to drinks; drinks that have them keep them.</p>
        <p v-if="shown.length === 0" class="card empty">Nothing here yet.</p>
        <div v-else class="data-table" style="--cols: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 5.5rem">
          <div class="data-row data-head">
            <button v-for="c in ['name', 'type', 'used']" :key="c" class="data-th" type="button" :aria-label="sortLabel(sort, c, columns[c]!.label)" @click="sort = toggleHeader(sort, c, columns)">
              {{ columns[c]!.label }} <span aria-hidden="true">{{ sortArrow(sort, c) }}</span>
            </button>
            <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
              Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
            </button>
          </div>
          <div v-for="c in shown" :key="c.id" class="data-item" :class="{ open: openId === c.id }">
            <button class="data-row" type="button" :aria-expanded="selection.selecting ? undefined : openId === c.id" :aria-pressed="selection.selecting ? selection.has(c.id) : undefined" @click="selection.selecting ? selection.toggle(c.id) : toggle(c.id)">
              <span class="data-td primary"><span v-if="selection.selecting" class="tick" aria-hidden="true">{{ selection.has(c.id) ? '☑' : '☐' }}</span>{{ c.name }}<span v-if="c.archivedAt" class="muted"> (archived)</span></span>
              <span class="data-td">{{ INGREDIENT_TYPES[c.ingredientType] }}</span>
              <span class="data-td">{{ usedLabel(c.drinkCount) }}</span>
              <span class="data-td end">{{ formatAdded(c.createdAt) }}</span>
            </button>
            <div v-if="openId === c.id" class="data-details">
              <p v-if="c.instructions" class="instructions">{{ c.instructions }}</p>
              <p v-else class="muted">No instructions yet.</p>
              <p v-if="usage.get(c.id)?.drinks.length" class="small">
                <span class="label">Used in</span>
                <template v-for="(d, i) in usage.get(c.id)!.drinks" :key="d.id"
                  ><template v-if="i">, </template><RouterLink :to="{ name: 'drink-edit', params: { id: d.id } }">{{ d.name }}</RouterLink></template
                >
              </p>
              <p v-if="usage.get(c.id)?.units.length" class="small muted">
                <span class="label">Measured in</span> {{ usage.get(c.id)!.units.join(', ') }}
              </p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <RouterLink class="btn-link" :to="{ name: 'ingredient-edit', params: { id: c.id } }">Edit</RouterLink>
                <button v-if="c.archivedAt" class="btn-link" type="button" :disabled="busyId === c.id" @click="setArchived(c, false)">Restore</button>
                <button v-else class="btn-link" type="button" :disabled="busyId === c.id" @click="setArchived(c, true)">Archive</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.9rem;
}
.instructions {
  white-space: pre-line;
}
.label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-right: var(--space-1);
}
</style>

<script setup lang="ts">
// Drinks (docs/api/drinks.md §5c) as a table: filter by category, sort by name
// (variants stay under their parent) or date added (a flat list); a row
// expands to its details. Show archived adds archived drinks, which leave the
// brew page. The categories that group drinks are edited below the list.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import { drinksApi } from '../api/drinks';
import { recipesApi } from '../api/recipes';
import type { Drink, DrinkCategory, Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import DrinkCategoriesPanel from '../components/DrinkCategoriesPanel.vue';
import ListControls from '../components/ListControls.vue';
import ListDataBar from '../components/ListDataBar.vue';
import { useSelection } from '../composables/useSelection';
import MenuTabs from '../components/MenuTabs.vue';
import { ingredientLine, nestDrinks, type NestedDrink } from '../lib/drinks';
import { METHOD_KINDS } from '../lib/equipment';
import { formatAdded } from '../lib/format';
import { addedColumn, isSortKey, nameColumn, recallView, rememberView, sortArrow, sortBy, sortLabel, sortColumnOptions, sortsByName, toggleHeader, type SortColumns } from '../lib/listSort';
import { defaultSize, formatSize } from '../lib/servings';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const route = useRoute();
const drinks = ref<Drink[]>([]);
const categories = ref<DrinkCategory[]>([]);
const recipes = ref<Recipe[]>([]);
const loading = ref(true);
const error = ref('');

// View choices, remembered per workspace.
const viewKey = (what: string) => `drinks.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const columns: SortColumns<Drink> = { name: nameColumn(), added: addedColumn() };
const sortChoices = sortColumnOptions(columns);
const NONE = 'none'; // uncategorised
const categoryFilter = ref(ALL);
const showArchived = ref(false);
const archivedCount = computed(() => drinks.value.filter((d) => d.archivedAt).length);
const sort = ref('name_asc');
watch(categoryFilter, (v) => rememberView(viewKey('category'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [d, c, r] = await Promise.all([drinksApi.list(ws), drinkCategoriesApi.list(ws), recipesApi.list(ws)]);
    drinks.value = d.drinks;
    categories.value = c.categories;
    if (archivedCount.value === 0) showArchived.value = false;
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
  // The old Bar setup → Categories address lands here (router redirect).
  if (route.hash === '#categories') {
    await nextTick();
    document.getElementById('categories')?.scrollIntoView();
  }
  const savedCategory = recallView(viewKey('category'));
  if (savedCategory && categoryOptions.value.some((o) => o.value === savedCategory)) categoryFilter.value = savedCategory;
});

const categoryOptions = computed(() => [
  { value: ALL, label: 'All categories' },
  ...[...categories.value].sort((a, b) => a.position - b.position).map((c) => ({ value: c.id, label: c.name })),
  ...(drinks.value.some((d) => !d.category) ? [{ value: NONE, label: 'Uncategorised' }] : []),
]);
const filterName = computed(() => categoryOptions.value.find((o) => o.value === categoryFilter.value)?.label ?? '');
// By name: variants nested under their parent. By date: flat.
const shown = computed<NestedDrink[]>(() => {
  const f = categoryFilter.value;
  const list = drinks.value.filter((d) => (!d.archivedAt || showArchived.value) && (f === ALL || (d.category?.id ?? NONE) === f));
  if (sortsByName(sort.value)) return nestDrinks(list, sort.value === 'name_desc');
  return sortBy(list, sort.value, columns).map((drink) => ({ drink, depth: 0 }));
});
const nested = computed(() => sortsByName(sort.value));
// The default recipe and its brewer: "V60 Standard (V60)".
const recipeName = (id: string | null) => {
  const r = recipes.value.find((x) => x.id === id);
  return r ? `${r.name} (${r.brewer.name})` : null;
};

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

const busyId = ref<string | null>(null);
async function setArchived(d: Drink, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = d.id;
  error.value = '';
  try {
    const { drink } = await drinksApi.update(ws, d.id, { archived });
    drinks.value = drinks.value.map((x) => (x.id === drink.id ? drink : x));
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
      <h1>Drinks</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'drink-new' }">Add drink</RouterLink>
    </div>
    <MenuTabs />
    <p class="muted intro">
      A drink is built on a brewer, brewed with any of its recipes and finished with ingredients. Plain brews like "V60" are the brewers
      themselves (<RouterLink :to="{ name: 'brewers' }">Bar setup</RouterLink>). <a href="#categories">Categories</a>, below the list, group drinks when you brew.
    </p>

    <p v-if="loading" class="muted" aria-live="polite">Loading drinks…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <div v-else-if="drinks.length === 0" class="card empty">
      <p>No drinks yet.</p>
      <p v-if="workspaces.canEdit">Start with a classic like "Latte" (Espresso + steamed milk), then make variants of it.</p>
    </div>

    <template v-else>
      <ListControls v-model:filter="categoryFilter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="drinks" filter-label="Category" :filter-options="categoryOptions" v-model:show-archived="showArchived" :archived-count="archivedCount" />
      <ListDataBar list="drinks" noun="drinks" :selection="selection" :visible-ids="shown.map((x) => x.drink.id)" @imported="load()" />
      <p v-if="showArchived" class="muted small">Archived drinks are hidden when brewing; past brews still show them, and so does the public menu if it has them.</p>
      <p v-if="shown.length === 0" class="card empty">No drinks in {{ filterName }} yet.</p>
      <div v-else class="data-table" style="--cols: minmax(0, 2fr) minmax(0, 1.3fr) minmax(0, 1.2fr) 5.5rem">
        <div class="data-row data-head">
          <button class="data-th" type="button" :aria-label="sortLabel(sort, 'name', 'Name')" @click="sort = toggleHeader(sort, 'name', columns)">
            Name <span aria-hidden="true">{{ sortArrow(sort, 'name') }}</span>
          </button>
          <span class="data-th">Category</span>
          <span class="data-th">Method</span>
          <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
            Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
          </button>
        </div>
        <div v-for="{ drink: d, depth } in shown" :key="d.id" class="data-item" :class="{ open: openId === d.id }">
          <button class="data-row" type="button" :aria-expanded="selection.selecting ? undefined : openId === d.id" :aria-pressed="selection.selecting ? selection.has(d.id) : undefined" @click="selection.selecting ? selection.toggle(d.id) : toggle(d.id)">
            <span class="data-td primary" :style="{ paddingLeft: nested ? `calc(${depth} * var(--space-4))` : undefined }"><span v-if="selection.selecting" class="tick" aria-hidden="true">{{ selection.has(d.id) ? '☑' : '☐' }}</span>
              {{ d.name }}<span v-if="d.archivedAt" class="muted"> (archived)</span>
              <span v-if="!nested && d.parent" class="variant-of">variant of {{ d.parent.name }}</span>
            </span>
            <span class="data-td">{{ d.category?.name ?? 'Uncategorised' }}</span>
            <span class="data-td">{{ METHOD_KINDS[d.kind].label }}</span>
            <span class="data-td end">{{ formatAdded(d.createdAt) }}</span>
          </button>
          <div v-if="openId === d.id" class="data-details">
            <div class="badges">
              <span v-if="defaultSize(d)" class="badge">{{ formatSize(defaultSize(d)!) }}</span>
              <span v-if="nested && d.parent" class="muted small">Variant of {{ d.parent.name }}</span>
            </div>
            <p v-if="d.description" class="muted">{{ d.description }}</p>
            <p class="facts">
              <span class="label">Recipe</span>
              {{ recipeName(d.defaultRecipeId) ?? `Any ${METHOD_KINDS[d.kind].label.toLowerCase()} recipe, on any ${METHOD_KINDS[d.kind].label.toLowerCase()} brewer` }}
            </p>
            <p class="facts">
              <span class="label">Finish with</span>
              {{ d.ingredients.length ? d.ingredients.map((c) => ingredientLine(c)).join(' · ') : 'Nothing: just the coffee' }}
            </p>
            <p v-if="d.instructions" class="instructions"><span class="label">Instructions</span> {{ d.instructions }}</p>
            <div v-if="workspaces.canEdit" class="data-actions">
              <RouterLink class="btn-link" :to="{ name: 'drink-new', query: { from: d.id } }">Make a variant</RouterLink>
              <RouterLink class="btn-link" :to="{ name: 'drink-edit', params: { id: d.id } }">Edit</RouterLink>
              <button v-if="d.archivedAt" class="btn-link" type="button" :disabled="busyId === d.id" @click="setArchived(d, false)">Restore</button>
              <button v-else class="btn-link" type="button" :disabled="busyId === d.id" @click="setArchived(d, true)">Archive</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Categories group drinks on the brew page, after the brew methods, in this order (docs/api/drink-categories.md §5d). -->
    <div v-if="!loading && !error" id="categories" class="categories">
      <DrinkCategoriesPanel :categories="categories" @changed="load" />
      <p class="muted small">
        Drinks are grouped by these under "What are you making?" when brewing, after the brew methods. Choose a drink's category when you edit
        it; deleting a category leaves its drinks uncategorised.
      </p>
    </div>
  </main>
</template>

<style scoped>
.categories {
  margin-top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  scroll-margin-top: var(--space-4);
}
.categories p {
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
.instructions {
  white-space: pre-line;
}
.variant-of {
  margin-left: var(--space-1);
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-muted);
}
.badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.badges:empty {
  display: none;
}
.label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-right: var(--space-1);
}
.muted-badge {
  background: var(--bg);
  color: var(--text-muted);
}
</style>

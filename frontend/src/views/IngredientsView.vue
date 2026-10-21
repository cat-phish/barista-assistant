<script setup lang="ts">
// Ingredients (docs/api/ingredients.md §5b): reusable preps that finish drinks, as a
// table like Recipes: filter by type (or the unused ones), sort by name, type,
// how many drinks use it, or date added; a row expands to its instructions,
// the drinks it's in and the units they measure it in. Adding and editing
// happen on their own page (IngredientFormView). Deleting is refused while
// drinks use one.
import { computed, onMounted, ref, watch } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { drinksApi } from '../api/drinks';
import { ingredientsApi } from '../api/ingredients';
import type { Drink, Ingredient, IngredientType } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ListControls from '../components/ListControls.vue';
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
  sortOptions,
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
const sortChoices = sortOptions(columns);
const filter = ref(ALL);
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
  const kept = f === ALL ? list.value : f === UNUSED ? list.value.filter((i) => i.drinkCount === 0) : list.value.filter((i) => i.ingredientType === f);
  return sortBy(kept, sort.value, columns);
});
const usage = computed(() => ingredientUsage(drinks.value));
const usedLabel = (n: number) => (n === 0 ? 'Not used' : `${n} drink${n === 1 ? '' : 's'}`);

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

// Delete
const busy = ref(false);
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
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'ingredient-new' }">Add ingredient</RouterLink>
    </div>
    <MenuTabs />
    <p class="muted intro">What finishes a drink besides the coffee: milk, foam, syrup, ice…</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading ingredients…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-else>
      <div v-if="list.length === 0" class="card empty"><p>No ingredients yet.</p></div>
      <template v-else>
        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-options="sortChoices" id-prefix="ingredients" filter-label="Show" :filter-options="filterOptions" />
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
            <button class="data-row" type="button" :aria-expanded="openId === c.id" @click="toggle(c.id)">
              <span class="data-td primary">{{ c.name }}</span>
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
                <button class="btn-link danger" type="button" @click="pending = c; dialogError = ''">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </template>
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

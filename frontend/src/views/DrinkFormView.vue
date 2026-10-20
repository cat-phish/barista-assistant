<script setup lang="ts">
// Drink editor (docs/api_spec.md §5c): name, description, the brew method it's
// built on (any of its recipes can make it; one can be the default), category,
// what it's a variant of, the components that finish it, and the menu switch.
// /drinks/new?from=<id> starts a variant: a copy of that drink, linked to it.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { componentsApi } from '../api/components';
import { drinkCategoriesApi } from '../api/drinkCategories';
import { drinksApi, type DrinkInput } from '../api/drinks';
import { brewMethodsApi, recipesApi } from '../api/recipes';
import type { BrewMethod, Component, Drink, DrinkCategory, Recipe, ServingUnit } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { nestDrinks, selfAndDescendants } from '../lib/drinks';
import { parseDecimal } from '../lib/format';
import { knownUnits, SERVING_UNITS } from '../lib/servings';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const NEW_CATEGORY = '__new';
const methods = ref<BrewMethod[]>([]);
const recipes = ref<Recipe[]>([]);
const components = ref<Component[]>([]);
const categories = ref<DrinkCategory[]>([]);
const drinks = ref<Drink[]>([]);
const current = ref<Drink | null>(null); // the drink being edited
const name = ref('');
const description = ref('');
const methodId = ref('');
const categoryId = ref('');
const newCategory = ref('');
const parentDrinkId = ref('');
const showOnPublicMenu = ref(true);
const defaultRecipeId = ref('');
// Default size: amounts below are for it, and brewing scales from it.
const servingSize = ref('');
const servingUnit = ref<ServingUnit>('fl_oz');
const rows = ref<Array<{ componentId: string; amountValue: string; amountUnit: string; note: string }>>([]);
// Unit suggestions: fl oz, ml, g, then whatever's been typed before.
const units = computed(() => knownUnits(drinks.value));
const parsedSize = computed(() => (servingSize.value.trim() ? parseDecimal(servingSize.value, { scale: 1, min: 0, max: 2000, exclusiveMin: true }) : null));
const parsedAmounts = computed(() =>
  rows.value.map((r) => (r.amountValue.trim() ? parseDecimal(r.amountValue, { scale: 2, min: 0, max: 100000, exclusiveMin: true }) : null)),
);

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const submitted = ref(false);

// Only the method's recipes can make it.
const methodRecipes = computed(() => recipes.value.filter((r) => r.method.id === methodId.value));
watch(methodId, () => {
  if (!methodRecipes.value.some((r) => r.id === defaultRecipeId.value)) defaultRecipeId.value = '';
});
// Possible parents: any drink but this one and its own variants, nested.
const parentOptions = computed(() => {
  const excluded = props.id ? selfAndDescendants(drinks.value, props.id) : new Set<string>();
  return nestDrinks(drinks.value.filter((d) => !excluded.has(d.id)));
});

const errors = computed(() => ({
  name: name.value.trim() ? '' : 'Required',
  method: methodId.value ? '' : 'Choose a brew method',
  category: categoryId.value === NEW_CATEGORY && !newCategory.value.trim() ? 'Name the new category' : '',
  size: parsedSize.value && !parsedSize.value.ok ? parsedSize.value.error : '',
  rows: rows.value.map((r, i) => {
    if (!r.componentId) return 'Choose a component';
    if (rows.value.findIndex((x) => x.componentId === r.componentId) !== i) return 'Already listed';
    const amount = parsedAmounts.value[i];
    return amount && !amount.ok ? `Amount: ${amount.error}` : '';
  }),
}));
const valid = computed(
  () => !errors.value.name && !errors.value.method && !errors.value.category && !errors.value.size && errors.value.rows.every((e) => !e),
);

function fill(drink: Drink): void {
  name.value = drink.name;
  description.value = drink.description ?? '';
  methodId.value = drink.method.id;
  categoryId.value = drink.category?.id ?? '';
  parentDrinkId.value = drink.parent?.id ?? '';
  showOnPublicMenu.value = drink.showOnPublicMenu;
  defaultRecipeId.value = drink.defaultRecipeId ?? '';
  servingSize.value = drink.servingSize === null ? '' : String(drink.servingSize);
  servingUnit.value = drink.servingUnit ?? 'fl_oz';
  rows.value = drink.components.map((x) => ({
    componentId: x.componentId,
    amountValue: x.amountValue === null ? '' : String(x.amountValue),
    amountUnit: x.amountUnit ?? '',
    note: x.note ?? '',
  }));
}

// Components not already used by another row (plus this row's own).
function componentOptions(index: number): Component[] {
  const used = new Set(rows.value.filter((_, i) => i !== index).map((r) => r.componentId));
  return components.value.filter((c) => !used.has(c.id));
}
function addRow(): void {
  const next = componentOptions(-1)[0];
  rows.value.push({ componentId: next?.id ?? '', amountValue: '', amountUnit: '', note: '' });
}
function moveRow(index: number, delta: -1 | 1): void {
  const to = index + delta;
  if (to < 0 || to >= rows.value.length) return;
  const next = [...rows.value];
  [next[index], next[to]] = [next[to]!, next[index]!];
  rows.value = next;
}

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [m, r, c, cats, d] = await Promise.all([
      brewMethodsApi.list(ws),
      recipesApi.list(ws),
      componentsApi.list(ws),
      drinkCategoriesApi.list(ws),
      drinksApi.list(ws),
    ]);
    methods.value = m.brewMethods;
    recipes.value = r.recipes;
    components.value = c.components;
    categories.value = cats.categories;
    drinks.value = d.drinks;
    if (editing.value) {
      const drink = drinks.value.find((x) => x.id === props.id);
      if (!drink) {
        error.value = 'This drink no longer exists.';
        return;
      }
      current.value = drink;
      fill(drink);
      return;
    }
    // A variant starts as a copy of its parent.
    const from = drinks.value.find((x) => x.id === route.query.from);
    if (from) {
      fill(from);
      name.value = `${from.name} variant`;
      parentDrinkId.value = from.id;
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

// A new category is created first, then used.
async function resolveCategory(ws: string): Promise<string | null> {
  if (categoryId.value !== NEW_CATEGORY) return categoryId.value || null;
  const { category } = await drinkCategoriesApi.create(ws, newCategory.value.trim());
  categories.value = [...categories.value, category];
  categoryId.value = category.id;
  newCategory.value = '';
  return category.id;
}

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!ws || !valid.value) return;
  saving.value = true;
  error.value = '';
  try {
    const input: DrinkInput = {
      name: name.value.trim(),
      description: description.value.trim() || null,
      methodId: methodId.value,
      categoryId: await resolveCategory(ws),
      parentDrinkId: parentDrinkId.value || null,
      showOnPublicMenu: showOnPublicMenu.value,
      defaultRecipeId: defaultRecipeId.value || null,
      servingSize: parsedSize.value?.ok ? parsedSize.value.value : null,
      servingUnit: parsedSize.value?.ok ? servingUnit.value : null,
      components: rows.value.map((r, i) => {
        const amount = parsedAmounts.value[i];
        return {
          componentId: r.componentId,
          amountValue: amount?.ok ? amount.value : null,
          amountUnit: r.amountUnit.trim() || null,
          note: r.note.trim() || null,
        };
      }),
    };
    if (props.id) await drinksApi.update(ws, props.id, input);
    else await drinksApi.create(ws, input);
    await router.push({ name: 'drinks' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A category with that name already exists. Choose it from the list.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit drink' : parentDrinkId && !editing ? 'Add variant' : 'Add drink' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="name" maxlength="255" placeholder="e.g. Vanilla Latte" :aria-invalid="submitted && !!errors.name" />
          <span v-if="submitted && errors.name" class="field-error">{{ errors.name }}</span>
        </div>
        <div class="field">
          <label for="description">Description <span class="muted">(optional, shown on the menu)</span></label>
          <input id="description" v-model="description" maxlength="500" placeholder="e.g. Espresso, steamed milk and house vanilla" />
        </div>
        <div class="field">
          <label for="category">Category <span class="muted">(optional)</span></label>
          <select id="category" v-model="categoryId">
            <option value="">None</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            <option :value="NEW_CATEGORY">+ New category…</option>
          </select>
          <input
            v-if="categoryId === NEW_CATEGORY"
            v-model="newCategory"
            aria-label="New category name"
            maxlength="100"
            placeholder="e.g. Espresso milk drinks"
            :aria-invalid="submitted && !!errors.category"
          />
          <span v-if="submitted && errors.category" class="field-error">{{ errors.category }}</span>
          <span class="hint">Groups drinks on the menu and when you brew. Order categories on the Drinks page.</span>
        </div>
        <div class="field">
          <label for="parent">Variant of <span class="muted">(optional)</span></label>
          <select id="parent" v-model="parentDrinkId">
            <option value="">Nothing: an original</option>
            <option v-for="o in parentOptions" :key="o.drink.id" :value="o.drink.id">{{ '\u2003'.repeat(o.depth) }}{{ o.drink.name }}</option>
          </select>
          <span class="hint">A riff on another drink, e.g. Vanilla Latte on Latte. It's listed under that drink.</span>
        </div>
        <p v-if="current?.variants.length" class="muted small">
          Variants:
          <template v-for="(v, i) in current.variants" :key="v.id"
            ><template v-if="i">, </template><RouterLink :to="{ name: 'drink-edit', params: { id: v.id } }">{{ v.name }}</RouterLink></template
          >
        </p>
        <label class="checkbox">
          <input v-model="showOnPublicMenu" type="checkbox" />
          Show on the public menu
        </label>
      </section>

      <section class="card stack" aria-labelledby="brew-heading">
        <div>
          <h2 id="brew-heading">Brewed with</h2>
          <p class="muted small">Any recipe of the method can make it; the default is picked for you when you brew.</p>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="method">Brew method</label>
            <select id="method" v-model="methodId" :aria-invalid="submitted && !!errors.method">
              <option value="" disabled>Choose…</option>
              <option v-for="m in methods" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
            <span v-if="submitted && errors.method" class="field-error">{{ errors.method }}</span>
          </div>
          <div class="field">
            <label for="default-recipe">Default recipe <span class="muted">(optional)</span></label>
            <select id="default-recipe" v-model="defaultRecipeId" :disabled="!methodRecipes.length">
              <option value="">{{ methodRecipes.length ? 'None: the last one used' : 'No recipes for this method yet' }}</option>
              <option v-for="r in methodRecipes" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="size">Default size <span class="muted">(optional)</span></label>
          <div class="size">
            <input id="size" v-model="servingSize" inputmode="decimal" placeholder="e.g. 8" :aria-invalid="submitted && !!errors.size" />
            <select v-model="servingUnit" aria-label="Size unit">
              <option v-for="(label, key) in SERVING_UNITS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <span v-if="submitted && errors.size" class="field-error">{{ errors.size }}</span>
          <span class="hint">Component amounts are for this size. When you brew a bigger or smaller one, they scale (and a filter batch too).</span>
        </div>
      </section>

      <section class="card stack" aria-labelledby="components-heading">
        <div>
          <h2 id="components-heading">Finish with</h2>
          <p class="muted small">Components, in order, with amounts for the default size. Leave this empty for just the coffee.</p>
        </div>
        <p v-if="components.length === 0" class="muted small">
          No components yet. <RouterLink :to="{ name: 'components' }">Add some</RouterLink> (milk, foam, syrup…) to use them here.
        </p>
        <datalist id="amount-units">
          <option v-for="u in units" :key="u" :value="u" />
        </datalist>
        <ol v-if="rows.length" class="rows">
          <li v-for="(row, i) in rows" :key="i" class="row">
            <div class="row-fields">
              <div class="field full">
                <label :for="`component-${i}`">Component</label>
                <select :id="`component-${i}`" v-model="row.componentId">
                  <option value="" disabled>Choose…</option>
                  <option v-for="c in componentOptions(i)" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div class="field">
                <label :for="`amount-${i}`">Amount <span class="muted">(opt.)</span></label>
                <div class="amount">
                  <input :id="`amount-${i}`" v-model="row.amountValue" inputmode="decimal" placeholder="e.g. 2" />
                  <input v-model="row.amountUnit" list="amount-units" maxlength="20" placeholder="unit" :aria-label="`Unit for component ${i + 1}`" />
                </div>
              </div>
              <div class="field">
                <label :for="`note-${i}`">Note <span class="muted">(opt.)</span></label>
                <input :id="`note-${i}`" v-model="row.note" maxlength="255" placeholder="e.g. on top" />
              </div>
              <span v-if="submitted && errors.rows[i]" class="field-error full">{{ errors.rows[i] }}</span>
            </div>
            <div class="row-actions">
              <button class="btn-link" type="button" :disabled="i === 0" :aria-label="`Move component ${i + 1} up`" @click="moveRow(i, -1)">↑</button>
              <button class="btn-link" type="button" :disabled="i === rows.length - 1" :aria-label="`Move component ${i + 1} down`" @click="moveRow(i, 1)">↓</button>
              <button class="btn-link danger" type="button" :aria-label="`Remove component ${i + 1}`" @click="rows.splice(i, 1)">✕</button>
            </div>
          </li>
        </ol>
        <button v-if="components.length" class="btn btn-secondary" type="button" :disabled="rows.length >= components.length || rows.length >= 20" @click="addRow">
          Add component
        </button>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !valid" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'drinks' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save drink' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
p {
  margin: 0;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px dashed var(--border);
}
.row-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
.full {
  grid-column: 1 / -1;
}
.size,
.amount {
  display: flex;
  gap: var(--space-2);
}
.size input {
  flex: 1;
}
.amount input {
  min-width: 0;
  flex: 1;
}
.size select {
  width: auto;
}
.row-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

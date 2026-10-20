<script setup lang="ts">
// Drink editor (docs/api_spec.md §5c): name, description, which recipes can
// make it (one default), the components that finish it, and the menu switch.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../api/client';
import { componentsApi } from '../api/components';
import { drinksApi, type DrinkInput } from '../api/drinks';
import { recipesApi } from '../api/recipes';
import type { Component, Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const recipes = ref<Recipe[]>([]);
const components = ref<Component[]>([]);
const name = ref('');
const description = ref('');
const category = ref('');
const categories = ref<string[]>([]); // suggestions: the ones in use
const showOnPublicMenu = ref(true);
const recipeIds = ref<string[]>([]);
const defaultRecipeId = ref('');
const rows = ref<Array<{ componentId: string; amount: string; note: string }>>([]);

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const submitted = ref(false);

const errors = computed(() => ({
  name: name.value.trim() ? '' : 'Required',
  recipes: recipeIds.value.length ? '' : 'Choose at least one recipe',
  rows: rows.value.map((r, i) => (!r.componentId ? 'Choose a component' : rows.value.findIndex((x) => x.componentId === r.componentId) !== i ? 'Already listed' : '')),
}));
const valid = computed(() => !errors.value.name && !errors.value.recipes && errors.value.rows.every((e) => !e));

// Keep the default one of the chosen recipes.
function toggleRecipe(id: string, on: boolean): void {
  recipeIds.value = on ? [...recipeIds.value, id] : recipeIds.value.filter((x) => x !== id);
  if (!recipeIds.value.includes(defaultRecipeId.value)) defaultRecipeId.value = recipeIds.value[0] ?? '';
}

// Components not already used by another row (plus this row's own).
function componentOptions(index: number): Component[] {
  const used = new Set(rows.value.filter((_, i) => i !== index).map((r) => r.componentId));
  return components.value.filter((c) => !used.has(c.id));
}
function addRow(): void {
  const next = componentOptions(-1)[0];
  rows.value.push({ componentId: next?.id ?? '', amount: '', note: '' });
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
    const [r, c, cats, d] = await Promise.all([
      recipesApi.list(ws),
      componentsApi.list(ws),
      drinksApi.categories(ws),
      editing.value ? drinksApi.list(ws) : Promise.resolve(null),
    ]);
    recipes.value = r.recipes;
    components.value = c.components;
    categories.value = cats.categories;
    if (!editing.value) return;
    const drink = d?.drinks.find((x) => x.id === props.id);
    if (!drink) {
      error.value = 'This drink no longer exists.';
      return;
    }
    name.value = drink.name;
    description.value = drink.description ?? '';
    category.value = drink.category ?? '';
    showOnPublicMenu.value = drink.showOnPublicMenu;
    recipeIds.value = drink.recipes.map((x) => x.id);
    defaultRecipeId.value = drink.defaultRecipeId ?? recipeIds.value[0] ?? '';
    rows.value = drink.components.map((x) => ({ componentId: x.componentId, amount: x.amount ?? '', note: x.note ?? '' }));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!ws || !valid.value) return;
  const input: DrinkInput = {
    name: name.value.trim(),
    description: description.value.trim() || null,
    category: category.value.trim() || null,
    showOnPublicMenu: showOnPublicMenu.value,
    recipeIds: recipeIds.value,
    defaultRecipeId: defaultRecipeId.value || null,
    components: rows.value.map((r) => ({ componentId: r.componentId, amount: r.amount.trim() || null, note: r.note.trim() || null })),
  };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await drinksApi.update(ws, props.id, input);
    else await drinksApi.create(ws, input);
    await router.push({ name: 'drinks' });
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit drink' : 'Add drink' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="name" maxlength="255" placeholder="e.g. The Atlas" :aria-invalid="submitted && !!errors.name" />
          <span v-if="submitted && errors.name" class="field-error">{{ errors.name }}</span>
        </div>
        <div class="field">
          <label for="description">Description <span class="muted">(optional, shown on the menu)</span></label>
          <input id="description" v-model="description" maxlength="500" placeholder="e.g. V60 with orange-infused cold foam" />
        </div>
        <div class="field">
          <label for="category">Category <span class="muted">(optional)</span></label>
          <input id="category" v-model="category" list="drink-categories" maxlength="100" placeholder="e.g. Espresso milk drinks" />
          <datalist id="drink-categories">
            <option v-for="c in categories" :key="c" :value="c" />
          </datalist>
          <span class="hint">Groups drinks when you brew and on the menu.</span>
        </div>
        <label class="checkbox">
          <input v-model="showOnPublicMenu" type="checkbox" />
          Show on the public menu
        </label>
      </section>

      <section class="card stack" aria-labelledby="recipes-heading">
        <div>
          <h2 id="recipes-heading">Recipes</h2>
          <p class="muted small">Any of these can make it; the default is picked for you when you brew.</p>
        </div>
        <p v-if="recipes.length === 0" class="muted">
          No recipes yet. <RouterLink :to="{ name: 'recipe-new' }">Add one</RouterLink> first.
        </p>
        <ul v-else class="choices">
          <li v-for="r in recipes" :key="r.id" class="choice">
            <label class="checkbox">
              <input type="checkbox" :checked="recipeIds.includes(r.id)" @change="toggleRecipe(r.id, ($event.target as HTMLInputElement).checked)" />
              <span>{{ r.name }} <span class="muted">({{ r.method.name }})</span></span>
            </label>
            <label v-if="recipeIds.includes(r.id) && recipeIds.length > 1" class="default">
              <input v-model="defaultRecipeId" type="radio" name="default-recipe" :value="r.id" />
              Default
            </label>
          </li>
        </ul>
        <span v-if="submitted && errors.recipes" class="field-error">{{ errors.recipes }}</span>
      </section>

      <section class="card stack" aria-labelledby="components-heading">
        <div>
          <h2 id="components-heading">Finish with</h2>
          <p class="muted small">Components, in order. Leave this empty for just the coffee.</p>
        </div>
        <p v-if="components.length === 0" class="muted small">
          No components yet. <RouterLink :to="{ name: 'components' }">Add some</RouterLink> (milk, foam, syrup…) to use them here.
        </p>
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
                <input :id="`amount-${i}`" v-model="row.amount" maxlength="50" placeholder="e.g. 40 g" />
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
.choices,
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.choice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.default {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 0.85rem;
  color: var(--text-muted);
  flex-shrink: 0;
  min-height: var(--tap);
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

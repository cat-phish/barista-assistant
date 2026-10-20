<script setup lang="ts">
// Drinks (docs/api_spec.md §5c, §5d): what's served. Each is built on a brew
// method; variants (Vanilla Latte of Latte) sit under their parent, and
// drinks are grouped by the managed categories.
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import { drinksApi } from '../api/drinks';
import { recipesApi } from '../api/recipes';
import type { Drink, DrinkCategory, Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DrinkCategoriesPanel from '../components/DrinkCategoriesPanel.vue';
import MenuTabs from '../components/MenuTabs.vue';
import { componentLine, drinkSections } from '../lib/drinks';
import { defaultSize, formatSize } from '../lib/servings';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const drinks = ref<Drink[]>([]);
const categories = ref<DrinkCategory[]>([]);
const recipes = ref<Recipe[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [d, c, r] = await Promise.all([drinksApi.list(ws), drinkCategoriesApi.list(ws), recipesApi.list(ws)]);
    drinks.value = d.drinks;
    categories.value = c.categories;
    recipes.value = r.recipes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const sections = computed(() => drinkSections(drinks.value, categories.value));
const recipeName = (id: string | null) => recipes.value.find((r) => r.id === id)?.name ?? null;

const pending = ref<Drink | null>(null);
const busy = ref(false);
const dialogError = ref('');
const pendingName = computed(() => pending.value?.name ?? '');
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !pending.value) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await drinksApi.remove(ws, pending.value.id);
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
      <h1>Drinks</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'drink-new' }">Add drink</RouterLink>
    </div>
    <MenuTabs />
    <p class="muted intro">
      A drink is built on a brew method, brewed with any of its recipes and finished with components. Plain brews like "V60" are the methods
      themselves: put them on the menu under Equipment → Methods.
    </p>

    <p v-if="loading" class="muted" aria-live="polite">Loading drinks…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <div v-else-if="drinks.length === 0" class="card empty">
      <p>No drinks yet.</p>
      <p v-if="workspaces.canEdit">Start with a classic like "Latte" (Espresso + steamed milk), then make variants of it.</p>
    </div>

    <section v-for="s in sections" v-else :key="s.category?.id ?? ''" class="stack section">
      <h2 v-if="s.category || sections.length > 1" class="section-title">{{ s.category?.name ?? 'Other drinks' }}</h2>
      <ul class="list">
        <li v-for="{ drink: d, depth } in s.drinks" :key="d.id" class="card drink" :class="{ variant: depth > 0 }" :style="{ '--depth': depth }">
          <div class="head">
            <h2>{{ d.name }}</h2>
            <span class="badge">{{ d.method.name }}</span>
            <span v-if="defaultSize(d)" class="badge">{{ formatSize(defaultSize(d)!) }}</span>
            <span v-if="!d.showOnPublicMenu" class="badge muted-badge">Hidden from menu</span>
          </div>
          <p v-if="d.parent" class="muted small">Variant of {{ d.parent.name }}</p>
          <p v-if="d.description" class="muted">{{ d.description }}</p>
          <p class="facts">
            <span class="label">Recipe</span>
            {{ recipeName(d.defaultRecipeId) ?? `Any ${d.method.name} recipe` }}
          </p>
          <p class="facts">
            <span class="label">Finish with</span>
            {{ d.components.length ? d.components.map((c) => componentLine(c)).join(' · ') : 'Nothing: just the coffee' }}
          </p>
          <div v-if="workspaces.canEdit" class="actions">
            <RouterLink class="btn-link" :to="{ name: 'drink-new', query: { from: d.id } }">Make a variant</RouterLink>
            <RouterLink class="btn-link" :to="{ name: 'drink-edit', params: { id: d.id } }">Edit</RouterLink>
            <button class="btn-link danger" type="button" @click="pending = d; dialogError = ''">Delete</button>
          </div>
        </li>
      </ul>
    </section>

    <DrinkCategoriesPanel v-if="!loading && !error" :categories="categories" @changed="load" />
  </main>

  <ConfirmDialog :open="pending !== null" title="Delete this drink?" @cancel="pending = null">
    <p>
      {{ pendingName }} will be removed. Brews made for it are kept.
      <template v-if="pending?.variants.length">Its variants move up to {{ pending.parent ? pending.parent.name : 'the top level' }}.</template>
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
  margin: 0;
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.section-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
.drink {
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
.label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-right: var(--space-1);
}
.small {
  font-size: 0.85rem;
}
.variant {
  margin-left: calc(var(--depth) * var(--space-4));
  border-left: 3px solid var(--border);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin: 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
</style>

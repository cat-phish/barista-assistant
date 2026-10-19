<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { recipesApi } from '../api/recipes';
import type { Recipe } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { formatGrams, formatRatio, formatTime } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const recipes = ref<Recipe[]>([]);
const loading = ref(true);
const error = ref('');
const pending = ref<Recipe | null>(null);
const busy = ref(false);
const dialogError = ref('');

async function load(): Promise<void> {
  const id = workspaces.current?.id;
  if (!id) return;
  try {
    recipes.value = (await recipesApi.list(id)).recipes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function stepsSummary(recipe: Recipe): string | null {
  const last = recipe.steps[recipe.steps.length - 1];
  if (!last) return null;
  return `${recipe.steps.length} step${recipe.steps.length === 1 ? '' : 's'} · ${formatTime(last.targetTimeSec)}`;
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

    <p v-if="loading" class="muted" aria-live="polite">Loading recipes…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="recipes.length === 0" class="card empty">
      <p>No recipes yet.</p>
      <p v-if="workspaces.canEdit">Add your go-to recipe, with its pours, to use the brew timer.</p>
    </div>

    <ul v-else class="list">
      <li v-for="recipe in recipes" :key="recipe.id" class="card recipe">
        <div class="head">
          <div>
            <h2>{{ recipe.name }}</h2>
            <span class="badge">{{ recipe.method.name }}</span>
          </div>
          <span v-if="!recipe.showOnPublicMenu" class="badge muted-badge">Hidden from menu</span>
        </div>
        <p class="facts">
          <span>
            {{ formatGrams(recipe.targetDoseGrams) }} g → {{ formatGrams(recipe.targetYieldGrams) }} g
            <span class="muted">({{ formatRatio(recipe.targetDoseGrams, recipe.targetYieldGrams) }})</span>
          </span>
          <span v-if="recipe.targetTempC !== null">{{ recipe.targetTempC }} °C</span>
          <span v-if="recipe.targetGrindSetting">Grind {{ recipe.targetGrindSetting }}</span>
          <span v-if="stepsSummary(recipe)">{{ stepsSummary(recipe) }}</span>
        </p>
        <div v-if="workspaces.canEdit" class="actions">
          <RouterLink class="btn-link" :to="{ name: 'recipe-edit', params: { id: recipe.id } }">Edit</RouterLink>
          <button class="btn-link danger" type="button" @click="pending = recipe; dialogError = ''">Delete</button>
        </div>
      </li>
    </ul>
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
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.recipe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
.head > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
h2 {
  font-size: 1.1rem;
}
p {
  margin: 0;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 0.95rem;
}
.muted-badge {
  background: var(--bg);
  color: var(--text-muted);
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
</style>

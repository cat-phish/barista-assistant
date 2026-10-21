<script setup lang="ts">
// Brewer editor (docs/api/brewers.md §3), a page of its own like recipes: add a
// brewer, or edit one (route param).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { brewersApi } from '../api/brewers';
import { ApiError, errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import type { DrinkCategory } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import BrewerFields from '../components/BrewerFields.vue';
import { brewerForm, brewerInput } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const form = ref(brewerForm());
const categories = ref<DrinkCategory[]>([]);
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

// 409s: a taken name, or recipes that pin the kind.
function conflict(err: unknown): string {
  if (!(err instanceof ApiError) || err.status !== 409) return errorMessage(err);
  const count = err.body?.recipeCount;
  if (typeof count === 'number') {
    return `${count} recipe${count === 1 ? ' uses' : 's use'} this brewer, so its kind can't change: their fields depend on it. Add a new brewer instead.`;
  }
  return 'A brewer with that name already exists.';
}

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [c, b] = await Promise.all([drinkCategoriesApi.list(ws), editing.value ? brewersApi.list(ws) : Promise.resolve(null)]);
    categories.value = c.categories;
    if (editing.value) {
      const brewer = b?.brewers.find((x) => x.id === props.id);
      if (!brewer) {
        error.value = 'This brewer no longer exists.';
        return;
      }
      form.value = brewerForm(brewer);
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!ws || !form.value.name.trim()) return;
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await brewersApi.update(ws, props.id, brewerInput(form.value));
    else await brewersApi.create(ws, brewerInput(form.value));
    await router.push({ name: 'brewers' });
  } catch (err) {
    error.value = conflict(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit brewer' : 'Add brewer' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <BrewerFields v-model="form" id-prefix="brewer" :show-errors="submitted" :categories="categories" />
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'brewers' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save brewer' : 'Add brewer' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

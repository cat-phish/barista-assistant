<script setup lang="ts">
// Ingredient editor (docs/api/ingredients.md §5b), a page of its own like recipes:
// add an ingredient, or edit one (route param).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { ingredientsApi } from '../api/ingredients';
import type { IngredientType } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { INGREDIENT_TYPES } from '../lib/drinks';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => ingredientsApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => ingredientsApi.remove(workspaces.current?.id ?? '', props.id ?? '');
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const name = ref('');
const ingredientType = ref<IngredientType>('other');
const instructions = ref('');
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    if (editing.value) {
      const ingredient = (await ingredientsApi.list(ws)).ingredients.find((x) => x.id === props.id);
      if (!ingredient) {
        error.value = 'This ingredient no longer exists.';
        return;
      }
      saved.value = { name: ingredient.name, archived: !!ingredient.archivedAt };
      name.value = ingredient.name;
      ingredientType.value = ingredient.ingredientType;
      instructions.value = ingredient.instructions ?? '';
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
  if (!ws || !name.value.trim()) return;
  const input = { name: name.value.trim(), ingredientType: ingredientType.value, instructions: instructions.value.trim() || null };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await ingredientsApi.update(ws, props.id, input);
    else await ingredientsApi.create(ws, input);
    await router.push({ name: 'ingredients' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'An ingredient with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit ingredient' : 'Add ingredient' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="form-row">
          <div class="field">
            <label for="ingredient-name">Name<span class="req" aria-hidden="true">*</span></label>
            <input id="ingredient-name" aria-required="true" v-model="name" maxlength="100" placeholder="e.g. Orange cold foam" :aria-invalid="submitted && !name.trim()" />
            <span v-if="submitted && !name.trim()" class="field-error">Required</span>
          </div>
          <div class="field">
            <label for="ingredient-type">Type<span class="req" aria-hidden="true">*</span></label>
            <select id="ingredient-type" aria-required="true" v-model="ingredientType">
              <option v-for="(label, key) in INGREDIENT_TYPES" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="ingredient-instructions">Instructions</label>
          <textarea
            id="ingredient-instructions"
            v-model="instructions"
            rows="5"
            maxlength="5000"
            placeholder="e.g. Steep orange peel in cream overnight, then froth cold."
          />
        </div>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'ingredients' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save ingredient' : 'Add ingredient' }}</button>
      </div>
    </form>
    <DeleteSection
      v-if="props.id && saved && workspaces.canEdit"
      kind="ingredient"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'ingredients' }"
    />
  </main>
</template>

<style scoped>
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

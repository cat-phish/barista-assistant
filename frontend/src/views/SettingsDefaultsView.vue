<script setup lang="ts">
// Settings → Defaults (docs/api/workspaces.md §2 settings): what the whole
// workspace assumes. Owners change them; everyone else sees them.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { RoastLevel, RoastScale, WorkspaceSettings } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { ROAST_LEVELS } from '../lib/scale';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { recipeRoastLevel, roastScale } = usePreferences();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const saving = ref(false);
const error = ref('');
const saved = ref(false);

const SCALES: Array<{ value: RoastScale; label: string; hint: string }> = [
  { value: 'names', label: 'Roast names', hint: 'Cinnamon, City, Full City+ … French. Each implies a level from light to dark.' },
  { value: 'levels', label: 'Light to dark', hint: 'Light, medium-light, medium, medium-dark or dark. Roast names already recorded are kept but not shown.' },
];
const savedWhere = ref<'roast' | 'scale' | null>(null);

async function set(changes: Partial<WorkspaceSettings>, where: 'roast' | 'scale'): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  saving.value = true;
  error.value = '';
  saved.value = false;
  savedWhere.value = where;
  try {
    await workspacesApi.setSettings(ws, changes);
    await workspaces.load();
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Defaults">
    <p class="muted">For everyone in {{ workspaces.current?.name }}.</p>

    <section class="card stack" aria-labelledby="def-roast">
      <h2 id="def-roast">Roast for recipes</h2>
      <div class="field">
        <label for="recipe-roast">Recipes are written for a</label>
        <select v-if="isOwner" id="recipe-roast" :value="recipeRoastLevel" :disabled="saving" @change="set({ recipeRoastLevel: ($event.target as HTMLSelectElement).value as RoastLevel }, 'roast')">
          <option v-for="(r, key) in ROAST_LEVELS" :key="key" :value="key">{{ r.label.toLowerCase() }} roast</option>
        </select>
        <p v-else id="recipe-roast" class="value">{{ ROAST_LEVELS[recipeRoastLevel].label.toLowerCase() }} roast</p>
      </div>
      <p class="muted small">
        A recipe's expected yield is estimated for this roast, and adjusted when you brew a lighter or darker bean (darker grounds hold more
        water). Beans without a roast level are treated as this roast too. Your own measured brews replace the estimate once you have some.
      </p>
      <p v-if="error && savedWhere === 'roast'" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && savedWhere === 'roast'" class="muted small" aria-live="polite">Saved.</p>
    </section>

    <section class="card stack" aria-labelledby="def-scale">
      <h2 id="def-scale">How beans record their roast</h2>
      <fieldset class="choices" :disabled="!isOwner || saving">
        <legend class="visually-hidden">How beans record their roast</legend>
        <label v-for="s in SCALES" :key="s.value" class="choice">
          <input type="radio" name="roast-scale" :value="s.value" :checked="roastScale === s.value" @change="set({ roastScale: s.value }, 'scale')" />
          <span>
            <strong>{{ s.label }}</strong>
            <span class="muted small">{{ s.hint }}</span>
          </span>
        </label>
      </fieldset>
      <p class="muted small">The bean form, the bean list and the guest menu follow this.</p>
      <p v-if="error && savedWhere === 'scale'" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && savedWhere === 'scale'" class="muted small" aria-live="polite">Saved.</p>
    </section>
    <p v-if="!isOwner" class="muted small">Only owners can change these.</p>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.field select {
  max-width: 16rem;
}
.value {
  font-weight: 600;
}
.choices {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.choice {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.choice:has(input:checked) {
  border-color: var(--brand);
  background: var(--brand-tint);
}
.choice input {
  margin-top: 0.3rem;
  accent-color: var(--brand);
}
.choice > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>

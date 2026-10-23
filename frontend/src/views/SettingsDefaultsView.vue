<script setup lang="ts">
// Settings → Defaults (docs/api/workspaces.md §2 settings): what the whole
// workspace assumes. Owners change them; everyone else sees them.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { RoastLevel } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { ROAST_LEVELS } from '../lib/scale';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { recipeRoastLevel } = usePreferences();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const saving = ref(false);
const error = ref('');
const saved = ref(false);

async function setRoast(level: RoastLevel): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    await workspacesApi.setSettings(ws, { recipeRoastLevel: level });
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
        <select v-if="isOwner" id="recipe-roast" :value="recipeRoastLevel" :disabled="saving" @change="setRoast(($event.target as HTMLSelectElement).value as RoastLevel)">
          <option v-for="(r, key) in ROAST_LEVELS" :key="key" :value="key">{{ r.label.toLowerCase() }} roast</option>
        </select>
        <p v-else id="recipe-roast" class="value">{{ ROAST_LEVELS[recipeRoastLevel].label.toLowerCase() }} roast</p>
      </div>
      <p class="muted small">
        A recipe's expected yield is estimated for this roast, and adjusted when you brew a lighter or darker bean (darker grounds hold more
        water). Beans without a roast level are treated as this roast too. Your own measured brews replace the estimate once you have some.
      </p>
      <p v-if="!isOwner" class="muted small">Only owners can change this.</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved" class="muted small" aria-live="polite">Saved.</p>
    </section>
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
</style>

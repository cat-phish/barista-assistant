<script setup lang="ts">
// Settings → Repeat brews (docs/api/auth.md §1 repeatKeeps): what "Brew
// again" and the brew page's repeat buttons copy from the earlier brew.
// Yours only; saved as soon as a box changes.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { RepeatKeep } from '../api/types';
import SettingsLayout from '../components/SettingsLayout.vue';
import { DEFAULT_PREFERENCES, usePreferences } from '../composables/usePreferences';
import { REPEAT_OPTIONS } from '../lib/repeatBrew';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const { prefs } = usePreferences();
const keeps = computed(() => new Set(prefs.value.repeatKeeps));
const saving = ref(false);
const error = ref('');
const saved = ref(false);

async function save(next: RepeatKeep[]): Promise<void> {
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    await auth.setPreferences({ repeatKeeps: next });
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
// Kept in the options' order, so the list reads the same however it's ticked.
function toggle(key: RepeatKeep, on: boolean): Promise<void> {
  return save(REPEAT_OPTIONS.map((o) => o.key).filter((k) => (k === key ? on : keeps.value.has(k))));
}
const isDefault = computed(
  () => [...DEFAULT_PREFERENCES.repeatKeeps].sort().join() === [...prefs.value.repeatKeeps].sort().join(),
);
</script>

<template>
  <SettingsLayout title="Repeat brews">
    <p class="muted">
      What a repeat copies from the brew you pick (Brew again in the journal, or the repeat buttons on the brew page). The bean and what you're
      making, brewer and recipe always come along. Anything left out starts as for a new brew.
    </p>
    <section class="card stack" aria-labelledby="repeat-keeps">
      <h2 id="repeat-keeps">Copy from the earlier brew</h2>
      <fieldset class="keeps" :disabled="saving">
        <legend class="visually-hidden">What a repeat copies</legend>
        <label v-for="o in REPEAT_OPTIONS" :key="o.key" class="checkbox keep">
          <input type="checkbox" :checked="keeps.has(o.key)" @change="toggle(o.key, ($event.target as HTMLInputElement).checked)" />
          <span>
            {{ o.label }}
            <span v-if="o.hint" class="muted small hint">{{ o.hint }}</span>
          </span>
        </label>
      </fieldset>
      <p class="muted small">Results, ratings and notes always start blank for the new brew.</p>
      <button v-if="!isDefault" class="btn-link small reset" type="button" :disabled="saving" @click="save([...DEFAULT_PREFERENCES.repeatKeeps])">
        Back to the defaults
      </button>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="muted small" aria-live="polite">Saved.</p>
    </section>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
  margin: 0;
}
p {
  margin: 0;
}
.keeps {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.keep {
  align-items: flex-start;
}
.keep > span {
  display: flex;
  flex-direction: column;
}
.hint {
  font-weight: 400;
}
.reset {
  align-self: flex-start;
}
</style>

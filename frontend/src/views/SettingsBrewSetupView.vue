<script setup lang="ts">
// Settings → Brew setup: how the brew page fills itself in.
// - Remember from last time (docs/api/auth.md §1 rememberSetup): the choices
//   a new brew starts with, from the last brew on this device.
// - Copy when repeating (§1 repeatKeeps): what "Brew again" and the brew
//   page's repeat buttons copy from the earlier brew.
// Yours only; saved as soon as a box changes.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { RememberKey, RepeatKeep, UserPreferences } from '../api/types';
import SettingsLayout from '../components/SettingsLayout.vue';
import { DEFAULT_PREFERENCES, usePreferences } from '../composables/usePreferences';
import { REMEMBER_OPTIONS } from '../lib/rememberSetup';
import { REPEAT_OPTIONS } from '../lib/repeatBrew';
import { useAuthStore } from '../stores/auth';

type Section = 'remember' | 'repeat';
const auth = useAuthStore();
const { prefs } = usePreferences();
const remembers = computed(() => new Set(prefs.value.rememberSetup));
const keeps = computed(() => new Set(prefs.value.repeatKeeps));
const saving = ref(false);
const error = ref<{ in: Section; text: string } | null>(null);
const saved = ref<Section | null>(null);

async function save(section: Section, patch: Partial<Pick<UserPreferences, 'rememberSetup' | 'repeatKeeps'>>): Promise<void> {
  saving.value = true;
  error.value = null;
  saved.value = null;
  try {
    await auth.setPreferences(patch);
    saved.value = section;
  } catch (err) {
    error.value = { in: section, text: errorMessage(err) };
  } finally {
    saving.value = false;
  }
}
// Kept in the options' order, so the list reads the same however it's ticked.
function toggleRemember(key: RememberKey, on: boolean): Promise<void> {
  return save('remember', { rememberSetup: REMEMBER_OPTIONS.map((o) => o.key).filter((k) => (k === key ? on : remembers.value.has(k))) });
}
function toggleKeep(key: RepeatKeep, on: boolean): Promise<void> {
  return save('repeat', { repeatKeeps: REPEAT_OPTIONS.map((o) => o.key).filter((k) => (k === key ? on : keeps.value.has(k))) });
}
const sameSet = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();
const rememberDefault = computed(() => sameSet(DEFAULT_PREFERENCES.rememberSetup, prefs.value.rememberSetup));
const repeatDefault = computed(() => sameSet(DEFAULT_PREFERENCES.repeatKeeps, prefs.value.repeatKeeps));
</script>

<template>
  <SettingsLayout title="Brew setup">
    <p class="muted">How the brew page fills itself in: from your last brew, or from the brew you repeat.</p>
    <section class="card stack" aria-labelledby="remember-setup">
      <h2 id="remember-setup">Remember from last time</h2>
      <p class="muted small">A new brew starts with what you chose last time on this device. Archived beans, recipes and the like are skipped.</p>
      <fieldset class="keeps" :disabled="saving">
        <legend class="visually-hidden">What the brew page remembers</legend>
        <label v-for="o in REMEMBER_OPTIONS" :key="o.key" class="checkbox keep">
          <input type="checkbox" :checked="remembers.has(o.key)" @change="toggleRemember(o.key, ($event.target as HTMLInputElement).checked)" />
          <span>
            {{ o.label }}
            <span v-if="o.hint" class="muted small hint">{{ o.hint }}</span>
          </span>
        </label>
      </fieldset>
      <button
        v-if="!rememberDefault"
        class="btn-link small reset"
        type="button"
        :disabled="saving"
        @click="save('remember', { rememberSetup: [...DEFAULT_PREFERENCES.rememberSetup] })"
      >
        Back to the defaults
      </button>
      <p v-if="error?.in === 'remember'" class="form-error" role="alert">{{ error.text }}</p>
      <p v-else-if="saved === 'remember'" class="muted small" aria-live="polite">Saved.</p>
    </section>
    <section class="card stack" aria-labelledby="repeat-keeps">
      <h2 id="repeat-keeps">Copy when repeating</h2>
      <p class="muted small">
        What a repeat copies from the brew you pick (Brew again in the journal, or the repeat buttons on the brew page). The bean and what you're
        making, brewer and recipe always come along. Anything left out starts as for a new brew.
      </p>
      <fieldset class="keeps" :disabled="saving">
        <legend class="visually-hidden">What a repeat copies</legend>
        <label v-for="o in REPEAT_OPTIONS" :key="o.key" class="checkbox keep">
          <input type="checkbox" :checked="keeps.has(o.key)" @change="toggleKeep(o.key, ($event.target as HTMLInputElement).checked)" />
          <span>
            {{ o.label }}
            <span v-if="o.hint" class="muted small hint">{{ o.hint }}</span>
          </span>
        </label>
      </fieldset>
      <p class="muted small">Results, ratings and notes always start blank for the new brew.</p>
      <button v-if="!repeatDefault" class="btn-link small reset" type="button" :disabled="saving" @click="save('repeat', { repeatKeeps: [...DEFAULT_PREFERENCES.repeatKeeps] })">
        Back to the defaults
      </button>
      <p v-if="error?.in === 'repeat'" class="form-error" role="alert">{{ error.text }}</p>
      <p v-else-if="saved === 'repeat'" class="muted small" aria-live="polite">Saved.</p>
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

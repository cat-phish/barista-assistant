<script setup lang="ts">
// Settings → Preferences (docs/api/auth.md §1 preferences): your display
// units. Saved as soon as one changes. Stored values never change: grams,
// °C and metres; these only change what you see and type.
import { ref } from 'vue';
import { errorMessage } from '../api/client';
import type { Theme, UserPreferences } from '../api/types';
import { applyTheme } from '../lib/theme';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const { prefs } = usePreferences();
const saving = ref(false);
const error = ref('');
const saved = ref(false);

async function set(changes: Partial<UserPreferences>): Promise<void> {
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    await auth.setPreferences(changes);
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

const choices = {
  volumeUnit: [
    { value: 'fl_oz', label: 'fl oz' },
    { value: 'ml', label: 'ml' },
  ],
  temperatureUnit: [
    { value: 'c', label: '°C' },
    { value: 'f', label: '°F' },
  ],
  altitudeUnit: [
    { value: 'm', label: 'Metres' },
    { value: 'ft', label: 'Feet' },
  ],
  theme: [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ],
} as const;

// The look changes at once (main.ts watches the saved preference); if saving
// fails, it goes back.
async function setTheme(theme: Theme): Promise<void> {
  const before = prefs.value.theme;
  applyTheme(theme);
  await set({ theme });
  if (error.value) applyTheme(before);
}
</script>

<template>
  <SettingsLayout title="Preferences">
    <p class="muted">Just for you: the look of the app and how amounts are shown and typed. Everyone in your workspaces keeps their own.</p>

    <section class="card stack" aria-labelledby="pref-theme">
      <h2 id="pref-theme">Theme</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="pref-theme">
        <label v-for="c in choices.theme" :key="c.value" :class="{ on: prefs.theme === c.value }">
          <input type="radio" name="theme" :value="c.value" :checked="prefs.theme === c.value" :disabled="saving" @change="setTheme(c.value)" />
          {{ c.label }}
        </label>
      </div>
      <p class="muted small">System follows your phone or computer's light or dark setting.</p>
    </section>

    <section class="card stack" aria-labelledby="pref-volume">
      <h2 id="pref-volume">Volume</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="pref-volume">
        <label v-for="c in choices.volumeUnit" :key="c.value" :class="{ on: prefs.volumeUnit === c.value }">
          <input type="radio" name="volume" :value="c.value" :checked="prefs.volumeUnit === c.value" :disabled="saving" @change="set({ volumeUnit: c.value })" />
          {{ c.label }}
        </label>
      </div>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.showBothVolumes" :disabled="saving" @change="set({ showBothVolumes: ($event.target as HTMLInputElement).checked })" />
        Also show {{ prefs.volumeUnit === 'ml' ? 'fl oz' : 'ml' }}
      </label>
      <p class="muted small">The yield estimate on the brew page, and the size a new drink starts with.</p>
    </section>

    <section class="card stack" aria-labelledby="pref-temp">
      <h2 id="pref-temp">Temperature</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="pref-temp">
        <label v-for="c in choices.temperatureUnit" :key="c.value" :class="{ on: prefs.temperatureUnit === c.value }">
          <input type="radio" name="temperature" :value="c.value" :checked="prefs.temperatureUnit === c.value" :disabled="saving" @change="set({ temperatureUnit: c.value })" />
          {{ c.label }}
        </label>
      </div>
      <p class="muted small">Water temperatures in recipes, brews, the timer and AI suggestions.</p>
    </section>

    <section class="card stack" aria-labelledby="pref-altitude">
      <h2 id="pref-altitude">Altitude</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="pref-altitude">
        <label v-for="c in choices.altitudeUnit" :key="c.value" :class="{ on: prefs.altitudeUnit === c.value }">
          <input type="radio" name="altitude" :value="c.value" :checked="prefs.altitudeUnit === c.value" :disabled="saving" @change="set({ altitudeUnit: c.value })" />
          {{ c.label }}
        </label>
      </div>
      <p class="muted small">Where a bean was grown, in the bean form and lists. The guest menu always shows metres.</p>
    </section>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p class="visually-hidden" aria-live="polite">{{ saved ? 'Saved.' : '' }}</p>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.segmented {
  display: inline-flex;
  align-self: flex-start;
  padding: 3px;
  gap: 3px;
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.segmented label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: calc(var(--tap) - 6px);
  min-width: 4.5rem;
  padding: 0 var(--space-3);
  border-radius: calc(var(--radius) - 2px);
  color: var(--brand);
  font-weight: 600;
  cursor: pointer;
}
.segmented label.on {
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.segmented label:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>

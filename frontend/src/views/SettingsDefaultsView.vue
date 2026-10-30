<script setup lang="ts">
// Settings → Defaults (docs/api/workspaces.md §2 settings): what the whole
// workspace assumes. Owners change them; everyone else sees them.
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { MAX_REST_DAYS, type RoastLevel, type RatingStep, type RoastScale, type RoastType, type WorkspaceSettings } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { ROAST_TYPES } from '../lib/beans';
import { parseDecimal } from '../lib/format';
import { ROAST_LEVELS } from '../lib/scale';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { recipeRoastLevel, ratingStep, roastScale, settings } = usePreferences();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const saving = ref(false);
const error = ref('');
const saved = ref(false);

const SCALES: Array<{ value: RoastScale; label: string; hint: string }> = [
  { value: 'names', label: 'Roast names', hint: 'Cinnamon, City, Full City+ … French. Each implies a level from light to dark.' },
  { value: 'levels', label: 'Light to dark', hint: 'Light, medium-light, medium, medium-dark or dark. Roast names already recorded are kept but not shown.' },
];
const STEPS: Array<{ value: RatingStep; label: string; hint: string }> = [
  { value: 'half', label: 'Half stars', hint: 'From ½ to 5 stars: tap the left half of a star for the half below it.' },
  { value: 'whole', label: 'Whole stars', hint: '1 to 5 stars. Half ratings already recorded still show.' },
];
type Where = 'roast' | 'scale' | 'rating' | 'roasting';
const savedWhere = ref<Where | null>(null);

async function set(changes: Partial<WorkspaceSettings>, where: Where): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws) return false;
  saving.value = true;
  error.value = '';
  saved.value = false;
  savedWhere.value = where;
  try {
    await workspacesApi.setSettings(ws, changes);
    await workspaces.load();
    saved.value = true;
    return true;
  } catch (err) {
    error.value = errorMessage(err);
    return false;
  } finally {
    saving.value = false;
  }
}

// Home roasting (docs/api/workspaces.md §2): the switch saves at once; the
// roaster name and rest days with their Save button.
const ROAST_TYPE_KEYS = Object.keys(ROAST_TYPES) as RoastType[];
const roasterName = ref('');
const restDays = ref<Record<RoastType, string>>({ filter: '', espresso: '', omni: '' });
function resetRoasting(): void {
  roasterName.value = settings.value.homeRoasterName;
  restDays.value = Object.fromEntries(ROAST_TYPE_KEYS.map((t) => [t, String(settings.value.restDays[t])])) as Record<RoastType, string>;
}
watch(() => [settings.value.homeRoasterName, settings.value.restDays], resetRoasting, { immediate: true });
const roastingErrors = computed(() => {
  const errors: Partial<Record<RoastType | 'name', string>> = {};
  if (!roasterName.value.trim()) errors.name = 'Required';
  for (const t of ROAST_TYPE_KEYS) {
    const days = parseDecimal(restDays.value[t], { scale: 0, min: 0, max: MAX_REST_DAYS });
    if (!days.ok) errors[t] = days.error;
  }
  return errors;
});
const roastingChanged = computed(
  () => roasterName.value.trim() !== settings.value.homeRoasterName || ROAST_TYPE_KEYS.some((t) => restDays.value[t].trim() !== String(settings.value.restDays[t])),
);
async function saveRoasting(): Promise<void> {
  if (Object.keys(roastingErrors.value).length) return;
  const days = Object.fromEntries(ROAST_TYPE_KEYS.map((t) => [t, Number(restDays.value[t])])) as Record<RoastType, number>;
  await set({ homeRoasterName: roasterName.value.trim(), restDays: days }, 'roasting');
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

    <section class="card stack" aria-labelledby="def-rating">
      <h2 id="def-rating">Ratings</h2>
      <fieldset class="choices" :disabled="!isOwner || saving">
        <legend class="visually-hidden">Ratings</legend>
        <label v-for="s in STEPS" :key="s.value" class="choice">
          <input type="radio" name="rating-step" :value="s.value" :checked="ratingStep === s.value" @change="set({ ratingStep: s.value }, 'rating')" />
          <span>
            <strong>{{ s.label }}</strong>
            <span class="muted small">{{ s.hint }}</span>
          </span>
        </label>
      </fieldset>
      <p class="muted small">How brews and beans are rated.</p>
      <p v-if="error && savedWhere === 'rating'" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && savedWhere === 'rating'" class="muted small" aria-live="polite">Saved.</p>
    </section>
    <section class="card stack" aria-labelledby="def-roasting">
      <h2 id="def-roasting">Home roasting</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="settings.homeRoasting" :disabled="!isOwner || saving" @change="set({ homeRoasting: ($event.target as HTMLInputElement).checked }, 'roasting')" />
        <span>
          Roast your own coffee here
          <span class="muted small hint">Adds a Brew | Roast switch to the header. Roast mode has its own tabs for green stock and roasters. Turning it off hides them; nothing is deleted.</span>
        </span>
      </label>
      <form v-if="settings.homeRoasting" class="stack" novalidate @submit.prevent="saveRoasting">
        <div class="field">
          <label for="roaster-name">Roaster name on your roasts</label>
          <input id="roaster-name" v-model="roasterName" maxlength="255" :disabled="!isOwner || saving" :aria-invalid="!!roastingErrors.name" />
          <span v-if="roastingErrors.name" class="field-error">{{ roastingErrors.name }}</span>
        </div>
        <fieldset class="rest" :disabled="!isOwner || saving">
          <legend>Days a roast rests before it's ready</legend>
          <div class="rest-days">
            <div v-for="t in ROAST_TYPE_KEYS" :key="t" class="field">
              <label :for="`rest-${t}`">{{ ROAST_TYPES[t].label }}</label>
              <input :id="`rest-${t}`" v-model="restDays[t]" inputmode="numeric" :aria-invalid="!!roastingErrors[t]" />
              <span v-if="roastingErrors[t]" class="field-error">{{ roastingErrors[t] }}</span>
            </div>
          </div>
          <p class="muted small">Each roast starts from its type's days, and can change its own.</p>
        </fieldset>
        <div v-if="isOwner && roastingChanged" class="buttons">
          <button class="btn btn-secondary" type="button" :disabled="saving" @click="resetRoasting">Undo</button>
          <button class="btn btn-primary" type="submit" :disabled="saving || Object.keys(roastingErrors).length > 0">Save</button>
        </div>
      </form>
      <p v-if="error && savedWhere === 'roasting'" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && savedWhere === 'roasting'" class="muted small" aria-live="polite">Saved.</p>
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
.hint {
  display: block;
}
.rest {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.rest legend {
  padding: 0;
  margin-bottom: var(--space-1);
  font-weight: 600;
  font-size: 0.9rem;
}
.rest-days {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 7rem));
  gap: var(--space-3);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

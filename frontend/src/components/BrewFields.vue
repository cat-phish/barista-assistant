<script setup lang="ts">
// Brew detail inputs shared by the brew flow's log form and journal editing.
// Validate with parseBrewDraft (lib/brewDraft.ts); pass its errors in.
import { computed } from 'vue';
import type { Grinder } from '../api/types';
import type { BrewDraft, BrewDraftErrors } from '../lib/brewDraft';
import RatingInput from './RatingInput.vue';

const draft = defineModel<BrewDraft>({ required: true });
const props = defineProps<{ errors: BrewDraftErrors; showErrors: boolean; grinders: Grinder[] }>();

// Active grinders, plus the brew's own grinder even if it's since been retired.
const grinderOptions = computed(() => props.grinders.filter((g) => !g.retiredAt || g.id === draft.value.grinderId));
</script>

<template>
  <div class="stack">
    <div class="form-row">
      <div class="field">
        <label for="brew-dose">Dose (g)</label>
        <input id="brew-dose" v-model="draft.dose" inputmode="decimal" :aria-invalid="showErrors && !!errors.dose" />
        <span v-if="showErrors && errors.dose" class="field-error">{{ errors.dose }}</span>
      </div>
      <div class="field">
        <label for="brew-yield">Yield (g)</label>
        <input id="brew-yield" v-model="draft.yieldGrams" inputmode="decimal" :aria-invalid="showErrors && !!errors.yieldGrams" />
        <span v-if="showErrors && errors.yieldGrams" class="field-error">{{ errors.yieldGrams }}</span>
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="brew-time">Total time</label>
        <input id="brew-time" v-model="draft.time" inputmode="numeric" placeholder="m:ss" :aria-invalid="showErrors && !!errors.time" />
        <span v-if="showErrors && errors.time" class="field-error">{{ errors.time }}</span>
      </div>
      <div class="field">
        <label for="brew-temp">Water temp (°C)</label>
        <input id="brew-temp" v-model="draft.temp" inputmode="decimal" :aria-invalid="showErrors && !!errors.temp" />
        <span v-if="showErrors && errors.temp" class="field-error">{{ errors.temp }}</span>
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="brew-grinder">Grinder</label>
        <select id="brew-grinder" v-model="draft.grinderId">
          <option value="">None recorded</option>
          <option v-for="g in grinderOptions" :key="g.id" :value="g.id">{{ g.name }}{{ g.retiredAt ? ' (retired)' : '' }}</option>
        </select>
      </div>
      <div class="field">
        <label for="brew-grind">Grind setting</label>
        <input id="brew-grind" v-model="draft.grind" maxlength="100" />
      </div>
    </div>
    <RatingInput v-model="draft.rating" />
    <div class="field">
      <label for="brew-notes">Tasting notes <span class="muted">(optional)</span></label>
      <textarea id="brew-notes" v-model="draft.notes" rows="3" maxlength="5000" placeholder="e.g. Sour, thin, drained fast" />
      <span class="hint">The AI suggestion uses these, so describe what you taste.</span>
    </div>
  </div>
</template>

<style scoped>
textarea {
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: max(1rem, 16px);
  resize: vertical;
}
</style>

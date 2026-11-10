<script setup lang="ts">
// Log or edit a serving from a cold brew batch (docs/api/brew-servings.md
// §6c). The glass's water starts from the batch's served dilution × what's
// poured, and stops following it once typed. From a jar diluted as a whole,
// what's poured is ready to drink, so no water is suggested.
import { computed, ref, watch } from 'vue';
import type { BrewServingInput } from '../api/servings';
import type { FlavorPick } from '../api/types';
import { overallRatio } from '../lib/batch';
import { DILUTION_WITH } from '../lib/coldBrew';
import { formatGrams } from '../lib/format';
import { parseServingDraft, ratioText, suggestWater, type ServingDraft } from '../lib/servingDraft';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import FlavorWheel from './FlavorWheel.vue';
import RatingInput from './RatingInput.vue';

const props = defineProps<{
  initial: ServingDraft;
  editing: boolean;
  servedRatio: number | null; // the batch's "Served diluted 1 :"
  jarRatio: number; // water per g of concentrate already in the jar
  askYield: boolean; // an unweighed batch its person can edit
  yieldEstimate: number | null;
  savedFlavors?: readonly FlavorPick[];
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ save: [values: BrewServingInput, batchYieldGrams: number | null]; cancel: [] }>();

const { show } = useFieldVisibility();
const draft = ref<ServingDraft>({ ...props.initial, flavors: [...props.initial.flavors] });
const submitted = ref(false);
const waterTyped = ref(props.editing);
const jarDiluted = computed(() => props.jarRatio > 0);
const parsed = computed(() => parseServingDraft(draft.value));
const pouredGrams = computed(() => parsed.value.values?.concentrateGrams ?? null);

watch(pouredGrams, (g) => {
  if (!waterTyped.value) draft.value.water = suggestWater(g, props.servedRatio, jarDiluted.value);
});

// The glass as drunk, counting the jar's water.
const strength = computed(() => {
  const g = pouredGrams.value;
  if (!g) return '';
  const water = parsed.value.values?.diluentGrams ?? null;
  const r = overallRatio(g, water, props.jarRatio);
  return `${formatGrams(g + (water ?? 0))} g in the glass · ${r === null ? 'neat concentrate' : `${ratioText(r)} as drunk`}`;
});

function submit(): void {
  submitted.value = true;
  const { values, batchYieldGrams } = parsed.value;
  if (values) emit('save', values, props.askYield ? batchYieldGrams : null);
}
const err = (k: keyof typeof parsed.value.errors) => (submitted.value ? parsed.value.errors[k] : undefined);
</script>

<template>
  <form class="serving-form stack" novalidate @submit.prevent="submit">
    <div v-if="askYield" class="field">
      <label for="serving-batch-yield">Concentrate made (g)</label>
      <input id="serving-batch-yield" v-model="draft.batchYield" inputmode="decimal" :placeholder="yieldEstimate !== null ? `≈ ${formatGrams(yieldEstimate)}` : ''" :aria-invalid="!!err('batchYield')" />
      <span v-if="err('batchYield')" class="field-error">{{ err('batchYield') }}</span>
      <span v-else class="hint">The batch wasn't weighed. Weigh the jar's concentrate so what's left is right; empty keeps the estimate</span>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="serving-poured">{{ jarDiluted ? 'Poured from jar (g)' : 'Concentrate (g)' }}<span class="req" aria-hidden="true">*</span></label>
        <input id="serving-poured" v-model="draft.poured" inputmode="decimal" aria-required="true" :aria-invalid="!!err('poured')" />
        <span v-if="err('poured')" class="field-error">{{ err('poured') }}</span>
      </div>
      <div class="field">
        <label for="serving-water">Added in the glass (g)</label>
        <div class="dilution">
          <input id="serving-water" v-model="draft.water" inputmode="decimal" placeholder="none" :aria-invalid="!!err('water')" @input="waterTyped = true" />
          <select v-model="draft.dilutedWith" aria-label="Added">
            <option v-for="(label, key) in DILUTION_WITH" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <span v-if="err('water')" class="field-error">{{ err('water') }}</span>
        <span v-else-if="jarDiluted" class="hint">The jar is diluted already</span>
      </div>
    </div>
    <p v-if="strength" class="muted small" aria-live="polite">{{ strength }}</p>
    <div class="field">
      <label for="serving-when">Poured</label>
      <input id="serving-when" v-model="draft.when" type="datetime-local" :aria-invalid="!!err('when')" />
      <span v-if="err('when')" class="field-error">{{ err('when') }}</span>
    </div>
    <RatingInput v-model="draft.rating" name="serving-rating" />
    <FlavorWheel v-if="show('brew.flavors') || draft.flavors.length" v-model="draft.flavors" :saved="savedFlavors" />
    <div class="field">
      <label for="serving-notes">Notes</label>
      <textarea id="serving-notes" v-model="draft.notes" rows="2" maxlength="5000" placeholder="e.g. Chocolatey, a little flat" />
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="buttons">
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
      <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? 'Saving…' : editing ? 'Save serving' : 'Log serving' }}</button>
    </div>
  </form>
</template>

<style scoped>
.dilution {
  display: flex;
  gap: var(--space-2);
}
.dilution input {
  flex: 1;
  min-width: 0;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
p {
  margin: 0;
}
</style>

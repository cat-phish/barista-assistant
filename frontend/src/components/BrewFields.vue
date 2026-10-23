<script setup lang="ts">
// Brew detail inputs shared by the brew flow's log form and journal editing.
// Validate with parseBrewDraft (lib/brewDraft.ts); pass its errors in.
import { computed, ref, watch } from 'vue';
import type { Grinder, MethodKind, PrepTool, RecipeStyle, WaterProfile } from '../api/types';
import type { BrewDraft, BrewDraftErrors } from '../lib/brewDraft';
import { brixToTds, extractionYield, usesWater } from '../lib/extraction';
import { formatGrams } from '../lib/format';
import { toolsFor } from '../lib/prepTools';
import RatingInput from './RatingInput.vue';

const draft = defineModel<BrewDraft>({ required: true });
const props = defineProps<{
  errors: BrewDraftErrors;
  showErrors: boolean;
  grinders: Grinder[];
  waterProfiles?: WaterProfile[]; // the workspace's (docs/api/water-profiles.md §3c)
  prepTools?: PrepTool[]; // the workspace's, in order (docs/api/prep-tools.md §3d)
  methodKind?: MethodKind | null; // the recipe's; null = no recipe (every tool shows)
  expectedYieldGrams?: number | null; // the recipe's estimate (espresso: target), shown for comparison
  espresso?: boolean; // shot weight instead of water (docs/api/brew-logs.md §6)
  drinkTasting?: boolean; // the drink has ingredients: rate the brew and the drink apart
  recipeStyle?: RecipeStyle | null; // decides how extraction yield is worked out
}>();

// Measured yield vs the recipe's estimate, e.g. "+6 g vs expected 220 g".
const expectedWord = computed(() => (props.espresso ? 'target' : 'expected'));
const yieldComparison = computed(() => {
  const expected = props.expectedYieldGrams;
  const measured = Number(draft.value.yieldGrams.replace(',', '.'));
  if (expected == null || !draft.value.yieldGrams.trim() || !Number.isFinite(measured) || measured <= 0) return '';
  const diff = Math.round((measured - expected) * 10) / 10;
  return `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} g vs ${expectedWord.value} ${formatGrams(expected)} g`;
});

// Extraction yield from the TDS as typed, e.g. "Extraction ≈ 20.2%", or a hint
// when the yield it needs is missing.
const num = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};
const extractionHint = computed(() => {
  const tds = num(draft.value.tds);
  if (tds === null) return '';
  const style = props.recipeStyle ?? null;
  const ey = extractionYield({
    tdsPercent: tds,
    doseGrams: num(draft.value.dose) ?? 0,
    yieldGrams: num(draft.value.yieldGrams),
    waterGrams: props.espresso ? null : num(draft.value.water),
    style,
  });
  if (ey !== null) return `Extraction ≈ ${ey}%`;
  if (!num(draft.value.dose)) return '';
  return usesWater(style) ? 'Enter the water to see extraction' : `Weigh the ${props.espresso ? 'shot' : 'brewed coffee'} to see extraction`;
});

// A Brix reading fills in TDS as it's typed. Only TDS is saved, so Brix starts
// empty; typing a TDS that no longer matches it clears it.
const brix = ref('');
const brixAsTds = (s: string): string | null => {
  const n = num(s);
  return n === null ? null : String(brixToTds(n));
};
watch(brix, (b) => {
  const tds = brixAsTds(b);
  if (tds !== null) draft.value.tds = tds;
});
watch(
  () => draft.value.tds,
  (tds) => {
    if (brix.value && brixAsTds(brix.value) !== tds) brix.value = '';
  },
);

// Active grinders, plus the brew's own even if it's since been retired.
const grinderOptions = computed(() => props.grinders.filter((g) => !g.retiredAt || g.id === draft.value.grinderId));
// The prep checklist: the method's tools and the all-method ones (lib/prepTools.ts).
const toolOptions = computed(() => toolsFor(props.prepTools ?? [], props.methodKind ?? null, draft.value.toolIds));
// Likewise for water; with none set up, the only choice says so.
const waterOptions = computed(() => (props.waterProfiles ?? []).filter((w) => !w.retiredAt || w.id === draft.value.waterProfileId));
</script>

<template>
  <div class="stack">
    <div class="form-row">
      <div class="field">
        <label for="brew-dose">Dose (g)<span class="req" aria-hidden="true">*</span></label>
        <input id="brew-dose" aria-required="true" v-model="draft.dose" inputmode="decimal" :aria-invalid="showErrors && !!errors.dose" />
        <span v-if="showErrors && errors.dose" class="field-error">{{ errors.dose }}</span>
      </div>
      <div v-if="espresso" class="field">
        <label for="brew-yield">Shot weight (g)<span class="req" aria-hidden="true">*</span></label>
        <input
          id="brew-yield" aria-required="true"
          v-model="draft.yieldGrams"
          inputmode="decimal"
          :placeholder="expectedYieldGrams != null ? `Target ${formatGrams(expectedYieldGrams)}` : ''"
          :aria-invalid="showErrors && !!errors.yieldGrams"
        />
        <span v-if="showErrors && errors.yieldGrams" class="field-error">{{ errors.yieldGrams }}</span>
        <span v-else-if="yieldComparison" class="hint">{{ yieldComparison }}</span>
      </div>
      <div v-else class="field">
        <label for="brew-water">Water (g)<span class="req" aria-hidden="true">*</span></label>
        <input id="brew-water" aria-required="true" v-model="draft.water" inputmode="decimal" :aria-invalid="showErrors && !!errors.water" />
        <span v-if="showErrors && errors.water" class="field-error">{{ errors.water }}</span>
      </div>
    </div>
    <div v-if="!espresso" class="field">
      <label for="brew-yield">Yield (g) <span class="muted">(weigh the brewed coffee)</span></label>
      <input
        id="brew-yield"
        v-model="draft.yieldGrams"
        inputmode="decimal"
        :placeholder="expectedYieldGrams != null ? `Expected ~${formatGrams(expectedYieldGrams)}` : ''"
        :aria-invalid="showErrors && !!errors.yieldGrams"
      />
      <span v-if="showErrors && errors.yieldGrams" class="field-error">{{ errors.yieldGrams }}</span>
      <span v-else-if="yieldComparison" class="hint">{{ yieldComparison }}</span>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="brew-brix">Brix (°Bx)</label>
        <input id="brew-brix" v-model="brix" inputmode="decimal" :placeholder="espresso ? 'e.g. 11' : 'e.g. 1.6'" />
        <span class="hint">Fills in TDS</span>
      </div>
      <div class="field">
        <label for="brew-tds">TDS (%)</label>
        <input id="brew-tds" v-model="draft.tds" inputmode="decimal" :placeholder="espresso ? 'e.g. 9.5' : 'e.g. 1.38'" :aria-invalid="showErrors && !!errors.tds" />
        <span v-if="showErrors && errors.tds" class="field-error">{{ errors.tds }}</span>
        <span v-else-if="extractionHint" class="hint">{{ extractionHint }}</span>
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="brew-time">{{ espresso ? 'Shot time' : 'Total time' }}<span class="req" aria-hidden="true">*</span></label>
        <input id="brew-time" aria-required="true" v-model="draft.time" inputmode="numeric" placeholder="m:ss" :aria-invalid="showErrors && !!errors.time" />
        <span v-if="showErrors && errors.time" class="field-error">{{ errors.time }}</span>
      </div>
      <div v-if="espresso" class="field">
        <label for="brew-first-drop">First drop (s)</label>
        <input id="brew-first-drop" v-model="draft.firstDrop" inputmode="decimal" placeholder="e.g. 7.4" :aria-invalid="showErrors && !!errors.firstDrop" />
        <span v-if="showErrors && errors.firstDrop" class="field-error">{{ errors.firstDrop }}</span>
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
    <div class="field">
      <label for="brew-water-profile">Water profile</label>
      <select id="brew-water-profile" v-model="draft.waterProfileId">
        <option value="">{{ waterOptions.length ? 'None recorded' : 'None (no water profiles set up)' }}</option>
        <option v-for="w in waterOptions" :key="w.id" :value="w.id">{{ w.name }}{{ w.retiredAt ? ' (retired)' : '' }}</option>
      </select>
    </div>
    <fieldset v-if="toolOptions.length" class="prep">
      <legend>Prep</legend>
      <div class="prep-list">
        <label v-for="t in toolOptions" :key="t.id" class="checkbox">
          <input v-model="draft.toolIds" type="checkbox" :value="t.id" />
          {{ t.name }}{{ t.retiredAt ? ' (retired)' : '' }}
        </label>
      </div>
    </fieldset>
    <!-- A drink with ingredients is tasted twice: the brew on its own (if you
         tried it) and the finished drink, which milk and syrup change. -->
    <fieldset v-if="drinkTasting" class="tasting">
      <legend>The brew <span class="muted">(if you tasted it on its own)</span></legend>
      <RatingInput v-model="draft.rating" name="brew-rating" label="Brew rating" />
      <div class="field">
        <label for="brew-notes">Brew notes</label>
        <textarea id="brew-notes" v-model="draft.notes" rows="2" maxlength="5000" placeholder="e.g. Bright, a bit sharp" />
      </div>
    </fieldset>
    <fieldset v-if="drinkTasting" class="tasting">
      <legend>The drink</legend>
      <RatingInput v-model="draft.drinkRating" name="drink-rating" label="Drink rating" />
      <div class="field">
        <label for="brew-drink-notes">Drink notes</label>
        <textarea id="brew-drink-notes" v-model="draft.drinkNotes" rows="3" maxlength="5000" placeholder="e.g. Sweet, caramel, good balance with the milk" />
        <span class="hint">The AI reads the brew's own notes as the clearest sign of extraction; drink notes help, knowing milk softens sourness and bitterness.</span>
      </div>
    </fieldset>
    <template v-else>
      <RatingInput v-model="draft.rating" />
      <div class="field">
        <label for="brew-notes">Tasting notes</label>
        <textarea id="brew-notes" v-model="draft.notes" rows="3" maxlength="5000" placeholder="e.g. Sour, thin, drained fast" />
        <span class="hint">The AI suggestion uses these, so describe what you taste.</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tasting {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.tasting > legend {
  font-weight: 600;
  padding: 0 var(--space-1);
}
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
.prep {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.prep legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.prep-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}
</style>

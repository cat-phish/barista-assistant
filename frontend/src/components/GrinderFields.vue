<script setup lang="ts">
// Grinder name + optional details (docs/api/grinders.md §3b). Validate with
// parseGrinderForm (lib/equipment.ts) and pass its errors in.
import { computed } from 'vue';
import { BURR_TYPES, GRINDER_ADJUSTMENTS, GRINDER_POWER, METHOD_KINDS, METHOD_ORDER, type GrinderForm, type GrinderFormErrors } from '../lib/equipment';
import { START_TARGETS } from '../lib/grinderStart';

const form = defineModel<GrinderForm>({ required: true });
defineProps<{ idPrefix: string; errors: GrinderFormErrors; showErrors: boolean }>();

// Method/style starting points: each target once, none for a method it can't do.
const usedTargets = computed(() => new Set(form.value.startRows.map((r) => r.target)));
const freeTargets = computed(() =>
  START_TARGETS.filter((m) => !form.value.unavailableMethods.includes(m.method)).flatMap((m) => m.targets).filter((t) => !usedTargets.value.has(t.key)),
);
function addStartRow(): void {
  form.value.startRows.push({ target: freeTargets.value[0]?.key ?? '', setting: '' });
}
</script>

<template>
  <div class="stack">
    <div class="field">
      <label :for="`${idPrefix}-name`">Name<span class="req" aria-hidden="true">*</span></label>
      <input :id="`${idPrefix}-name`" aria-required="true" v-model="form.name" maxlength="100" placeholder="e.g. Comandante C40" :aria-invalid="showErrors && !!errors.name" />
      <span v-if="showErrors && errors.name" class="field-error">{{ errors.name }}</span>
    </div>
    <div class="form-row">
      <div class="field">
        <label :for="`${idPrefix}-adjustment`">Adjustment</label>
        <select :id="`${idPrefix}-adjustment`" v-model="form.adjustment">
          <option value="">Not set</option>
          <option v-for="(label, key) in GRINDER_ADJUSTMENTS" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="`${idPrefix}-power`">Type</label>
        <select :id="`${idPrefix}-power`" v-model="form.power">
          <option value="">Not set</option>
          <option v-for="(label, key) in GRINDER_POWER" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
    </div>
    <fieldset class="range">
      <legend>Setting range</legend>
      <div class="range-row">
        <div class="field">
          <label :for="`${idPrefix}-min`">From</label>
          <input :id="`${idPrefix}-min`" v-model="form.settingMin" inputmode="decimal" placeholder="0" :aria-invalid="showErrors && !!errors.range" />
        </div>
        <div class="field">
          <label :for="`${idPrefix}-max`">To</label>
          <input :id="`${idPrefix}-max`" v-model="form.settingMax" inputmode="decimal" placeholder="40" :aria-invalid="showErrors && !!errors.range" />
        </div>
        <div class="field">
          <label :for="`${idPrefix}-step`">Per step</label>
          <input :id="`${idPrefix}-step`" v-model="form.stepSize" inputmode="decimal" placeholder="1" :aria-invalid="showErrors && !!errors.stepSize" />
        </div>
      </div>
      <span v-if="showErrors && (errors.range || errors.stepSize)" class="field-error">{{ errors.range ?? errors.stepSize }}</span>
      <span v-else class="hint">Lets the AI suggest changes in steps, e.g. "2 clicks finer".</span>
    </fieldset>
    <div class="field">
      <label :for="`${idPrefix}-usual`">Usual adjustment</label>
      <input :id="`${idPrefix}-usual`" v-model="form.usualAdjustment" inputmode="decimal" placeholder="e.g. 2" :aria-invalid="showErrors && !!errors.usualAdjustment" />
      <span v-if="showErrors && errors.usualAdjustment" class="field-error">{{ errors.usualAdjustment }}</span>
      <span v-else class="hint">How far you usually move the dial when dialing in, in its units. The AI sizes its grind suggestions by it.</span>
    </div>
    <fieldset class="range">
      <legend>Starting points</legend>
      <div class="field">
        <label :for="`${idPrefix}-starting`">Starting point</label>
        <input :id="`${idPrefix}-starting`" v-model="form.startingSetting" inputmode="decimal" placeholder="e.g. 20" :aria-invalid="showErrors && !!errors.startingSetting" />
        <span v-if="showErrors && errors.startingSetting" class="field-error">{{ errors.startingSetting }}</span>
        <span v-else class="hint">Fills in a recipe's grind for this grinder, for every method unless you add one below.</span>
      </div>
      <ul v-if="form.startRows.length" class="start-rows">
        <li v-for="(row, i) in form.startRows" :key="i" class="start-row">
          <div class="start-row-inputs">
            <select v-model="row.target" :aria-label="`Starting point ${i + 1}: method or style`" :aria-invalid="showErrors && !!errors.startRows?.[i]">
              <option value="" disabled>Method or style…</option>
              <optgroup v-for="m in START_TARGETS" :key="m.method" :label="m.label">
                <option
                  v-for="t in m.targets"
                  :key="t.key"
                  :value="t.key"
                  :disabled="t.key !== row.target && (usedTargets.has(t.key) || form.unavailableMethods.includes(t.method))"
                >{{ t.label }}</option>
              </optgroup>
            </select>
            <input v-model="row.setting" inputmode="decimal" placeholder="Setting" :aria-label="`Starting point ${i + 1}: setting`" :aria-invalid="showErrors && !!errors.startRows?.[i]" />
            <button type="button" class="btn-link danger" :aria-label="`Remove starting point ${i + 1}`" @click="form.startRows.splice(i, 1)">✕</button>
          </div>
          <span v-if="showErrors && errors.startRows?.[i]" class="field-error">{{ errors.startRows[i] }}</span>
        </li>
      </ul>
      <div>
        <button type="button" class="btn btn-secondary" :disabled="!freeTargets.length" @click="addStartRow">Add method/style starting point</button>
      </div>
    </fieldset>
    <fieldset class="range">
      <legend>Can't grind for</legend>
      <div class="method-checks">
        <label v-for="k in METHOD_ORDER" :key="k" class="checkbox">
          <input v-model="form.unavailableMethods" type="checkbox" :value="k" />
          {{ METHOD_KINDS[k].label }}
        </label>
      </div>
      <span class="hint">Hidden from the grinder pickers for these methods.</span>
    </fieldset>
    <div class="form-row">
      <div class="field">
        <label :for="`${idPrefix}-burr`">Burrs</label>
        <select :id="`${idPrefix}-burr`" v-model="form.burrType">
          <option value="">Not set</option>
          <option v-for="(label, key) in BURR_TYPES" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="`${idPrefix}-burr-size`">Burr size (mm)</label>
        <input :id="`${idPrefix}-burr-size`" v-model="form.burrSizeMm" inputmode="numeric" placeholder="e.g. 39" :aria-invalid="showErrors && !!errors.burrSizeMm" />
        <span v-if="showErrors && errors.burrSizeMm" class="field-error">{{ errors.burrSizeMm }}</span>
      </div>
    </div>
    <fieldset class="range">
      <legend>Speed</legend>
      <label class="checkbox">
        <input :id="`${idPrefix}-variable-speed`" v-model="form.variableSpeed" type="checkbox" />
        Variable speed (brews record the RPM)
      </label>
      <template v-if="form.variableSpeed">
        <div class="range-row">
          <div class="field">
            <label :for="`${idPrefix}-rpm-min`">From (RPM)</label>
            <input :id="`${idPrefix}-rpm-min`" v-model="form.rpmMin" inputmode="numeric" placeholder="e.g. 300" :aria-invalid="showErrors && !!errors.rpm" />
          </div>
          <div class="field">
            <label :for="`${idPrefix}-rpm-max`">To (RPM)</label>
            <input :id="`${idPrefix}-rpm-max`" v-model="form.rpmMax" inputmode="numeric" placeholder="e.g. 1500" :aria-invalid="showErrors && !!errors.rpm" />
          </div>
        </div>
        <span v-if="showErrors && errors.rpm" class="field-error">{{ errors.rpm }}</span>
        <span v-else class="hint">The speeds the grinder can run at.</span>
      </template>
    </fieldset>
    <div class="field">
      <label :for="`${idPrefix}-notes`">Notes</label>
      <input :id="`${idPrefix}-notes`" v-model="form.notes" maxlength="255" placeholder="e.g. Red Clix fitted" />
    </div>
  </div>
</template>

<style scoped>
.range {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.range legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.range-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}
.range .hint {
  font-size: 0.85rem;
  color: var(--text-muted);
}
.start-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.start-row-inputs {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6rem auto;
  gap: var(--space-2);
  align-items: center;
}
.start-row-inputs select,
.start-row-inputs input {
  width: 100%;
  min-width: 0;
}
.method-checks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}
.range-row input {
  width: 100%;
  min-width: 0;
}
</style>

<script setup lang="ts">
// Grinder name + optional details (docs/api/grinders.md §3b). Validate with
// parseGrinderForm (lib/equipment.ts) and pass its errors in.
import { BURR_TYPES, GRINDER_ADJUSTMENTS, GRINDER_POWER, type GrinderForm, type GrinderFormErrors } from '../lib/equipment';

const form = defineModel<GrinderForm>({ required: true });
defineProps<{ idPrefix: string; errors: GrinderFormErrors; showErrors: boolean }>();
</script>

<template>
  <div class="stack">
    <div class="field">
      <label :for="`${idPrefix}-name`">Name</label>
      <input :id="`${idPrefix}-name`" v-model="form.name" maxlength="100" placeholder="e.g. Comandante C40" :aria-invalid="showErrors && !!errors.name" />
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
      <legend>Setting range <span class="muted">(optional)</span></legend>
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
    <div class="field">
      <label :for="`${idPrefix}-notes`">Notes <span class="muted">(optional)</span></label>
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
.range-row input {
  width: 100%;
  min-width: 0;
}
</style>

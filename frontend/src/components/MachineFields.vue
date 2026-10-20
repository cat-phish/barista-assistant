<script setup lang="ts">
// Machine name, capabilities and notes (docs/api_spec.md §3c).
import type { MachineCapabilities } from '../api/types';
import { PREINFUSION_MODES, PROFILE_CONTROLS } from '../lib/equipment';

export interface MachineForm extends MachineCapabilities {
  name: string;
  notes: string;
}

const form = defineModel<MachineForm>({ required: true });
defineProps<{ idPrefix: string; showErrors: boolean }>();
</script>

<template>
  <div class="stack">
    <div class="field">
      <label :for="`${idPrefix}-name`">Name</label>
      <input :id="`${idPrefix}-name`" v-model="form.name" maxlength="100" placeholder="e.g. Linea Mini" :aria-invalid="showErrors && !form.name.trim()" />
      <span v-if="showErrors && !form.name.trim()" class="field-error">Required</span>
    </div>
    <div class="field">
      <label :for="`${idPrefix}-preinfusion`">Pre-infusion</label>
      <select :id="`${idPrefix}-preinfusion`" v-model="form.preinfusion">
        <option v-for="(m, key) in PREINFUSION_MODES" :key="key" :value="key">{{ m.label }}</option>
      </select>
      <span class="hint">{{ PREINFUSION_MODES[form.preinfusion].hint }}</span>
    </div>
    <div class="form-row">
      <div class="field">
        <label :for="`${idPrefix}-flow`">Flow control</label>
        <select :id="`${idPrefix}-flow`" v-model="form.flowControl">
          <option v-for="(m, key) in PROFILE_CONTROLS" :key="key" :value="key">{{ m.label }}</option>
        </select>
        <span class="hint">{{ PROFILE_CONTROLS[form.flowControl].hint }}</span>
      </div>
      <div class="field">
        <label :for="`${idPrefix}-pressure`">Pressure control</label>
        <select :id="`${idPrefix}-pressure`" v-model="form.pressureControl">
          <option v-for="(m, key) in PROFILE_CONTROLS" :key="key" :value="key">{{ m.label }}</option>
        </select>
        <span class="hint">{{ PROFILE_CONTROLS[form.pressureControl].hint }}</span>
      </div>
    </div>
    <div class="field">
      <label :for="`${idPrefix}-notes`">Notes <span class="muted">(optional)</span></label>
      <input :id="`${idPrefix}-notes`" v-model="form.notes" maxlength="255" placeholder="e.g. 18 g VST basket" />
    </div>
  </div>
</template>

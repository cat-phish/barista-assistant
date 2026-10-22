<script setup lang="ts">
// A brewer's fields (docs/api/brewers.md §3): name and brew method (which also
// groups it when brewing); for espresso, what the machine lets you control;
// notes. How it shows on the public menu is set in Bar setup → Menu.
import { METHOD_KINDS, PREINFUSION_MODES, PROFILE_CONTROLS, type BrewerForm } from '../lib/equipment';

const form = defineModel<BrewerForm>({ required: true });
defineProps<{ idPrefix: string; showErrors: boolean }>();
</script>

<template>
  <div class="stack">
    <div class="form-row">
      <div class="field">
        <label :for="`${idPrefix}-name`">Name</label>
        <input :id="`${idPrefix}-name`" v-model="form.name" maxlength="100" placeholder="e.g. V60, Linea Mini" :aria-invalid="showErrors && !form.name.trim()" />
        <span v-if="showErrors && !form.name.trim()" class="field-error">Required</span>
      </div>
      <div class="field">
        <label :for="`${idPrefix}-kind`">Brew method</label>
        <select :id="`${idPrefix}-kind`" v-model="form.kind">
          <option v-for="(k, key) in METHOD_KINDS" :key="key" :value="key">{{ k.label }}</option>
        </select>
      </div>
    </div>
    <p class="muted small">{{ METHOD_KINDS[form.kind].hint }}. It groups the brewer when you brew, and decides the recipe fields, the timer, and which drinks it can make.</p>
    <template v-if="form.kind === 'espresso'">
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
    </template>
    <div class="field">
      <label :for="`${idPrefix}-notes`">Notes <span class="muted">(optional)</span></label>
      <input :id="`${idPrefix}-notes`" v-model="form.notes" maxlength="255" :placeholder="form.kind === 'espresso' ? 'e.g. 18 g VST basket' : 'e.g. 02 size, white ceramic'" />
    </div>
  </div>
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
</style>

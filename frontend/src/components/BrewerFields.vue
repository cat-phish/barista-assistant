<script setup lang="ts">
// A brewer's fields (docs/api/brewers.md §3): name and brew method (which also
// groups it when brewing); for espresso, what the machine lets you control;
// for the rest, the water its grounds keep (the yield estimate); a finish
// offset; notes. How it shows on the public menu is set in Bar setup → Menu.
import { computed, watch } from 'vue';
import type { BrewerMethod } from '../api/types';
import { METHOD_KINDS, parseGroundsRetention, PREINFUSION_MODES, PROFILE_CONTROLS, type BrewerForm } from '../lib/equipment';
import { formatGrams } from '../lib/format';
import { parseFinishOffset } from '../lib/finishOffset';

const form = defineModel<BrewerForm>({ required: true });
// learned: what its measured brews say (docs/api/brewers.md §3), editing only.
const props = defineProps<{ idPrefix: string; showErrors: boolean; methods: BrewerMethod[]; learned?: { retention: number; count: number } | null }>();

// The workspace's methods (docs/api/brewer-methods.md §3e): the visible ones,
// plus the brewer's own if it's hidden. The kind follows the chosen method.
const methodChoices = computed(() => props.methods.filter((m) => !m.hidden || m.id === form.value.methodId));
const offset = computed(() => parseFinishOffset(form.value.finishOffset));
const retention = computed(() => parseGroundsRetention(form.value.groundsRetention));
const learnedText = computed(() => (props.learned ? formatGrams(Math.round(props.learned.retention * 100) / 100) : null));
const method = computed(() => props.methods.find((m) => m.id === form.value.methodId) ?? null);
watch(method, (m) => {
  if (m) form.value.kind = m.behaviour;
});
// A new brewer (or one from before methods) starts on its kind's built-in method.
watch(
  () => props.methods,
  (list) => {
    if (!form.value.methodId) form.value.methodId = list.find((m) => m.builtin === form.value.kind)?.id ?? '';
  },
  { immediate: true },
);
</script>

<template>
  <div class="stack">
    <div class="form-row">
      <div class="field">
        <label :for="`${idPrefix}-name`">Name<span class="req" aria-hidden="true">*</span></label>
        <input :id="`${idPrefix}-name`" aria-required="true" v-model="form.name" maxlength="100" placeholder="e.g. V60, Linea Mini" :aria-invalid="showErrors && !form.name.trim()" />
        <span v-if="showErrors && !form.name.trim()" class="field-error">Required</span>
      </div>
      <div class="field">
        <label :for="`${idPrefix}-kind`">Brew method<span class="req" aria-hidden="true">*</span></label>
        <select v-if="methods.length" :id="`${idPrefix}-kind`" aria-required="true" v-model="form.methodId">
          <option v-for="m in methodChoices" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <select v-else :id="`${idPrefix}-kind`" aria-required="true" v-model="form.kind">
          <option v-for="(k, key) in METHOD_KINDS" :key="key" :value="key">{{ k.label }}</option>
        </select>
      </div>
    </div>
    <p class="muted small">
      <template v-if="method && !method.builtin">{{ method.name }} works like {{ METHOD_KINDS[form.kind].label.toLowerCase() }}: </template>{{ METHOD_KINDS[form.kind].hint }}. It
      groups the brewer when you brew, and decides the recipe fields, the timer, and which drinks it can make.
    </p>
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
    <div v-else class="field offset">
      <label :for="`${idPrefix}-retention`">Water kept by the grounds (g per g)</label>
      <input :id="`${idPrefix}-retention`" v-model="form.groundsRetention" inputmode="decimal" maxlength="4" :placeholder="learnedText ?? 'e.g. 1.1'" :aria-invalid="!retention.ok" />
      <span v-if="!retention.ok" class="field-error">{{ retention.error }}</span>
      <span v-else class="hint">
        For the yield estimate: how much water stays in the spent coffee per gram. A pressed brewer (OXO, AeroPress) keeps about 1, a drip cone 2 or more.
        <template v-if="learned">
          Your {{ learned.count === 1 ? 'measured brew says' : `${learned.count} measured brews say` }} {{ learnedText }}<template v-if="!form.groundsRetention.trim()">, used while this is blank</template>.
          <button v-if="form.groundsRetention.trim() !== learnedText" class="btn-link" type="button" @click="form.groundsRetention = learnedText ?? ''">Use {{ learnedText }}</button>
        </template>
        <template v-else>Blank: learned from the brews you measure with it.</template>
      </span>
    </div>
    <div class="field offset">
      <label :for="`${idPrefix}-finish-offset`">Finish offset (s)</label>
      <input :id="`${idPrefix}-finish-offset`" v-model="form.finishOffset" maxlength="3" placeholder="e.g. 4" :aria-invalid="!offset.ok" />
      <span v-if="!offset.ok" class="field-error">{{ offset.error }}</span>
      <span v-else class="hint">Seconds between the brew ending and you tapping Finish &amp; Save, e.g. pressing an OXO until the hiss. They're taken off the brew time; a negative number adds them, if you tap early. A recipe can set its own.</span>
    </div>
    <div class="field">
      <label :for="`${idPrefix}-notes`">Notes</label>
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
.offset input {
  max-width: 8rem;
}
</style>

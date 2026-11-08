<script setup lang="ts">
// Editing one calculator block of a note (NoteFormView; docs/api/notes.md
// §3h): its title, inputs (label, key, unit, default) and results (label,
// key, formula, unit, decimals), with a live preview. A key follows its label
// until it's changed by hand. Errors come from calculatorErrors (lib/noteBlocks.ts).
import { computed } from 'vue';
import NoteCalculator from './NoteCalculator.vue';
import { CALC_FUNCTIONS } from '../lib/calc';
import { draftCalculator, keyFromLabel, MAX_DECIMALS, type DraftCalculator, type DraftInput, type DraftResult } from '../lib/noteBlocks';

const props = defineProps<{ errors: Record<string, string>; showErrors: boolean }>();
const calc = defineModel<DraftCalculator>({ required: true });

type Field = DraftInput | DraftResult;
const otherKeys = (f: Field) => [...calc.value.inputs, ...calc.value.results].filter((x) => x !== f).map((x) => x.key);
function setLabel(f: Field, label: string): void {
  const auto = !f.key.trim() || f.key === keyFromLabel(f.label, otherKeys(f));
  f.label = label;
  if (auto) f.key = keyFromLabel(label, otherKeys(f));
}
function addInput(): void {
  const taken = [...calc.value.inputs, ...calc.value.results].map((x) => x.key);
  calc.value.inputs.push({ key: keyFromLabel('Amount', taken), label: 'Amount', unit: '', valueText: '1' });
}
function addResult(): void {
  const taken = [...calc.value.inputs, ...calc.value.results].map((x) => x.key);
  calc.value.results.push({ key: keyFromLabel('Result', taken), label: 'Result', unit: '', formula: calc.value.inputs[0]?.key ?? '1', decimals: 2 });
}
function move<T>(list: T[], i: number, by: -1 | 1): void {
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
}
const remove = <T,>(list: T[], i: number) => list.splice(i, 1);

const err = (path: string) => (props.showErrors || path.endsWith('.formula') ? props.errors[path] : undefined);
// What a result's formula can use: the inputs, and the results above it.
const usable = (i: number) => [...calc.value.inputs, ...calc.value.results.slice(0, i)].map((x) => x.key.trim()).filter(Boolean);
const preview = computed(() => draftCalculator(calc.value));
const id = (what: string) => `calc-${calc.value.id}-${what}`;
</script>

<template>
  <div class="editor stack">
    <div class="field">
      <label :for="id('title')">Calculator title</label>
      <input :id="id('title')" v-model="calc.title" maxlength="100" placeholder="e.g. Descaler for the tank" />
    </div>

    <fieldset class="group">
      <legend>Inputs</legend>
      <p class="muted small">What someone fills in. The default is what it starts at; changes on the Notes page stay on that device.</p>
      <div v-for="(input, i) in calc.inputs" :key="i" class="item">
        <div class="item-fields">
          <div class="field grow">
            <label :for="id(`in-${i}-label`)">Label<span class="req" aria-hidden="true">*</span></label>
            <input :id="id(`in-${i}-label`)" :value="input.label" aria-required="true" maxlength="60" :aria-invalid="!!err(`inputs.${i}.label`)" @input="setLabel(input, ($event.target as HTMLInputElement).value)" />
            <p v-if="err(`inputs.${i}.label`)" class="field-error">{{ err(`inputs.${i}.label`) }}</p>
          </div>
          <div class="field key">
            <label :for="id(`in-${i}-key`)">Key<span class="req" aria-hidden="true">*</span></label>
            <input :id="id(`in-${i}-key`)" v-model="input.key" class="mono" aria-required="true" maxlength="32" spellcheck="false" autocapitalize="off" :aria-invalid="!!err(`inputs.${i}.key`)" />
            <p v-if="err(`inputs.${i}.key`)" class="field-error">{{ err(`inputs.${i}.key`) }}</p>
          </div>
          <div class="field unit">
            <label :for="id(`in-${i}-unit`)">Unit</label>
            <input :id="id(`in-${i}-unit`)" v-model="input.unit" maxlength="20" placeholder="L" />
          </div>
          <div class="field num">
            <label :for="id(`in-${i}-value`)">Default<span class="req" aria-hidden="true">*</span></label>
            <input :id="id(`in-${i}-value`)" v-model="input.valueText" inputmode="decimal" aria-required="true" :aria-invalid="!!err(`inputs.${i}.value`)" />
            <p v-if="err(`inputs.${i}.value`)" class="field-error">{{ err(`inputs.${i}.value`) }}</p>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn-link" type="button" :disabled="i === 0" :aria-label="`Move ${input.label || 'input'} up`" @click="move(calc.inputs, i, -1)">↑</button>
          <button class="btn-link" type="button" :disabled="i === calc.inputs.length - 1" :aria-label="`Move ${input.label || 'input'} down`" @click="move(calc.inputs, i, 1)">↓</button>
          <button class="btn-link" type="button" :aria-label="`Remove ${input.label || 'input'}`" @click="remove(calc.inputs, i)">Remove</button>
        </div>
      </div>
      <p v-if="err('inputs')" class="field-error">{{ err('inputs') }}</p>
      <button class="btn btn-secondary add" type="button" :disabled="calc.inputs.length >= 20" @click="addInput">Add input</button>
    </fieldset>

    <fieldset class="group">
      <legend>Results</legend>
      <p class="muted small">
        Worked out in order. A formula uses keys with + − * / ^ and ( ), and {{ CALC_FUNCTIONS.join(', ') }}: e.g. <code>round(water * per_litre, 1)</code>.
      </p>
      <div v-for="(r, i) in calc.results" :key="i" class="item">
        <div class="item-fields">
          <div class="field grow">
            <label :for="id(`out-${i}-label`)">Label<span class="req" aria-hidden="true">*</span></label>
            <input :id="id(`out-${i}-label`)" :value="r.label" aria-required="true" maxlength="60" :aria-invalid="!!err(`results.${i}.label`)" @input="setLabel(r, ($event.target as HTMLInputElement).value)" />
            <p v-if="err(`results.${i}.label`)" class="field-error">{{ err(`results.${i}.label`) }}</p>
          </div>
          <div class="field key">
            <label :for="id(`out-${i}-key`)">Key<span class="req" aria-hidden="true">*</span></label>
            <input :id="id(`out-${i}-key`)" v-model="r.key" class="mono" aria-required="true" maxlength="32" spellcheck="false" autocapitalize="off" :aria-invalid="!!err(`results.${i}.key`)" />
            <p v-if="err(`results.${i}.key`)" class="field-error">{{ err(`results.${i}.key`) }}</p>
          </div>
          <div class="field formula">
            <label :for="id(`out-${i}-formula`)">Formula<span class="req" aria-hidden="true">*</span></label>
            <input
              :id="id(`out-${i}-formula`)"
              v-model="r.formula"
              class="mono"
              aria-required="true"
              maxlength="300"
              spellcheck="false"
              autocapitalize="off"
              :aria-invalid="!!err(`results.${i}.formula`)"
              :aria-describedby="id(`out-${i}-uses`)"
            />
            <p v-if="err(`results.${i}.formula`)" class="field-error">{{ err(`results.${i}.formula`) }}</p>
            <p :id="id(`out-${i}-uses`)" class="muted small">Can use: <code>{{ usable(i).join(', ') || '–' }}</code></p>
          </div>
          <div class="field unit">
            <label :for="id(`out-${i}-unit`)">Unit</label>
            <input :id="id(`out-${i}-unit`)" v-model="r.unit" maxlength="20" placeholder="g" />
          </div>
          <div class="field num">
            <label :for="id(`out-${i}-decimals`)">Decimals</label>
            <select :id="id(`out-${i}-decimals`)" v-model.number="r.decimals">
              <option v-for="d in MAX_DECIMALS + 1" :key="d" :value="d - 1">{{ d - 1 }}</option>
            </select>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn-link" type="button" :disabled="i === 0" :aria-label="`Move ${r.label || 'result'} up`" @click="move(calc.results, i, -1)">↑</button>
          <button class="btn-link" type="button" :disabled="i === calc.results.length - 1" :aria-label="`Move ${r.label || 'result'} down`" @click="move(calc.results, i, 1)">↓</button>
          <button class="btn-link" type="button" :aria-label="`Remove ${r.label || 'result'}`" @click="remove(calc.results, i)">Remove</button>
        </div>
      </div>
      <p v-if="err('results')" class="field-error">{{ err('results') }}</p>
      <button class="btn btn-secondary add" type="button" :disabled="calc.results.length >= 20" @click="addResult">Add result</button>
    </fieldset>

    <div v-if="calc.inputs.length && calc.results.length" class="preview">
      <p class="muted small">Preview</p>
      <NoteCalculator :block="preview" :note-id="`preview-${calc.id}`" :remember="false" />
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
.group {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.item-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.item-fields .field {
  min-width: 0;
}
.grow {
  flex: 2 1 10rem;
}
.key {
  flex: 1 1 8rem;
}
.formula {
  flex: 3 1 14rem;
}
.unit {
  flex: 0 1 6rem;
}
.num {
  flex: 0 1 6rem;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.item-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.add {
  align-self: flex-start;
}
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>

<script setup lang="ts">
// A calculator block in a note (docs/api/notes.md §3h): type into its inputs,
// read the results (lib/calc.ts). Anyone can use it, viewers too; what's
// typed is remembered on this device only (per note and block), never saved
// to the note. The editor's preview passes remember=false.
import { computed, reactive, watch } from 'vue';
import type { NoteCalculatorBlock } from '../api/types';
import { formatCalc, parseCalcNumber, runCalculator } from '../lib/calc';
import { forgetView, recallView, rememberView } from '../lib/listSort';

const props = withDefaults(defineProps<{ block: NoteCalculatorBlock; noteId: string; remember?: boolean }>(), { remember: true });

const storageKey = () => `notes.calc.${props.noteId}.${props.block.id}`;
const defaults = () => Object.fromEntries(props.block.inputs.map((i) => [i.key, `${i.value}`]));

// What's typed, by input key: the defaults, then what this device remembers.
const typed = reactive<Record<string, string>>({});
function fill(): void {
  for (const k of Object.keys(typed)) delete typed[k];
  Object.assign(typed, defaults());
  if (!props.remember) return;
  try {
    const saved: unknown = JSON.parse(recallView(storageKey()) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) if (k in typed && typeof v === 'string') typed[k] = v;
    }
  } catch {
    // Unreadable: the defaults.
  }
}
// The editor's preview changes the block as it's edited: start again from its defaults.
watch(() => JSON.stringify(props.block.inputs), fill, { immediate: true });

const changed = computed(() => props.block.inputs.some((i) => (typed[i.key] ?? '').trim() !== `${i.value}`));
watch(typed, () => {
  if (!props.remember) return;
  if (changed.value) rememberView(storageKey(), JSON.stringify(typed));
  else forgetView(storageKey());
});
function reset(): void {
  Object.assign(typed, defaults());
}

const values = computed(() => Object.fromEntries(props.block.inputs.map((i) => [i.key, parseCalcNumber(typed[i.key] ?? '')])));
const results = computed(() => {
  const outcomes = runCalculator(props.block, values.value);
  return props.block.results.map((r, i) => ({ ...r, outcome: outcomes[i]! }));
});
const idFor = (key: string) => `calc-${props.noteId}-${props.block.id}-${key}`;
</script>

<template>
  <section class="calc" :aria-label="block.title || 'Calculator'">
    <div class="calc-head">
      <h4 v-if="block.title">{{ block.title }}</h4>
      <button v-if="changed" class="btn-link small" type="button" @click="reset">Reset</button>
    </div>
    <div class="rows">
      <div v-for="input in block.inputs" :key="input.key" class="row">
        <label :for="idFor(input.key)">{{ input.label }}</label>
        <span class="value">
          <input
            :id="idFor(input.key)"
            v-model="typed[input.key]"
            class="number"
            inputmode="decimal"
            autocomplete="off"
            :aria-invalid="values[input.key] === null"
          />
          <span v-if="input.unit" class="unit muted">{{ input.unit }}</span>
        </span>
      </div>
    </div>
    <div class="rows results" aria-live="polite">
      <div v-for="r in results" :key="r.key" class="row">
        <span>{{ r.label }}</span>
        <span v-if="r.outcome.error === null" class="value">
          <strong>{{ formatCalc(r.outcome.value, r.decimals) }}</strong>
          <span v-if="r.unit" class="unit muted">{{ r.unit }}</span>
        </span>
        <span v-else class="value error small">{{ r.outcome.error }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calc {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.calc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.calc-head:empty {
  display: none;
}
h4 {
  margin: 0;
  font-size: 0.95rem;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.results {
  border-top: 1px solid var(--border);
  padding-top: var(--space-2);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}
.value {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  margin-left: auto;
  text-align: right;
}
.number {
  width: 6.5rem;
  text-align: right;
}
.unit {
  white-space: nowrap;
}
.error {
  color: var(--danger);
}
.small {
  font-size: 0.85rem;
}
</style>

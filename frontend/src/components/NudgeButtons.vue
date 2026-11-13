<script setup lang="ts">
// A row of −/+ buttons under a weight box: a tap fixes an over- or
// undershot amount instead of retyping it. The small steps sit on the
// outside, e.g. −1 −5 +5 +1.
import { computed } from 'vue';
import { formatGrams, nudgeGrams } from '../lib/format';

const model = defineModel<string>({ required: true });
const props = defineProps<{
  steps: readonly number[]; // positive steps, smallest first: [1, 5]
  label: string; // the group's name for screen readers, "Adjust the water"
}>();

const deltas = computed(() => [...props.steps.map((s) => -s), ...[...props.steps].reverse()]);
const hasValue = computed(() => model.value.trim() !== '' && Number.isFinite(Number(model.value.replace(',', '.'))));
</script>

<template>
  <div class="nudge" role="group" :aria-label="label">
    <button
      v-for="d in deltas"
      :key="d"
      class="btn btn-secondary"
      type="button"
      :aria-label="`${d < 0 ? 'Remove' : 'Add'} ${formatGrams(Math.abs(d))} g`"
      :disabled="d < 0 && !hasValue"
      @click="model = nudgeGrams(model, d)"
    >{{ d < 0 ? '−' : '+' }}{{ formatGrams(Math.abs(d)) }}</button>
  </div>
</template>

<style scoped>
.nudge {
  display: flex;
  gap: var(--space-1);
}
.nudge .btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 0 var(--space-1);
  font-variant-numeric: tabular-nums;
}
</style>

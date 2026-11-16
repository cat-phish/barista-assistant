<script setup lang="ts">
// A row of −/+ buttons under a brew-log box: a tap fixes an over- or
// undershot amount instead of retyping it. The small steps sit on the
// outside, e.g. −1 −5 +5 +1. Which fields get them is the person's choice
// (Settings → Brew setup, docs/api/auth.md §1 nudgeButtons); how a tap
// changes the text is lib/nudge.ts. On an empty box with an expected value
// the buttons show greyed and the first tap fills it in, then steps.
import { computed } from 'vue';
import { nudgeMode, nudgeText, type NudgeSpec } from '../lib/nudge';

const model = defineModel<string>({ required: true });
const props = defineProps<{
  spec: NudgeSpec; // steps, unit and text format (nudgeSpec)
  label: string; // the group's name for screen readers, "Adjust the water"
  expected?: number | null; // filled in by the first tap on an empty box
}>();

const buttons = computed(() =>
  [...props.spec.steps.map((s) => -s), ...[...props.spec.steps].reverse()].map((d) => ({
    d,
    mode: nudgeMode(model.value, props.spec, props.expected, d),
    text: `${d < 0 ? '−' : '+'}${props.spec.stepText(Math.abs(d))}`,
    aria: `${d < 0 ? 'Remove' : 'Add'} ${props.spec.stepText(Math.abs(d))}${props.spec.unit && props.spec.unit !== 's' ? ` ${props.spec.unit}` : ''}`,
  })),
);

function tap(d: number): void {
  const next = nudgeText(model.value, props.spec, d, props.expected);
  if (next !== null) model.value = next;
}
</script>

<template>
  <div class="nudge" role="group" :aria-label="label">
    <button
      v-for="b in buttons"
      :key="b.d"
      class="btn btn-secondary"
      :class="{ pending: b.mode === 'expected' }"
      type="button"
      :aria-label="b.aria"
      :disabled="b.mode === 'off'"
      @click="tap(b.d)"
    >{{ b.text }}</button>
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
/* Empty box with an expected value: looks off until the first tap fills it. */
.nudge .btn.pending {
  opacity: 0.5;
}
</style>

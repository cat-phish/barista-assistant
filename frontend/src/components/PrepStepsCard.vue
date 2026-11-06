<script setup lang="ts">
// "Before you start" on brew setup (docs/api/recipes.md §5, prep steps): the
// recipe's prep steps as a checklist. A timed one has its own countdown,
// which doesn't start the brew's timer; at 0 it ticks itself. Nothing is
// saved, and ticking is optional. Remounted for each recipe (keyed by it).
import { computed, onUnmounted, reactive, ref } from 'vue';
import type { StepFields } from '../api/types';
import { formatTime } from '../lib/format';
import { prepLeft, stepTitle } from '../lib/steps';

const props = defineProps<{ steps: StepFields[] }>();

const ticked = reactive(new Set<number>());
const started = reactive(new Map<number, number>()); // step index -> when its countdown started (ms)
const now = ref(Date.now());
const announcement = ref('');
let interval: ReturnType<typeof setInterval> | null = null;

function left(i: number): number {
  const at = started.get(i);
  const sec = props.steps[i]?.durationSec ?? 0;
  return at === undefined ? sec : prepLeft(at, sec, now.value);
}
function tick(): void {
  now.value = Date.now();
  for (const i of [...started.keys()]) {
    if (left(i) > 0) continue;
    started.delete(i);
    ticked.add(i);
    announcement.value = `${stepTitle(props.steps[i] as StepFields)}: done`;
  }
  if (!started.size && interval) {
    clearInterval(interval);
    interval = null;
  }
}
// Start, or stop (back to its full time).
function toggleCountdown(i: number): void {
  if (started.has(i)) {
    started.delete(i);
    return;
  }
  now.value = Date.now();
  started.set(i, now.value);
  interval ??= setInterval(tick, 250);
}
function setTicked(i: number, on: boolean): void {
  if (on) ticked.add(i);
  else ticked.delete(i);
}
const allDone = computed(() => props.steps.length > 0 && ticked.size === props.steps.length);
onUnmounted(() => {
  if (interval) clearInterval(interval);
});
</script>

<template>
  <section class="card stack" aria-labelledby="prep-steps-title">
    <h2 id="prep-steps-title">Before you start</h2>
    <ul class="prep-steps">
      <li v-for="(s, i) in props.steps" :key="i" class="prep-step">
        <label class="checkbox">
          <input type="checkbox" :checked="ticked.has(i)" @change="setTicked(i, ($event.target as HTMLInputElement).checked)" />
          <span :class="{ done: ticked.has(i) }">{{ stepTitle(s) }}</span>
        </label>
        <button
          v-if="s.durationSec"
          class="btn btn-secondary countdown"
          :class="{ running: started.has(i) }"
          type="button"
          :aria-label="started.has(i) ? `Stop the ${stepTitle(s)} countdown, ${formatTime(left(i))} left` : `Start a ${formatTime(s.durationSec)} countdown for ${stepTitle(s)}`"
          @click="toggleCountdown(i)"
        >
          {{ started.has(i) ? `${formatTime(left(i))} · Stop` : `Start ${formatTime(s.durationSec)}` }}
        </button>
      </li>
    </ul>
    <p class="muted small">{{ allDone ? 'All set: start when you’re ready.' : 'Optional; the brew timer starts with Start.' }}</p>
    <span class="visually-hidden" aria-live="polite">{{ announcement }}</span>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
  margin: 0;
}
p {
  margin: 0;
}
.prep-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.prep-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.prep-step .checkbox {
  min-width: 0;
}
.done {
  text-decoration: line-through;
  color: var(--text-muted);
}
.countdown {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.countdown.running {
  background: var(--brand-tint);
}
</style>

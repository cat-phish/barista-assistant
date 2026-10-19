<script setup lang="ts">
// Brew timer, per docs/timer_architecture.md §3:
//  - Never increments a counter: elapsed time is always Date.now() - startTime,
//    recomputed in a requestAnimationFrame loop (accurate even if frames drop
//    or the tab is backgrounded).
//  - Holds a screen wake lock while running; released when finished or unmounted.
//  - Clock-driven steps: what's shown comes from timerPhase(steps, elapsed)
//    (current step, waiting in gaps, finishing after the last step). Finish &
//    Save is available throughout. No steps = plain stopwatch.
import { computed, onUnmounted, ref } from 'vue';
import type { RecipeStep } from '../api/types';
import { formatGrams, formatTime } from '../lib/format';
import { finishStatus, pourAmounts, stepTitle, STEP_TYPES, timerPhase } from '../lib/steps';

const props = defineProps<{
  recipeName: string;
  beanName: string;
  targetDose: number;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  steps: RecipeStep[];
}>();

const emit = defineEmits<{
  (e: 'complete', actualTimeSec: number): void;
}>();

const isRunning = ref(false);
const startTime = ref(0);
const elapsedMs = ref(0);
let animationFrameId: number | null = null;
let wakeLock: WakeLockSentinel | null = null;

const elapsedSec = computed(() => elapsedMs.value / 1000);
const formattedTime = computed(() => formatTime(Math.floor(elapsedSec.value)));
const phase = computed(() => timerPhase(props.steps, elapsedSec.value));
const amounts = computed(() => pourAmounts(props.steps));

// Progress through the current step's window.
const progress = computed(() => {
  const p = phase.value;
  if (p.kind !== 'step') return 0;
  const span = Math.max(0.001, p.endsAt - p.step.startSec);
  return Math.min(1, Math.max(0, (elapsedSec.value - p.step.startSec) / span));
});
// The step after the current one, for the "Up next" preview.
const upNext = computed(() => (phase.value.kind === 'step' ? props.steps[phase.value.index + 1] : undefined));

function pourText(step: RecipeStep, amount: number | null | undefined): string | null {
  if (step.targetWaterGrams === null) return null;
  return `Pour to ${formatGrams(step.targetWaterGrams)} g${amount != null ? ` (+${formatGrams(amount)} g)` : ''}`;
}

// "Target 2:45–3:15 · in 0:40" / "· in the window" / "· 0:12 over"
const finishNote = computed(() => finishStatus(props.expectedFinishMinSec, props.expectedFinishMaxSec, elapsedSec.value));
const finishLate = computed(() => props.expectedFinishMaxSec !== null && elapsedSec.value > props.expectedFinishMaxSec);

const tick = () => {
  if (!isRunning.value) return;
  elapsedMs.value = Date.now() - startTime.value;
  animationFrameId = requestAnimationFrame(tick);
};

const requestWakeLock = async () => {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake Lock request failed:', err);
  }
};

const releaseWakeLock = async () => {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
};

const startTimer = async () => {
  startTime.value = Date.now() - elapsedMs.value;
  isRunning.value = true;
  await requestWakeLock();
  animationFrameId = requestAnimationFrame(tick);
};

const finishBrew = async () => {
  isRunning.value = false;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  elapsedMs.value = Date.now() - startTime.value; // exact at the moment of the tap
  await releaseWakeLock();
  emit('complete', Math.floor(elapsedMs.value / 1000));
};

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  void releaseWakeLock();
});
</script>

<template>
  <div class="timer-container">
    <header class="timer-header">
      <h2>{{ recipeName }}</h2>
      <p class="subtitle">{{ beanName }} • {{ formatGrams(targetDose) }}g dose</p>
    </header>

    <div class="clock-display" role="timer" aria-live="off">
      <span class="time">{{ formattedTime }}</span>
    </div>

    <!-- Current step -->
    <div v-if="phase.kind === 'step'" class="step-card active-step" :class="`type-${phase.step.stepType}`">
      <span class="label">Step {{ phase.index + 1 }} of {{ steps.length }} · {{ STEP_TYPES[phase.step.stepType].label }}</span>
      <h3 aria-live="polite">{{ stepTitle(phase.step) }}</h3>
      <div class="step-metrics">
        <div v-if="pourText(phase.step, phase.amount)" class="metric">
          <span class="label">Target Weight</span>
          <span class="value">{{ pourText(phase.step, phase.amount) }}</span>
        </div>
        <div class="metric">
          <span class="label">Until</span>
          <span class="value">{{ formatTime(phase.endsAt) }}</span>
        </div>
      </div>
      <div class="progress" aria-hidden="true"><span :style="{ width: `${progress * 100}%` }" /></div>
    </div>

    <!-- Gap between steps -->
    <div v-else-if="phase.kind === 'wait'" class="step-card wait-card">
      <span class="label">Wait</span>
      <h3 aria-live="polite">{{ isRunning || elapsedMs > 0 ? `Next in ${formatTime(Math.ceil(phase.startsIn))}` : 'Ready' }}</h3>
      <p class="next-line">
        {{ stepTitle(phase.next) }} at {{ formatTime(phase.next.startSec) }}<template v-if="pourText(phase.next, amounts[phase.nextIndex])"> · {{ pourText(phase.next, amounts[phase.nextIndex]) }}</template>
      </p>
    </div>

    <!-- After the last step -->
    <div v-else-if="phase.kind === 'done'" class="step-card done-card">
      <span class="label">All steps done</span>
      <h3 aria-live="polite">Drawdown / finishing</h3>
    </div>

    <div v-if="upNext" class="step-card next-step">
      <span class="label">Up Next:</span>
      <span>{{ stepTitle(upNext) }} at {{ formatTime(upNext.startSec) }}<template v-if="upNext.targetWaterGrams !== null"> · to {{ formatGrams(upNext.targetWaterGrams) }}g</template></span>
    </div>

    <p v-if="finishNote" class="finish-note" :class="{ late: finishLate }">{{ finishNote }}</p>

    <div class="controls">
      <button v-if="!isRunning && elapsedMs === 0" @click="startTimer" class="btn primary">
        Start Brew
      </button>
      <button v-else-if="isRunning" @click="finishBrew" class="btn success">
        Finish & Save
      </button>
    </div>
  </div>
</template>

<style scoped>
.timer-container {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  /* The reference adds 1.5rem padding; the page around it already pads, and
     doubling it narrowed the timer on phones. */
  padding: 0;
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
}
.timer-header h2 {
  font-size: 1.4rem;
}
.subtitle {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
}
.clock-display {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  background: #f5f5f5;
  border-radius: 12px;
  border: 1px solid var(--border);
}
.time {
  font-size: 4rem;
  font-variant-numeric: tabular-nums;
  font-weight: bold;
  color: #3e2723;
}
.step-card {
  padding: 1rem;
  border-radius: 8px;
  background: white;
  border: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.step-card h3 {
  margin: 0;
  font-size: 1.3rem;
}
.active-step {
  border-left: 4px solid #3e2723;
}
.active-step.type-swirl,
.active-step.type-stir,
.active-step.type-press {
  border-left-color: #8d6e63;
}
.wait-card {
  border-left: 4px solid var(--border);
  background: var(--bg);
}
.done-card {
  border-left: 4px solid #2e7d32;
}
.next-line {
  margin: 0;
  color: var(--text-muted);
}
.next-step {
  opacity: 0.7;
  font-size: 0.9rem;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.step-metrics {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.75rem;
}
.metric {
  display: flex;
  flex-direction: column;
}
.label {
  font-size: 0.8rem;
  color: #757575;
  text-transform: uppercase;
}
.value {
  font-size: 1.2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.progress {
  margin-top: 0.75rem;
  height: 6px;
  border-radius: 3px;
  background: var(--brand-tint);
  overflow: hidden;
}
.progress span {
  display: block;
  height: 100%;
  background: var(--brand);
}
.finish-note {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.finish-note.late {
  color: var(--danger);
}
.controls button {
  width: 100%;
  padding: 1rem;
  font-size: 1.2rem;
  border-radius: 8px;
  border: none;
  font-weight: bold;
  cursor: pointer;
  touch-action: manipulation;
  min-height: var(--tap);
}
.btn.primary { background: #3e2723; color: white; }
.btn.success { background: #2e7d32; color: white; }
</style>

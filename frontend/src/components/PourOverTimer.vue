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
import { finishStatus, formatFinishWindow, pourAmounts, stepTitle, STEP_TYPES, timerPhase } from '../lib/steps';

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

// Progress through the current phase's window (step, wait gap, or finishing).
// Finishing runs to the end of the target window if there is one, else full.
const progress = computed(() => {
  const p = phase.value;
  if (p.kind === 'idle') return 0;
  const to = p.to ?? props.expectedFinishMaxSec;
  if (to === null || to <= p.from) return p.kind === 'done' ? 1 : 0;
  return Math.min(1, Math.max(0, (elapsedSec.value - p.from) / (to - p.from)));
});

const prevStep = computed(() => (phase.value.kind === 'idle' || phase.value.prevIndex === null ? null : props.steps[phase.value.prevIndex] ?? null));
// During a wait, "Up next" is the step being waited for.
const nextStep = computed(() => (phase.value.kind === 'idle' || phase.value.nextIndex === null ? null : props.steps[phase.value.nextIndex] ?? null));

// One-line summary for the Previous / Up next cards.
function sideText(step: RecipeStep): string {
  const i = props.steps.indexOf(step);
  const water = step.targetWaterGrams !== null ? ` · to ${formatGrams(step.targetWaterGrams)} g` : '';
  return `${stepTitle(step)} · ${formatTime(step.startSec)}${step.endSec !== step.startSec ? `–${formatTime(step.endSec)}` : ''}${water}${i >= 0 && amounts.value[i] != null ? ` (+${formatGrams(amounts.value[i]!)} g)` : ''}`;
}
const started = computed(() => isRunning.value || elapsedMs.value > 0);

function pourValue(step: RecipeStep, amount: number | null | undefined): string {
  if (step.targetWaterGrams === null) return 'No pour';
  return `${formatGrams(step.targetWaterGrams)} g${amount != null ? ` (+${formatGrams(amount)})` : ''}`;
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
      <p v-if="finishNote" class="finish-note" :class="{ late: finishLate }">{{ finishNote }}</p>
    </div>

    <!-- Right under the clock, so the step cards below stay on screen. -->
    <div class="controls">
      <button v-if="!isRunning && elapsedMs === 0" @click="startTimer" class="btn primary">
        Start Brew
      </button>
      <button v-else-if="isRunning" @click="finishBrew" class="btn success">
        Finish & Save
      </button>
    </div>

    <template v-if="phase.kind !== 'idle'">
      <div class="step-card side" aria-label="Previous step">
        <span class="label">Previous</span>
        <span class="side-text" :class="{ none: !prevStep }">{{ prevStep ? sideText(prevStep) : 'None' }}</span>
      </div>

      <!-- Same structure for every phase so the layout doesn't jump. -->
      <div class="step-card current" :class="`phase-${phase.kind}${phase.kind === 'step' ? ` type-${phase.step.stepType}` : ''}`">
        <template v-if="phase.kind === 'step'">
          <span class="label">Step {{ phase.index + 1 }} of {{ steps.length }} · {{ STEP_TYPES[phase.step.stepType].label }}</span>
          <h3 aria-live="polite">{{ stepTitle(phase.step) }}</h3>
          <div class="step-metrics">
            <div class="metric">
              <span class="label">{{ phase.step.targetWaterGrams !== null ? 'Pour to' : 'Water' }}</span>
              <span class="value">{{ pourValue(phase.step, phase.amount) }}</span>
            </div>
            <div class="metric right">
              <span class="label">Until</span>
              <span class="value">{{ formatTime(phase.endsAt) }}</span>
            </div>
          </div>
        </template>
        <template v-else-if="phase.kind === 'wait'">
          <span class="label">Wait</span>
          <h3 aria-live="polite">{{ started ? `Next in ${formatTime(Math.ceil(phase.startsIn))}` : 'Ready' }}</h3>
          <div class="step-metrics">
            <div class="metric">
              <span class="label">Next step</span>
              <span class="value">{{ stepTitle(phase.next) }}</span>
            </div>
            <div class="metric right">
              <span class="label">Starts at</span>
              <span class="value">{{ formatTime(phase.next.startSec) }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <span class="label">All steps done</span>
          <h3 aria-live="polite">Drawdown / finishing</h3>
          <div class="step-metrics">
            <div class="metric">
              <span class="label">Last step ended</span>
              <span class="value">{{ formatTime(phase.from) }}</span>
            </div>
            <div class="metric right">
              <span class="label">Target finish</span>
              <span class="value">{{ formatFinishWindow(expectedFinishMinSec, expectedFinishMaxSec) ?? '–' }}</span>
            </div>
          </div>
        </template>
        <div class="progress" aria-hidden="true"><span :style="{ width: `${progress * 100}%` }" /></div>
      </div>

      <div class="step-card side" aria-label="Next step">
        <span class="label">Up next</span>
        <span class="side-text" :class="{ none: !nextStep }">{{ nextStep ? sideText(nextStep) : 'None' }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.timer-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.25rem;
  padding: 1rem;
  background: #f5f5f5;
  border-radius: 12px;
  border: 1px solid var(--border);
}
.time {
  font-size: 3.75rem;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  font-weight: bold;
  color: #3e2723;
}
.step-card {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: white;
  border: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.step-card h3 {
  margin: 0;
  font-size: 1.3rem;
}
/* Current phase: fixed height so step -> wait -> step doesn't shift the page. */
.current {
  min-height: 9.25rem;
  border-left: 4px solid #3e2723;
}
.current.type-swirl,
.current.type-stir,
.current.type-press {
  border-left-color: #8d6e63;
}
/* Doing something = warm tint; waiting = plain white, so the two read differently. */
.current.phase-step {
  background: var(--brand-tint);
  border-top-color: #d7ccc8;
  border-right-color: #d7ccc8;
  border-bottom-color: #d7ccc8;
}
.phase-step .progress {
  background: #d7ccc8;
}
.current.phase-wait {
  background: var(--surface);
  border-left-color: #bcaaa4;
}
/* The step being waited for is also in "Up next", so keep it quiet here. */
.phase-wait .metric:not(.right) .value {
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-muted);
}
.current.phase-done {
  border-left-color: #2e7d32;
}
.side {
  font-size: 0.9rem;
  flex-direction: row;
  align-items: baseline;
  gap: 0.5rem;
  min-height: 2.75rem;
  background: var(--bg);
}
.side .label {
  flex-shrink: 0;
  min-width: 4.5rem;
}
.side-text {
  color: var(--text);
}
.side-text.none {
  color: var(--text-muted);
  font-style: italic;
}
.step-metrics {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.5rem 0 0.6rem;
}
.metric {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.metric.right {
  text-align: right;
}
.label {
  font-size: 0.75rem;
  color: #757575;
  text-transform: uppercase;
}
.value {
  font-size: 1.15rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* Pinned to the card's bottom so it sits in the same place in every phase. */
.progress {
  margin-top: auto;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--brand-tint);
}
.progress span {
  display: block;
  height: 100%;
  background: var(--brand);
}
.phase-wait .progress span {
  background: #a1887f;
}
.finish-note {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
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

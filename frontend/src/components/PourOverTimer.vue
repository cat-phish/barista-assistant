<script setup lang="ts">
// Pour-over timer, per docs/timer_architecture.md §3:
//  - Never increments a counter: elapsed time is always Date.now() - startTime,
//    recomputed in a requestAnimationFrame loop (accurate even if frames drop
//    or the tab is backgrounded).
//  - Holds a screen wake lock while running; released when finished or unmounted.
// Differences from the reference: target times are formatted m:ss (the
// reference printed "0:" + seconds, so 135 s showed as "0:135"), and a recipe
// without steps (e.g. espresso) works as a plain stopwatch.
import { computed, onUnmounted, ref } from 'vue';
import { formatGrams, formatTime } from '../lib/format';

export interface TimerStep {
  stepOrder: number;
  actionName: string;
  targetTimeSec: number;
  targetWaterGrams: number;
}

const props = defineProps<{
  recipeName: string;
  beanName: string;
  targetDose: number;
  steps: TimerStep[];
}>();

const emit = defineEmits<{
  (e: 'complete', actualTimeSec: number): void;
}>();

const isRunning = ref(false);
const startTime = ref(0);
const elapsedMs = ref(0);
const currentStepIndex = ref(0);
let animationFrameId: number | null = null;
let wakeLock: WakeLockSentinel | null = null;

const currentStep = computed(() => props.steps[currentStepIndex.value]);
const nextStepPreview = computed(() => props.steps[currentStepIndex.value + 1]);

const formattedTime = computed(() => formatTime(Math.floor(elapsedMs.value / 1000)));

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

const advanceStep = () => {
  if (currentStepIndex.value < props.steps.length - 1) {
    currentStepIndex.value++;
  }
};

const finishBrew = async () => {
  isRunning.value = false;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  elapsedMs.value = Date.now() - startTime.value; // exact at the moment of the tap
  await releaseWakeLock();
  emit('complete', Math.floor(elapsedMs.value / 1000));
};

// Seconds into the current step's window, for the progress bar.
const stepProgress = computed(() => {
  const step = currentStep.value;
  if (!step) return 0;
  const prevEnd = props.steps[currentStepIndex.value - 1]?.targetTimeSec ?? 0;
  const span = Math.max(1, step.targetTimeSec - prevEnd);
  return Math.min(1, Math.max(0, (elapsedMs.value / 1000 - prevEnd) / span));
});
const overTime = computed(() => !!currentStep.value && elapsedMs.value / 1000 > currentStep.value.targetTimeSec);

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

    <div v-if="currentStep" class="step-card active-step" :class="{ late: overTime && isRunning }">
      <h3>{{ currentStep.actionName }}</h3>
      <div class="step-metrics">
        <div class="metric">
          <span class="label">Target Weight</span>
          <span class="value">{{ formatGrams(currentStep.targetWaterGrams) }}g</span>
        </div>
        <div class="metric">
          <span class="label">Target Time</span>
          <span class="value">{{ formatTime(currentStep.targetTimeSec) }}</span>
        </div>
      </div>
      <div v-if="isRunning" class="progress" aria-hidden="true"><span :style="{ width: `${stepProgress * 100}%` }" /></div>
    </div>

    <div v-if="nextStepPreview" class="step-card next-step">
      <span class="label">Up Next:</span>
      <span>{{ nextStepPreview.actionName }} to {{ formatGrams(nextStepPreview.targetWaterGrams) }}g</span>
    </div>

    <div class="controls">
      <button v-if="!isRunning && elapsedMs === 0" @click="startTimer" class="btn primary">
        Start Brew
      </button>
      <button v-else-if="isRunning && nextStepPreview" @click="advanceStep" class="btn secondary">
        Next Step
      </button>
      <button v-else-if="isRunning && !nextStepPreview" @click="finishBrew" class="btn success">
        Finish & Save
      </button>
    </div>
  </div>
</template>

<style scoped>
.timer-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
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
}
.step-card h3 {
  margin: 0;
}
.active-step {
  border-left: 4px solid #3e2723;
}
.active-step.late {
  border-left-color: var(--danger);
}
.next-step {
  opacity: 0.7;
  font-size: 0.9rem;
  display: flex;
  gap: 0.5rem;
}
.step-metrics {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
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
.btn.secondary { background: #e0e0e0; color: #333; }
.btn.success { background: #2e7d32; color: white; }
</style>

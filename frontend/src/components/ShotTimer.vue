<script setup lang="ts">
// Espresso shot timer (docs/timer_architecture.md, "Shot timer"). Same clock
// mechanics as PourOverTimer: elapsed = Date.now() - startTime in a rAF loop,
// screen wake lock while running. Taps (first drop, end of a manual
// pre-infusion) become marks, emitted with the time on Finish & Save.
import { computed, onUnmounted, ref } from 'vue';
import type { Mark, Preinfusion } from '../api/types';
import { formatGrams, formatTime } from '../lib/format';
import { formatMark, shotState, withMark, type ShotPlan } from '../lib/shot';
import { finishStatus, formatFinishWindow } from '../lib/steps';

const props = defineProps<{
  recipeName: string;
  beanName: string;
  dose: number;
  targetYield: number;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  plan: ShotPlan;
  // The chosen machine's pre-infusion capability; null = no machine chosen.
  machinePreinfusion: Preinfusion | null;
}>();

const emit = defineEmits<{
  (e: 'complete', actualTimeSec: number, marks: Mark[]): void;
}>();

const isRunning = ref(false);
const startTime = ref(0);
const elapsedMs = ref(0);
const marks = ref<Mark[]>([]);
let animationFrameId: number | null = null;
let wakeLock: WakeLockSentinel | null = null;

const elapsedSec = computed(() => elapsedMs.value / 1000);
const formattedTime = computed(() => formatTime(Math.floor(elapsedSec.value)));
const state = computed(() => shotState(props.plan, props.machinePreinfusion, elapsedSec.value, marks.value));
const finishNote = computed(() => finishStatus(props.expectedFinishMinSec, props.expectedFinishMaxSec, elapsedSec.value));
const finishLate = computed(() => props.expectedFinishMaxSec !== null && elapsedSec.value > props.expectedFinishMaxSec);
const firstDropWindow = computed(() => (props.plan.firstDrop ? formatFinishWindow(props.plan.firstDrop.min, props.plan.firstDrop.max) : null));

const VERDICTS = { early: 'early', in_window: 'in the window', late: 'late' } as const;

function mark(kind: Mark['kind']): void {
  if (!isRunning.value) return;
  marks.value = withMark(marks.value, kind, (Date.now() - startTime.value) / 1000);
}

// What the pre-infusion card says.
const preinfusionTitle = computed(() => {
  const p = state.value.preinfusion;
  if (!p) return '';
  const left = formatTime(Math.max(0, Math.ceil(p.endsAt - elapsedSec.value)));
  if (p.status === 'skipped') return 'This machine has no pre-infusion';
  if (p.status === 'done') return p.endedAt !== null ? `Full pressure at ${formatMark(p.endedAt)}` : 'Done';
  if (p.status === 'due') return 'Full pressure now';
  return p.mode === 'automatic' ? `Pre-infusing · ${left} left` : `Full pressure in ${left}`;
});
const preinfusionMode = computed(() => {
  const p = state.value.preinfusion;
  if (!p) return '';
  if (p.mode === 'none') return 'Off';
  if (p.mode === 'automatic') return 'Machine';
  return props.machinePreinfusion === null ? 'You (no machine chosen)' : 'You';
});

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
  const seconds = Math.floor(elapsedMs.value / 1000);
  // A mark can't be after the saved (whole-second) time.
  emit('complete', seconds, marks.value.map((m) => ({ ...m, atSec: Math.min(m.atSec, seconds) })));
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
      <p class="subtitle">{{ beanName }} • {{ formatGrams(dose) }} g → {{ formatGrams(targetYield) }} g</p>
    </header>

    <div class="clock-display" role="timer" aria-live="off">
      <span class="time">{{ formattedTime }}</span>
      <p v-if="finishNote" class="finish-note" :class="{ late: finishLate }">{{ finishNote }}</p>
    </div>

    <div class="controls">
      <button v-if="!isRunning && elapsedMs === 0" @click="startTimer" class="btn primary">Start shot</button>
      <button v-else-if="isRunning" @click="finishBrew" class="btn success">Finish & Save</button>
    </div>

    <div
      v-if="state.preinfusion"
      class="step-card"
      :class="`pi-${state.preinfusion.status}`"
      aria-label="Pre-infusion"
    >
      <span class="label">Pre-infusion · {{ preinfusionMode }}</span>
      <h3 aria-live="polite">{{ preinfusionTitle }}</h3>
      <button
        v-if="state.preinfusion.mode === 'manual' && isRunning && state.preinfusion.status !== 'done'"
        class="btn tap"
        :class="{ due: state.preinfusion.status === 'due' }"
        type="button"
        @click="mark('preinfusion_end')"
      >
        Full pressure
      </button>
      <div class="progress" aria-hidden="true"><span :style="{ width: `${state.preinfusion.progress * 100}%` }" /></div>
    </div>

    <div class="step-card" :class="`drop-${state.firstDrop.status}`" aria-label="First drop">
      <span class="label">First drop<template v-if="firstDropWindow"> · target {{ firstDropWindow }}</template></span>
      <h3 aria-live="polite">
        <template v-if="state.firstDrop.status === 'recorded' && state.firstDrop.at !== null">
          {{ formatMark(state.firstDrop.at) }}<template v-if="state.firstDrop.verdict"> · {{ VERDICTS[state.firstDrop.verdict] }}</template>
        </template>
        <template v-else-if="state.firstDrop.status === 'overdue'">Window passed · still watching</template>
        <template v-else>Tap when it starts</template>
      </h3>
      <button v-if="isRunning && state.firstDrop.status !== 'recorded'" class="btn tap" type="button" @click="mark('first_drop')">First drop</button>
      <button v-else-if="isRunning" class="btn-link small retap" type="button" @click="mark('first_drop')">Tap again to re-record</button>
      <div class="progress" aria-hidden="true"><span :style="{ width: `${state.firstDrop.progress * 100}%` }" /></div>
    </div>

    <div class="step-card side" aria-label="Target">
      <span class="label">Stop at</span>
      <span class="value">{{ formatGrams(targetYield) }} g</span>
    </div>
  </div>
</template>

<style scoped>
.timer-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
/* Same card language as the pour-over timer: warm tint = something to do now. */
.step-card {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid #e0e0e0;
  border-left: 4px solid #bcaaa4;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.step-card h3 {
  margin: 0;
  font-size: 1.2rem;
  font-variant-numeric: tabular-nums;
}
.pi-running,
.pi-due,
.drop-waiting,
.drop-overdue {
  background: var(--brand-tint);
  border-color: #d7ccc8;
  border-left-color: var(--brand);
}
.pi-due h3 {
  color: var(--brand);
}
.pi-done,
.drop-recorded {
  border-left-color: var(--success);
}
.pi-skipped {
  color: var(--text-muted);
}
.side {
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  border-left-color: #e0e0e0;
  background: var(--bg);
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
.progress {
  margin-top: 0.25rem;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: #d7ccc8;
}
.progress span {
  display: block;
  height: 100%;
  background: var(--brand);
}
.controls button,
.tap {
  width: 100%;
  padding: 0.85rem;
  font-size: 1.15rem;
  border-radius: 8px;
  border: none;
  font-weight: bold;
  cursor: pointer;
  touch-action: manipulation;
  min-height: var(--tap);
}
.btn.primary {
  background: #3e2723;
  color: white;
}
.btn.success {
  background: #2e7d32;
  color: white;
}
/* Big, easy targets for a thumb while watching the cup. */
.tap {
  background: var(--surface);
  color: var(--brand);
  border: 2px solid var(--brand);
}
.tap.due {
  background: var(--brand);
  color: white;
}
.retap {
  align-self: flex-start;
  margin-left: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
</style>

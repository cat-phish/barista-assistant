<script setup lang="ts">
// The brew timer for every recipe (docs/timer_architecture.md §3):
//  - Never increments a counter: elapsed = Date.now() - startTime, recomputed
//    in a requestAnimationFrame loop. Holds a screen wake lock while running.
//  - Steps run back to back (brewSchedule): each moves on after its time, on
//    Next, or (espresso) at First drop. Taps and "Log it" become marks,
//    emitted with the time on Finish & Save.
//  - Previous / Current / Up next cards with the same structure for every
//    step, so the layout doesn't jump. No steps = plain stopwatch.
import { computed, onUnmounted, ref } from 'vue';
import type { FlowUnit, MachineCapabilities, Mark, StepFields } from '../api/types';
import { formatTime } from '../lib/format';
import { firstDropVerdict, formatMark, withMark } from '../lib/marks';
import {
  brewSchedule,
  finishStatus,
  formatFinishWindow,
  machineNote,
  pourAmounts,
  stepInstruction,
  stepTitle,
  STEP_TYPES,
} from '../lib/steps';

const props = defineProps<{
  recipeName: string;
  subtitle: string; // "Bean • 15 g dose", or "Bean • 18 g → 36 g"
  steps: StepFields[];
  espresso: boolean;
  flowUnit: FlowUnit;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  firstDropWindow: { min: number; max: number } | null;
  machine: MachineCapabilities | null; // the espresso brewer's controls
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
const phase = computed(() =>
  brewSchedule(props.steps, elapsedSec.value, marks.value, { firstDropMax: props.firstDropWindow?.max ?? null, finishMax: props.expectedFinishMaxSec }),
);
const amounts = computed(() => pourAmounts(props.steps));
const progress = computed(() => {
  const p = phase.value;
  if (p.kind === 'idle') return 0;
  if (p.kind === 'done') return 1;
  if (p.to === null || p.to <= p.from) return 0;
  return Math.min(1, Math.max(0, (elapsedSec.value - p.from) / (p.to - p.from)));
});
const finishNote = computed(() => finishStatus(props.expectedFinishMinSec, props.expectedFinishMaxSec, elapsedSec.value));
const finishLate = computed(() => props.expectedFinishMaxSec !== null && elapsedSec.value > props.expectedFinishMaxSec);

const prevIndex = computed(() => (phase.value.kind === 'idle' ? null : phase.value.prevIndex));
const nextIndex = computed(() => (phase.value.kind === 'step' ? phase.value.nextIndex : null));
const stepEnd = (index: number) => marks.value.find((m) => m.kind === 'step_end' && m.stepOrder === index + 1)?.atSec ?? null;

// Previous / Up next: the instruction (shown bold) between the step's name and
// its length: "Pour · **Pour to 210 g (+90)** · 0:30", "Soak · **Pump off** · 0:10".
function sideParts(index: number): { title: string; instruction: string | null; how: string } {
  const step = props.steps[index]!;
  const how = step.advance === 'first_drop' ? 'until first drop' : step.advance === 'tap' ? 'until you tap' : step.durationSec === null ? 'until done' : formatTime(step.durationSec);
  return { title: stepTitle(step), instruction: stepInstruction(step, amounts.value[index] ?? null, props.flowUnit), how };
}
// "1:22", or "≈ 1:22" when the current step has no fixed end (it waits for a tap).
const nextStarts = computed(() => {
  const p = phase.value;
  if (p.kind !== 'step') return null;
  if (p.end !== null) return formatTime(Math.round(p.end));
  return p.guideEnd === null ? null : `≈ ${formatTime(Math.round(p.guideEnd))}`;
});

// Right-hand side of the current card: a countdown when the step has an end
// (or a guide), with a small line under it; otherwise how it ends.
const countdown = computed((): { big: string; small: string } => {
  const p = phase.value;
  if (p.kind !== 'step') return { big: '', small: '' };
  const left = (at: number) => formatTime(Math.max(0, Math.ceil(at - elapsedSec.value)));
  if (p.step.advance === 'first_drop') return { big: 'At first drop', small: '' };
  if (p.step.advance === 'tap') {
    if (p.due) return { big: 'Tap Next', small: 'when ready' };
    return p.guideEnd !== null ? { big: left(p.guideEnd), small: 'left (guide)' } : { big: 'Tap Next', small: 'when ready' };
  }
  return p.end === null ? { big: 'Until done', small: 'tap Finish' } : { big: left(p.end), small: 'left' };
});

const firstDropAt = computed(() => marks.value.find((m) => m.kind === 'first_drop')?.atSec ?? null);
const firstDropText = computed(() => {
  const at = firstDropAt.value;
  if (at === null) return null;
  const verdict = firstDropVerdict(at, props.firstDropWindow);
  return `First drop ${formatMark(at)}${verdict ? ` · ${verdict}` : ''}`;
});
const firstDropTarget = computed(() => (props.firstDropWindow ? formatFinishWindow(props.firstDropWindow.min, props.firstDropWindow.max) : null));

function record(kind: Mark['kind'], stepOrder: number | null = null): void {
  if (!isRunning.value) return;
  marks.value = withMark(marks.value, kind, (Date.now() - startTime.value) / 1000, stepOrder);
}

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
      <p class="subtitle">{{ subtitle }}</p>
    </header>

    <div class="clock-display" role="timer" aria-live="off">
      <span class="time">{{ formattedTime }}</span>
      <p v-if="finishNote" class="finish-note" :class="{ late: finishLate }">{{ finishNote }}</p>
    </div>

    <!-- Right under the clock, so the step cards below stay on screen. -->
    <div class="controls">
      <button v-if="!isRunning && elapsedMs === 0" @click="startTimer" class="btn primary">{{ espresso ? 'Start shot' : 'Start brew' }}</button>
      <button v-else-if="isRunning" @click="finishBrew" class="btn success">Finish & Save</button>
      <template v-if="espresso">
        <button v-if="isRunning && firstDropAt === null" class="btn tap drop" type="button" @click="record('first_drop')">First drop</button>
        <p v-else-if="firstDropText" class="drop-line" aria-live="polite">
          {{ firstDropText }}
          <button v-if="isRunning" class="btn-link small" type="button" @click="record('first_drop')">Re-record</button>
        </p>
        <p v-else-if="firstDropTarget" class="drop-line muted">First drop target {{ firstDropTarget }}</p>
      </template>
    </div>

    <template v-if="phase.kind !== 'idle'">
      <div class="step-card side" aria-label="Previous step">
        <span class="label">Previous</span>
        <span class="side-text" :class="{ none: prevIndex === null }">
          <template v-if="prevIndex !== null">
            {{ sideParts(prevIndex).title }}<template v-if="sideParts(prevIndex).instruction"> · <strong>{{ sideParts(prevIndex).instruction }}</strong></template> · {{ sideParts(prevIndex).how }}<template v-if="stepEnd(prevIndex) !== null"> · ended {{ formatMark(stepEnd(prevIndex)!) }}</template>
          </template>
          <template v-else>None</template>
        </span>
      </div>

      <!-- Same structure for every step so the layout doesn't jump. -->
      <div
        class="step-card current"
        :class="phase.kind === 'step' ? { waiting: STEP_TYPES[phase.step.stepType].waiting, due: phase.due } : 'phase-done'"
        aria-label="Current step"
      >
        <template v-if="phase.kind === 'step'">
          <span class="label">
            Step {{ phase.index + 1 }} of {{ steps.length }} · {{ STEP_TYPES[phase.step.stepType].label }}<template v-if="phase.step.targetTempC !== null"> · {{ phase.step.targetTempC }} °C</template>
          </span>
          <!-- What to do is the big line; the step's name is the small one under it. -->
          <div class="main-row">
            <h3 aria-live="polite">{{ stepInstruction(phase.step, phase.amount, flowUnit) ?? stepTitle(phase.step) }}</h3>
            <span class="count" :class="{ text: !/^\d/.test(countdown.big) }" aria-live="off">{{ countdown.big }}</span>
          </div>
          <div class="sub-row">
            <span>{{ stepInstruction(phase.step, phase.amount, flowUnit) ? stepTitle(phase.step) : '' }}</span>
            <span>{{ countdown.small }}</span>
          </div>
          <p v-if="machineNote(phase.step, machine)" class="machine-note">{{ machineNote(phase.step, machine) }}</p>
          <button v-if="isRunning && phase.step.advance === 'tap'" class="btn tap" :class="{ due: phase.due }" type="button" @click="record('step_end', phase.index + 1)">
            Next
          </button>
          <template v-else-if="isRunning && phase.step.advance === 'auto_log'">
            <p v-if="stepEnd(phase.index) !== null" class="logged">Logged at {{ formatMark(stepEnd(phase.index)!) }}</p>
            <button v-else class="btn tap" type="button" @click="record('step_end', phase.index + 1)">Log it</button>
          </template>
        </template>
        <template v-else>
          <span class="label">All steps done</span>
          <h3 aria-live="polite">{{ espresso ? 'Finishing the shot' : 'Drawdown / finishing' }}</h3>
          <div class="step-metrics">
            <span class="value">Last step ended {{ formatTime(Math.round(phase.from)) }}</span>
            <span class="value right">{{ formatFinishWindow(expectedFinishMinSec, expectedFinishMaxSec) ?? '' }}</span>
          </div>
        </template>
        <div class="progress" aria-hidden="true"><span :style="{ width: `${progress * 100}%` }" /></div>
      </div>

      <div class="step-card side" aria-label="Next step">
        <span class="label">Up next</span>
        <span class="side-text" :class="{ none: nextIndex === null }">
          <template v-if="nextIndex !== null">
            {{ sideParts(nextIndex).title }}<template v-if="sideParts(nextIndex).instruction"> · <strong>{{ sideParts(nextIndex).instruction }}</strong></template> · {{ sideParts(nextIndex).how }}<template v-if="nextStarts"> · at {{ nextStarts }}</template>
          </template>
          <template v-else>None</template>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.timer-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  /* The page around it already pads; doubling it narrowed the timer on phones. */
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
.controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.controls > button,
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
/* Big, easy targets for a thumb while watching the cup. Two classes, so it
   beats ".controls > button" (which removes borders). */
.btn.tap {
  background: var(--surface);
  color: var(--brand);
  border: 2px solid var(--brand);
}
.btn.tap.due {
  background: var(--brand);
  color: white;
}
.drop-line {
  margin: 0;
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.drop-line.muted {
  font-weight: 400;
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
/* Current step: something to do = warm tint; waiting (wait, soak) = white. */
.current {
  min-height: 9.25rem;
  background: var(--brand-tint);
  border-color: #d7ccc8;
  border-left: 4px solid var(--brand);
}
.current.waiting {
  background: var(--surface);
  border-color: #e0e0e0;
  border-left-color: #bcaaa4;
}
.current.due h3,
.current.due .right {
  color: var(--brand);
}
.current.phase-done {
  background: var(--surface);
  border-color: #e0e0e0;
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
.side-text.none {
  color: var(--text-muted);
  font-style: italic;
}
.main-row,
.sub-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}
.main-row h3 {
  font-size: 1.45rem;
  line-height: 1.2;
}
.count {
  font-size: 1.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.count.text {
  font-size: 1.1rem;
}
.sub-row {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 0.4rem;
}
.current.due .count {
  color: var(--brand);
}
.side-text strong {
  font-weight: 700;
  color: var(--text);
}
.step-metrics {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.4rem 0 0.4rem;
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
.right {
  text-align: right;
}
.machine-note,
.logged {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.current .tap {
  margin: 0.25rem 0;
}
.progress {
  margin-top: auto;
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
.waiting .progress span {
  background: #a1887f;
}
.small {
  font-size: 0.85rem;
}
</style>

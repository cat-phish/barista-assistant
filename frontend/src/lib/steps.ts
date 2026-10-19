// Recipe step types, editor validation (mirrors the API, docs/api_spec.md §5)
// and the timer's view of a recipe at a given second. Tested in steps.test.ts.
import type { RecipeStep, StepType } from '../api/types';
import { formatGrams, formatTime, parseDecimal, parseTime, type Parsed } from './format';

export const STEP_TYPES: Record<StepType, { label: string; water: 'required' | 'none' | 'optional' }> = {
  bloom: { label: 'Bloom', water: 'required' },
  pour: { label: 'Pour', water: 'required' },
  swirl: { label: 'Swirl', water: 'none' },
  stir: { label: 'Stir', water: 'none' },
  wait: { label: 'Wait / drawdown', water: 'none' },
  press: { label: 'Press', water: 'none' },
  other: { label: 'Other', water: 'optional' },
};
export const STEP_TYPE_ORDER = Object.keys(STEP_TYPES) as StepType[];

export function stepTitle(step: { stepType: StepType; label: string | null }): string {
  return step.label?.trim() || STEP_TYPES[step.stepType].label;
}

// ---- Editor -----------------------------------------------------------------

export interface StepDraft {
  key: string; // client-only stable id, so reordering keeps the right row (not sent)
  stepType: StepType;
  label: string;
  start: string; // m:ss
  end: string; // m:ss
  water: string; // "pour to" grams; ignored for types without water
}

export interface ParsedStep {
  stepType: StepType;
  label: string | null;
  startSec: number;
  endSec: number;
  targetWaterGrams: number | null;
}

export function parseSteps(drafts: StepDraft[]): { steps: ParsedStep[]; errors: Record<number, string> } {
  const steps: ParsedStep[] = [];
  const errors: Record<number, string> = {};
  let prevEnd: number | null = null;
  let lastWater: number | null = null;

  drafts.forEach((d, i) => {
    const kind = STEP_TYPES[d.stepType].water;
    const start = parseTime(d.start);
    const end = parseTime(d.end);
    const waterText = kind === 'none' ? '' : d.water.trim();
    const water = waterText ? parseDecimal(waterText, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true }) : null;

    let error = '';
    if (!start.ok) error = `Start: ${start.error}`;
    else if (!end.ok) error = `End: ${end.error}`;
    else if (end.value < start.value) error = 'Ends before it starts';
    else if (prevEnd !== null && start.value < prevEnd) error = `Starts before the previous step ends (${formatTime(prevEnd)})`;
    else if (kind === 'required' && !water) error = 'Enter the weight to pour to';
    else if (water && !water.ok) error = `Pour to: ${water.error}`;
    else if (water?.ok && lastWater !== null && water.value < lastWater) error = `Pour-to is a running total: at least ${formatGrams(lastWater)} g`;

    if (error) {
      errors[i] = error;
      return;
    }
    const targetWaterGrams = water?.ok ? water.value : null;
    steps.push({
      stepType: d.stepType,
      label: d.label.trim() || null,
      startSec: start.ok ? start.value : 0,
      endSec: end.ok ? end.value : 0,
      targetWaterGrams,
    });
    prevEnd = end.ok ? end.value : prevEnd;
    if (targetWaterGrams !== null) lastWater = targetWaterGrams;
  });
  if (drafts.length > 20) errors[20] = 'At most 20 steps';
  return { steps, errors };
}

// Per-step pour amount: this step's pour-to minus the previous water step's.
export function pourAmounts(steps: Array<{ targetWaterGrams: number | null }>): Array<number | null> {
  let last = 0;
  return steps.map((s) => {
    if (s.targetWaterGrams === null) return null;
    const amount = Math.round((s.targetWaterGrams - last) * 100) / 100;
    last = s.targetWaterGrams;
    return amount;
  });
}

let nextKey = 0;
export function newStepKey(): string {
  nextKey += 1;
  return `step-${nextKey}`;
}

// Moves a step and re-times the list (docs: "re-time to fit"): every step
// keeps its own length and the waiting gap that came before it, and the
// steps are laid out one after another in the new order. Rows whose times
// don't parse yet keep their text and don't move the clock.
export function moveStep(drafts: StepDraft[], from: number, to: number): StepDraft[] {
  if (from === to || from < 0 || to < 0 || from >= drafts.length || to >= drafts.length) return drafts;
  // Measure duration and leading gap in the current order.
  let prevEnd = 0;
  const measured = drafts.map((d) => {
    const start = parseTime(d.start);
    const end = parseTime(d.end);
    if (!start.ok || !end.ok || end.value < start.value) return { d, timing: null };
    const timing = { gap: Math.max(0, start.value - prevEnd), duration: end.value - start.value };
    prevEnd = end.value;
    return { d, timing };
  });
  const [moved] = measured.splice(from, 1);
  if (!moved) return drafts;
  measured.splice(to, 0, moved);
  let clock = 0;
  return measured.map(({ d, timing }) => {
    if (!timing) return d;
    const start = clock + timing.gap;
    clock = start + timing.duration;
    return { ...d, start: formatTime(start), end: formatTime(clock) };
  });
}

export const INSERTED_STEP_SEC = 10;

// Inserts a new step right after `afterIndex`. It starts where that step ends
// and lasts 10 s. If the wait gap there can hold it, nothing else moves;
// otherwise the later steps shift by just enough, each keeping its length and
// the wait before it. Defaults to a pour to the running total so far (valid
// as-is); the user picks the real type. Returns the list and the new index.
export function insertStepAfter(drafts: StepDraft[], afterIndex: number, key: string): { steps: StepDraft[]; index: number } {
  const prev = drafts[afterIndex];
  if (!prev) return { steps: drafts, index: -1 };
  const prevEnd = parseTime(prev.end);
  const start = prevEnd.ok ? prevEnd.value : 0;
  const end = start + INSERTED_STEP_SEC;

  // Running water total up to and including the previous step.
  let lastWater = '';
  for (const d of drafts.slice(0, afterIndex + 1)) {
    if (STEP_TYPES[d.stepType].water !== 'none') {
      const w = parseDecimal(d.water, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true });
      if (w.ok) lastWater = formatGrams(w.value);
    }
  }

  const nextStart = drafts[afterIndex + 1] ? parseTime(drafts[afterIndex + 1]!.start) : null;
  const shift = nextStart?.ok ? Math.max(0, end - nextStart.value) : 0;
  const shifted = drafts.slice(afterIndex + 1).map((d) => {
    if (shift === 0) return d;
    const a = parseTime(d.start);
    const b = parseTime(d.end);
    if (!a.ok || !b.ok) return d; // unparsed rows keep their text
    return { ...d, start: formatTime(a.value + shift), end: formatTime(b.value + shift) };
  });

  const inserted: StepDraft = { key, stepType: 'pour', label: '', start: formatTime(start), end: formatTime(end), water: lastWater };
  return { steps: [...drafts.slice(0, afterIndex + 1), inserted, ...shifted], index: afterIndex + 1 };
}

// ---- Target finish window ---------------------------------------------------

export const FINISH_DEFAULT_SPREAD_SEC = 15; // same default as the API

// "2:45" / "" -> window; one end alone gets the other ±15 s (docs/api_spec.md §5).
export function parseFinishWindow(fromText: string, toText: string): Parsed<{ min: number; max: number } | null> {
  const from = fromText.trim() ? parseTime(fromText) : null;
  const to = toText.trim() ? parseTime(toText) : null;
  if (from && !from.ok) return { ok: false, error: `From: ${from.error}` };
  if (to && !to.ok) return { ok: false, error: `To: ${to.error}` };
  const min = from?.ok ? from.value : null;
  const max = to?.ok ? to.value : null;
  if (min === null && max === null) return { ok: true, value: null };
  if (min !== null && max !== null) {
    return min <= max ? { ok: true, value: { min, max } } : { ok: false, error: '"From" is after "to"' };
  }
  if (min !== null) return { ok: true, value: { min, max: Math.min(24 * 3600, min + FINISH_DEFAULT_SPREAD_SEC) } };
  return { ok: true, value: { min: Math.max(0, (max as number) - FINISH_DEFAULT_SPREAD_SEC), max: max as number } };
}

export function formatFinishWindow(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null;
  return min === max ? formatTime(min) : `${formatTime(min)}–${formatTime(max)}`;
}

// The timer's line: "Target 2:45–3:15 · in 0:40" / "· in the window" / "· 0:12 over".
export function finishStatus(min: number | null, max: number | null, t: number): string | null {
  const range = formatFinishWindow(min, max);
  if (range === null || min === null || max === null) return null;
  if (t < min) return `Target ${range} · in ${formatTime(Math.ceil(min - t))}`;
  if (t <= max) return `Target ${range} · in the window`;
  return `Target ${range} · ${formatTime(Math.floor(t - max))} over`;
}

// Soft checks (the API doesn't enforce these; the form warns).
export function recipeWarnings(opts: { waterGrams: number | null; finishMaxSec: number | null; steps: ParsedStep[] }): string[] {
  const warnings: string[] = [];
  const lastWater = [...opts.steps].reverse().find((s) => s.targetWaterGrams !== null)?.targetWaterGrams ?? null;
  if (opts.waterGrams !== null && lastWater !== null && lastWater !== opts.waterGrams) {
    warnings.push(`The steps pour to ${formatGrams(lastWater)} g, but the recipe's water is ${formatGrams(opts.waterGrams)} g.`);
  }
  const lastEnd = opts.steps[opts.steps.length - 1]?.endSec;
  if (opts.finishMaxSec !== null && lastEnd !== undefined && opts.finishMaxSec < lastEnd) {
    warnings.push(`The target finish window ends (${formatTime(opts.finishMaxSec)}) before the last step does (${formatTime(lastEnd)}).`);
  }
  return warnings;
}

// ---- Timer --------------------------------------------------------------------

// Instant steps (start === end) stay on screen this long so they aren't missed.
export const INSTANT_STEP_SEC = 2;

export type TimerPhase =
  | { kind: 'idle' } // no steps: plain stopwatch
  | { kind: 'step'; index: number; step: RecipeStep; endsAt: number; amount: number | null }
  | { kind: 'wait'; next: RecipeStep; nextIndex: number; startsIn: number }
  | { kind: 'done' }; // after the last step: drawdown / finishing

// What the timer should show `t` seconds into the brew (docs/timer_architecture.md §3).
export function timerPhase(steps: RecipeStep[], t: number): TimerPhase {
  if (steps.length === 0) return { kind: 'idle' };
  const amounts = pourAmounts(steps);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const endsAt = step.endSec === step.startSec ? step.startSec + INSTANT_STEP_SEC : step.endSec;
    if (t < step.startSec) return { kind: 'wait', next: step, nextIndex: i, startsIn: step.startSec - t };
    // An instant step's display window can't run into the next step.
    const nextStart = steps[i + 1]?.startSec ?? Infinity;
    if (t < Math.min(endsAt, Math.max(nextStart, step.endSec))) {
      return { kind: 'step', index: i, step, endsAt: step.endSec === step.startSec ? Math.min(endsAt, nextStart) : endsAt, amount: amounts[i] ?? null };
    }
  }
  return { kind: 'done' };
}

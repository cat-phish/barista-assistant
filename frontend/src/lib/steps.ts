// Recipe steps: the types, editor validation (mirrors the API, docs/api_spec.md
// §5), what each step's card says, and the timer's schedule. Steps run back to
// back: each starts when the previous one actually ended. Tested in steps.test.ts.
import type { FlowUnit, MachineCapabilities, Mark, MethodKind, StepAdvance, StepFields, StepType } from '../api/types';
import { formatGrams, formatTime, parseDecimal, parseTime, type Parsed } from './format';

type Rule = 'required' | 'optional' | 'none';
interface StepTypeInfo {
  label: string;
  espresso: boolean | 'both'; // which recipes can use it
  water: Rule;
  pressure: Rule;
  flow: Rule;
  waiting: boolean; // nothing to do: plain card instead of the warm "do this" one
}
export const STEP_TYPES: Record<StepType, StepTypeInfo> = {
  bloom: { label: 'Bloom', espresso: false, water: 'required', pressure: 'none', flow: 'none', waiting: false },
  pour: { label: 'Pour', espresso: false, water: 'required', pressure: 'none', flow: 'none', waiting: false },
  swirl: { label: 'Swirl', espresso: false, water: 'none', pressure: 'none', flow: 'none', waiting: false },
  stir: { label: 'Stir', espresso: false, water: 'none', pressure: 'none', flow: 'none', waiting: false },
  wait: { label: 'Wait / drawdown', espresso: false, water: 'none', pressure: 'none', flow: 'none', waiting: true },
  press: { label: 'Press', espresso: false, water: 'none', pressure: 'none', flow: 'none', waiting: false },
  preinfusion: { label: 'Pre-infusion', espresso: true, water: 'none', pressure: 'optional', flow: 'optional', waiting: false },
  soak: { label: 'Soak (pump off)', espresso: true, water: 'none', pressure: 'none', flow: 'none', waiting: true },
  pressure: { label: 'Pressure', espresso: true, water: 'none', pressure: 'required', flow: 'none', waiting: false },
  flow: { label: 'Flow', espresso: true, water: 'none', pressure: 'none', flow: 'required', waiting: false },
  other: { label: 'Other', espresso: 'both', water: 'optional', pressure: 'optional', flow: 'optional', waiting: false },
};

// The step-type picker for a recipe of this kind.
export function stepTypesFor(kind: MethodKind | null): StepType[] {
  const espresso = kind === 'espresso';
  return (Object.keys(STEP_TYPES) as StepType[]).filter((t) => STEP_TYPES[t].espresso === 'both' || STEP_TYPES[t].espresso === espresso);
}
// Water is a pour-over value; pressure and flow are espresso values.
export function stepRules(type: StepType, kind: MethodKind | null): { water: Rule; pressure: Rule; flow: Rule } {
  const espresso = kind === 'espresso';
  const info = STEP_TYPES[type];
  return { water: espresso ? 'none' : info.water, pressure: espresso ? info.pressure : 'none', flow: espresso ? info.flow : 'none' };
}

// Short labels fit the editor's select on a phone; the hint says the rest.
export const ADVANCE: Record<StepAdvance, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'Moves on when the time is up' },
  auto_log: { label: 'Auto + log', hint: 'Moves on by itself; a Log it button records when you really did it' },
  tap: { label: 'Tap', hint: 'Waits for you to tap Next; the time is a guide' },
  first_drop: { label: '1st drop', hint: 'Ends when you tap First drop' },
};
export function advancesFor(kind: MethodKind | null): StepAdvance[] {
  return kind === 'espresso' ? ['auto', 'auto_log', 'tap', 'first_drop'] : ['auto', 'auto_log', 'tap'];
}

export const FLOW_UNITS: Record<FlowUnit, string> = { g_s: 'g/s', ml_s: 'ml/s' };

export function stepTitle(step: { stepType: StepType; label: string | null }): string {
  return step.label?.trim() || STEP_TYPES[step.stepType].label;
}

// ---- What a step's card says -----------------------------------------------------

const num = (n: number) => formatGrams(n); // drops trailing zeros: 9, 6.5
const ramp = (from: number, to: number | null, unit: string) => (to === null || to === from ? `${num(from)} ${unit}` : `${num(from)} → ${num(to)} ${unit}`);

// The instruction: "Pour to 150 g (+100)", "9 → 6 bar", "4 → 2 g/s", "Pump off".
export function stepInstruction(step: StepFields, amount: number | null, flowUnit: FlowUnit): string | null {
  if (step.targetWaterGrams !== null) return `Pour to ${formatGrams(step.targetWaterGrams)} g${amount !== null ? ` (+${formatGrams(amount)})` : ''}`;
  if (step.pressureBar !== null) return ramp(step.pressureBar, step.pressureEndBar, 'bar');
  if (step.flowRate !== null) return ramp(step.flowRate, step.flowEndRate, FLOW_UNITS[flowUnit]);
  if (step.stepType === 'soak') return 'Pump off';
  return null;
}

// What the chosen machine can't do for this step (the step still runs on time).
export function machineNote(step: StepFields, machine: MachineCapabilities | null): string | null {
  if (!machine) return null;
  if (step.pressureBar !== null && machine.pressureControl === 'none') return "Your machine can't set pressure";
  if (step.flowRate !== null && machine.flowControl === 'none') return "Your machine can't set flow";
  if (step.stepType === 'preinfusion' && machine.preinfusion === 'none') return 'Your machine has no pre-infusion';
  return null;
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

// When each step is planned to start (from the durations), and whether that's
// exact: after a step that waits for a tap or first drop, it's an estimate,
// and after one with no duration it's unknown (null).
export function plannedStarts(steps: Array<Pick<StepFields, 'durationSec' | 'advance'>>): Array<{ at: number; exact: boolean } | null> {
  let at: number | null = 0;
  let exact = true;
  return steps.map((s) => {
    const here = at === null ? null : { at, exact };
    if (at !== null) at = s.durationSec === null ? null : at + s.durationSec;
    if (s.advance === 'tap' || s.advance === 'first_drop') exact = false;
    return here;
  });
}

// ---- Editor -----------------------------------------------------------------

export interface StepDraft {
  key: string; // client-only stable id, so reordering keeps the right row (not sent)
  stepType: StepType;
  label: string;
  duration: string; // m:ss or seconds; '' = none (open-ended / no guide)
  advance: StepAdvance;
  water: string; // "pour to" grams
  temp: string; // °C
  pressure: string; // bar
  pressureEnd: string;
  flow: string; // recipe's flow unit
  flowEnd: string;
}

export function stepDraft(key: string, s?: Partial<StepFields>): StepDraft {
  const text = (n: number | null | undefined) => (n == null ? '' : formatGrams(n));
  return {
    key,
    stepType: s?.stepType ?? 'pour',
    label: s?.label ?? '',
    duration: s?.durationSec == null ? '' : formatTime(s.durationSec),
    advance: s?.advance ?? 'auto',
    water: text(s?.targetWaterGrams),
    temp: text(s?.targetTempC),
    pressure: text(s?.pressureBar),
    pressureEnd: text(s?.pressureEndBar),
    flow: text(s?.flowRate),
    flowEnd: text(s?.flowEndRate),
  };
}

export function parseSteps(drafts: StepDraft[], kind: MethodKind | null): { steps: StepFields[]; errors: Record<number, string> } {
  const steps: StepFields[] = [];
  const errors: Record<number, string> = {};
  let lastWater: number | null = null;
  let firstDrops = 0;
  const optional = (text: string, opts: Parameters<typeof parseDecimal>[1]) => (text.trim() ? parseDecimal(text, opts) : null);
  const profile = { scale: 1, min: 0, max: 20 };

  drafts.forEach((d, i) => {
    const rules = stepRules(d.stepType, kind);
    const last = i === drafts.length - 1;
    const duration = d.duration.trim() ? parseTime(d.duration) : null;
    const water = rules.water === 'none' ? null : optional(d.water, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true });
    const temp = optional(d.temp, { scale: 1, min: 0, max: 100 });
    const pressure = rules.pressure === 'none' ? null : optional(d.pressure, profile);
    const pressureEnd = rules.pressure === 'none' ? null : optional(d.pressureEnd, profile);
    const flow = rules.flow === 'none' ? null : optional(d.flow, profile);
    const flowEnd = rules.flow === 'none' ? null : optional(d.flowEnd, profile);
    if (d.advance === 'first_drop') firstDrops += 1;

    let error = '';
    // e.g. after switching a pour-over recipe to an espresso method.
    if (!stepTypesFor(kind).includes(d.stepType)) error = `Pick a ${kind === 'espresso' ? 'shot profile' : 'pour-over'} step type`;
    else if (duration && !duration.ok) error = `Time: ${duration.error}`;
    else if (!duration && d.advance === 'auto' && !last) error = 'Enter how long it lasts (only the last step can run until you finish)';
    else if (!duration && d.advance === 'auto_log') error = 'Enter how long it lasts';
    else if (d.advance === 'first_drop' && kind !== 'espresso') error = 'Only espresso steps can end at first drop';
    else if (d.advance === 'first_drop' && firstDrops > 1) error = 'Only one step can end at first drop';
    else if (rules.water === 'required' && !water) error = 'Enter the weight to pour to';
    else if (water && !water.ok) error = `Pour to: ${water.error}`;
    else if (water?.ok && lastWater !== null && water.value < lastWater) error = `Pour-to is a running total: at least ${formatGrams(lastWater)} g`;
    else if (temp && !temp.ok) error = `Temp: ${temp.error}`;
    else if (rules.pressure === 'required' && !pressure) error = 'Enter the pressure';
    else if (rules.flow === 'required' && !flow) error = 'Enter the flow';
    else if ([pressure, pressureEnd, flow, flowEnd].some((p) => p && !p.ok)) error = 'Pressure and flow: 0–20, one decimal';
    else if ((pressureEnd && !pressure) || (flowEnd && !flow)) error = 'A ramp needs a starting value';
    else if (pressure && flow) error = 'Set pressure or flow, not both';

    if (error) {
      errors[i] = error;
      return;
    }
    const value = (p: Parsed<number> | null) => (p?.ok ? p.value : null);
    const targetWaterGrams = value(water);
    steps.push({
      stepType: d.stepType,
      label: d.label.trim() || null,
      durationSec: value(duration),
      advance: d.advance,
      targetWaterGrams,
      targetTempC: value(temp),
      pressureBar: value(pressure),
      pressureEndBar: value(pressureEnd),
      flowRate: value(flow),
      flowEndRate: value(flowEnd),
    });
    if (targetWaterGrams !== null) lastWater = targetWaterGrams;
  });
  if (drafts.length > 20) errors[20] = 'At most 20 steps';
  return { steps, errors };
}

let nextKey = 0;
export function newStepKey(): string {
  nextKey += 1;
  return `step-${nextKey}`;
}

// Steps run back to back, so moving one needs no re-timing.
export function moveStep<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export const INSERTED_STEP_SEC = 10;

// A new step after `afterIndex` (or at the start for -1): a 10 s pour to the
// running total for pour-over, a 10 s soak for espresso. Returns the list and
// the new index.
export function insertStepAfter(drafts: StepDraft[], afterIndex: number, key: string, kind: MethodKind | null): { steps: StepDraft[]; index: number } {
  if (afterIndex < -1 || afterIndex >= drafts.length) return { steps: drafts, index: -1 };
  let lastWater = '';
  for (const d of drafts.slice(0, afterIndex + 1)) {
    const w = parseDecimal(d.water, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true });
    if (STEP_TYPES[d.stepType].water !== 'none' && w.ok) lastWater = formatGrams(w.value);
  }
  const inserted =
    kind === 'espresso'
      ? stepDraft(key, { stepType: 'soak', durationSec: INSERTED_STEP_SEC })
      : { ...stepDraft(key, { stepType: 'pour', durationSec: INSERTED_STEP_SEC }), water: lastWater };
  return { steps: [...drafts.slice(0, afterIndex + 1), inserted, ...drafts.slice(afterIndex + 1)], index: afterIndex + 1 };
}

// ---- Target finish window ---------------------------------------------------

export const FINISH_DEFAULT_SPREAD_SEC = 15; // same default as the API
// Espresso first-drop window default spread (docs/api_spec.md §5).
export const FIRST_DROP_DEFAULT_SPREAD_SEC = 3;

// "2:45" / "" -> window; one end alone gets the other ±spread (docs/api_spec.md §5).
export function parseFinishWindow(
  fromText: string,
  toText: string,
  spread = FINISH_DEFAULT_SPREAD_SEC,
): Parsed<{ min: number; max: number } | null> {
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
  if (min !== null) return { ok: true, value: { min, max: Math.min(24 * 3600, min + spread) } };
  return { ok: true, value: { min: Math.max(0, (max as number) - spread), max: max as number } };
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
export function recipeWarnings(opts: { waterGrams: number | null; finishMaxSec: number | null; steps: StepFields[] }): string[] {
  const warnings: string[] = [];
  const lastWater = [...opts.steps].reverse().find((s) => s.targetWaterGrams !== null)?.targetWaterGrams ?? null;
  if (opts.waterGrams !== null && lastWater !== null && lastWater !== opts.waterGrams) {
    warnings.push(`The steps pour to ${formatGrams(lastWater)} g, but the recipe's water is ${formatGrams(opts.waterGrams)} g.`);
  }
  const starts = plannedStarts(opts.steps);
  const last = opts.steps[opts.steps.length - 1];
  const lastStart = starts[starts.length - 1];
  const plannedEnd = last && lastStart && last.durationSec !== null ? lastStart.at + last.durationSec : null;
  if (opts.finishMaxSec !== null && plannedEnd !== null && opts.finishMaxSec < plannedEnd) {
    warnings.push(`The target finish window ends (${formatTime(opts.finishMaxSec)}) before the steps do (${formatTime(plannedEnd)}).`);
  }
  return warnings;
}

// ---- Timer --------------------------------------------------------------------

// Instant steps (0 s) stay on screen this long so they aren't missed; they
// don't delay the next step.
export const INSTANT_STEP_SEC = 2;

export type BrewPhase =
  | { kind: 'idle' } // no steps: plain stopwatch
  | {
      kind: 'step';
      index: number;
      step: StepFields;
      start: number;
      end: number | null; // when it ends / ended; null = waiting for a tap or first drop, or until you finish
      guideEnd: number | null; // start + duration (the plan, or a guide for tap steps)
      due: boolean; // a tap step past its guide: "Tap Next when ready"
      amount: number | null;
      prevIndex: number | null;
      nextIndex: number | null;
      from: number; // progress bar window
      to: number | null;
    }
  | { kind: 'done'; prevIndex: number; from: number }; // after a timed last step

// What the timer shows `t` seconds in, given the marks so far
// (docs/timer_architecture.md §3). windows: ends for the progress bar of
// steps with no planned end.
export function brewSchedule(
  steps: StepFields[],
  t: number,
  marks: readonly Mark[],
  windows: { firstDropMax?: number | null; finishMax?: number | null } = {},
): BrewPhase {
  if (steps.length === 0) return { kind: 'idle' };
  const amounts = pourAmounts(steps);
  const firstDrop = marks.find((m) => m.kind === 'first_drop')?.atSec ?? null;
  const last = steps.length - 1;
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const guideEnd = step.durationSec === null ? null : start + step.durationSec;
    const tapped = marks.find((m) => m.kind === 'step_end' && m.stepOrder === i + 1)?.atSec ?? null;
    let end: number | null;
    if (step.advance === 'tap') end = tapped === null ? null : Math.max(start, tapped);
    else if (step.advance === 'first_drop') end = firstDrop === null ? null : Math.max(start, firstDrop);
    else end = guideEnd;
    const frame = { index: i, step, start, guideEnd, amount: amounts[i] ?? null, prevIndex: i > 0 ? i - 1 : null, nextIndex: i < last ? i + 1 : null };

    // An instant step is shown briefly without delaying what follows.
    if (end === start && step.advance !== 'tap' && step.advance !== 'first_drop') {
      if (t < start + INSTANT_STEP_SEC) return { kind: 'step', ...frame, end, due: false, from: start, to: start + INSTANT_STEP_SEC };
      continue;
    }
    if (end === null || t < end) {
      const to = end ?? guideEnd ?? (step.advance === 'first_drop' ? (windows.firstDropMax ?? null) : i === last ? (windows.finishMax ?? null) : null);
      return { kind: 'step', ...frame, end, due: step.advance === 'tap' && guideEnd !== null && t >= guideEnd, from: start, to };
    }
    start = end;
  }
  return { kind: 'done', prevIndex: last, from: start };
}

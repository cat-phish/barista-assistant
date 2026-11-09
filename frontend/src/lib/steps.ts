// Recipe steps: the types, editor validation (mirrors the API, docs/api/README.md
// §5), what each step's card says, and the timer's schedule. Steps run back to
// back: each starts when the previous one actually ended. Tested in steps.test.ts.
import type { FlowUnit, MachineCapabilities, Mark, MethodKind, StepAdvance, StepFields, StepType, TemperatureUnit } from '../api/types';
import { formatGrams, formatTime, parseDecimal, parseTime, type Parsed } from './format';
import { holdsOf } from './marks';
import { scalesByDefault } from './scale';
import { formatTemp, parseTemp, tempText } from './units';

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
  // Done before the timer starts: a checklist item, with an optional countdown.
  prep: { label: 'Prep (before the timer)', espresso: 'both', water: 'none', pressure: 'none', flow: 'none', waiting: false },
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

// Prep steps come first and are done before the timer starts; the timer and
// every planned time use the brew steps after them.
export const isPrep = (step: { stepType: StepType }): boolean => step.stepType === 'prep';
export function splitPrep<T extends { stepType: StepType }>(steps: readonly T[]): { prep: T[]; brew: T[] } {
  return { prep: steps.filter(isPrep), brew: steps.filter((s) => !isPrep(s)) };
}

// ---- What a step's card says -----------------------------------------------------

const num = (n: number) => formatGrams(n); // drops trailing zeros: 9, 6.5
const ramp = (from: number, to: number | null, unit: string) => (to === null || to === from ? `${num(from)} ${unit}` : `${num(from)} → ${num(to)} ${unit}`);

// The instruction: "Pour to 150 g (+100) at 93 °C", "9 → 6 bar", "4 → 2 g/s", "Pump off".
export function stepInstruction(step: StepFields, amount: number | null, flowUnit: FlowUnit, tempUnit: TemperatureUnit): string | null {
  if (step.targetWaterGrams !== null) {
    const temp = step.targetTempC !== null ? ` at ${formatTemp(step.targetTempC, tempUnit)}` : '';
    return `Pour to ${formatGrams(step.targetWaterGrams)} g${amount !== null ? ` (+${formatGrams(amount)})` : ''}${temp}`;
  }
  if (step.pressureBar !== null) return ramp(step.pressureBar, step.pressureEndBar, 'bar');
  if (step.flowRate !== null) return ramp(step.flowRate, step.flowEndRate, FLOW_UNITS[flowUnit]);
  if (step.stepType === 'soak') return 'Pump off';
  return null;
}

// The water's temperature going into step `index`: the latest step before it
// that set one, or the brew's. Compared as shown, so a difference that rounds
// away in °F isn't a change.
function tempBefore(steps: readonly StepFields[], index: number, waterTempC: number | null): number | null {
  for (let i = index - 1; i >= 0; i--) {
    const c = steps[i]!.targetTempC;
    if (c !== null) return c;
  }
  return waterTempC;
}
function tempChange(steps: readonly StepFields[], index: number, waterTempC: number | null, tempUnit: TemperatureUnit): { next: string; now: string | null } | null {
  const c = steps[index]?.targetTempC ?? null;
  if (c === null) return null;
  const before = tempBefore(steps, index, waterTempC);
  const next = formatTemp(c, tempUnit);
  const now = before === null ? null : formatTemp(before, tempUnit);
  return next === now ? null : { next, now };
}
// Up next's callout: the step after `index` changes the temperature.
export const nextTempChange = (steps: readonly StepFields[], index: number, waterTempC: number | null, tempUnit: TemperatureUnit) =>
  tempChange(steps, index + 1, waterTempC, tempUnit);
// A step that changes the temperature without pouring: "Set kettle to 93 °C".
export function setTempLine(steps: readonly StepFields[], index: number, waterTempC: number | null, tempUnit: TemperatureUnit): string | null {
  if (steps[index]?.targetWaterGrams !== null) return null;
  const change = tempChange(steps, index, waterTempC, tempUnit);
  return change && `Set kettle to ${change.next}`;
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

// When each step is planned to start and end (from the durations), and
// whether that's exact: a tap or first-drop step's time is a guide, so its end
// and everything after it are estimates; after a step with no duration
// they're unknown (null). Prep steps are off the clock: null, and they don't
// move it.
type Planned = { at: number; exact: boolean } | null;
type Timed = Pick<StepFields, 'stepType' | 'durationSec' | 'advance'>;
export function plannedTimes(steps: readonly Timed[]): Array<{ start: Planned; end: Planned }> {
  let at: number | null = 0;
  let exact = true;
  return steps.map((s) => {
    if (isPrep(s)) return { start: null, end: null };
    const start = at === null ? null : { at, exact };
    if (s.advance === 'tap' || s.advance === 'first_drop') exact = false;
    at = at === null || s.durationSec === null ? null : at + s.durationSec;
    return { start, end: at === null ? null : { at, exact } };
  });
}
export const plannedStarts = (steps: readonly Timed[]): Planned[] => plannedTimes(steps).map((t) => t.start);
// When the brew steps are planned to end (null: open-ended, or no brew steps).
export function plannedEnd(steps: readonly Timed[]): Planned {
  const times = plannedTimes(steps);
  for (let i = steps.length - 1; i >= 0; i -= 1) if (!isPrep(steps[i] as Timed)) return times[i]?.end ?? null;
  return null;
}

// The recipe builder's line under a step, in parts the form separates with a
// dot: ["Starts at 0:30", "Ends at 1:15"], ["Starts ≈ 1:00", "Ends ≈ 1:45"]
// after a tap, [..., "Runs until you finish"].
export function stepTimeParts(steps: readonly Timed[], i: number): string[] {
  const s = steps[i];
  const times = plannedTimes(steps)[i];
  if (!s || !times) return [];
  if (isPrep(s)) return ['Before the timer starts'];
  const { start, end } = times;
  const from = start ? `Starts ${start.exact ? 'at' : '≈'} ${formatTime(start.at)}` : `Starts after step ${i}`;
  if (end) return [from, `Ends ${end.exact ? 'at' : '≈'} ${formatTime(end.at)}`];
  if (start && s.durationSec === null && s.advance === 'auto' && i === steps.length - 1) return [from, 'Runs until you finish'];
  return [from];
}

// The line under the step list, in parts the form separates with a dot:
// ["Steps end at 3:15", "Target finish 3:00–3:30"]; outside when the planned
// end falls outside the window. null without brew steps.
export function stepsTotalLine(steps: readonly Timed[], finish: { min: number; max: number } | null): { parts: string[]; outside: boolean } | null {
  if (!steps.some((s) => !isPrep(s))) return null;
  const end = plannedEnd(steps);
  const parts = [end ? `Steps end ${end.exact ? 'at' : '≈'} ${formatTime(end.at)}` : 'Steps run until you finish'];
  if (finish) parts.push(`Target finish ${formatFinishWindow(finish.min, finish.max)}`);
  return { parts, outside: !!(end && finish && (end.at < finish.min || end.at > finish.max)) };
}

// A prep step's countdown: whole seconds left (0 = done).
export function prepLeft(startedAtMs: number, durationSec: number, nowMs: number): number {
  return Math.max(0, Math.ceil(durationSec - (nowMs - startedAtMs) / 1000));
}

// The timer page's prep cards, before Start (docs/timer_architecture.md §3).
// Previous / Up next: "Preheat · 2:00", or the label alone when untimed.
export function prepSide(step: { stepType: StepType; label: string | null; durationSec: number | null }): string {
  return step.durationSec ? `${stepTitle(step)} · ${formatTime(step.durationSec)}` : stepTitle(step);
}
// The current prep card's right side: nothing untimed; the full time before
// its countdown starts; then the time left (left: seconds, 0 = done) and how
// far along it is (0..1).
export function prepCountdown(
  step: { durationSec: number | null },
  startedAtMs: number | null,
  nowMs: number,
): { big: string; small: string; left: number | null; progress: number } {
  const sec = step.durationSec;
  if (!sec) return { big: '', small: '', left: null, progress: 0 };
  if (startedAtMs === null) return { big: formatTime(sec), small: 'countdown', left: sec, progress: 0 };
  const left = prepLeft(startedAtMs, sec, nowMs);
  return { big: formatTime(left), small: 'left', left, progress: Math.min(1, Math.max(0, (nowMs - startedAtMs) / 1000 / sec)) };
}

// ---- Editor -----------------------------------------------------------------

export interface StepDraft {
  key: string; // client-only stable id, so reordering keeps the right row (not sent)
  stepType: StepType;
  label: string;
  duration: string; // m:ss or seconds; '' = none (open-ended / no guide)
  advance: StepAdvance;
  water: string; // "pour to" grams
  temp: string; // in the person's temperature unit (°C stored)
  pressure: string; // bar
  pressureEnd: string;
  flow: string; // recipe's flow unit
  flowEnd: string;
  scalesWithBatch: boolean; // kept while the recipe's scaling is off
}

export function stepDraft(key: string, s?: Partial<StepFields>, tempUnit: TemperatureUnit = 'c'): StepDraft {
  const text = (n: number | null | undefined) => (n == null ? '' : formatGrams(n));
  const stepType = s?.stepType ?? 'pour';
  return {
    key,
    stepType,
    label: s?.label ?? '',
    duration: s?.durationSec == null ? '' : formatTime(s.durationSec),
    advance: s?.advance ?? 'auto',
    water: text(s?.targetWaterGrams),
    temp: tempText(s?.targetTempC, tempUnit),
    pressure: text(s?.pressureBar),
    pressureEnd: text(s?.pressureEndBar),
    flow: text(s?.flowRate),
    flowEnd: text(s?.flowEndRate),
    scalesWithBatch: s?.scalesWithBatch ?? scalesByDefault(stepType),
  };
}

export function parseSteps(drafts: StepDraft[], kind: MethodKind | null, tempUnit: TemperatureUnit = 'c'): { steps: StepFields[]; errors: Record<number, string> } {
  const steps: StepFields[] = [];
  const errors: Record<number, string> = {};
  let lastWater: number | null = null;
  let firstDrops = 0;
  let brewing = false; // past the prep steps
  const optional = (text: string, opts: Parameters<typeof parseDecimal>[1]) => (text.trim() ? parseDecimal(text, opts) : null);
  const profile = { scale: 1, min: 0, max: 20 };

  drafts.forEach((d, i) => {
    const rules = stepRules(d.stepType, kind);
    const last = i === drafts.length - 1;
    const duration = d.duration.trim() ? parseTime(d.duration) : null;
    // Prep: what to do before the timer starts, with an optional countdown.
    if (d.stepType === 'prep') {
      const error = brewing
        ? 'Prep steps go before the brew steps'
        : !d.label.trim()
          ? 'Say what to do (the label)'
          : duration && !duration.ok
            ? `Countdown: ${duration.error}`
            : '';
      if (error) errors[i] = error;
      else {
        steps.push({
          stepType: 'prep', label: d.label.trim(), durationSec: duration?.ok ? duration.value : null, advance: 'auto',
          targetWaterGrams: null, targetTempC: null, pressureBar: null, pressureEndBar: null, flowRate: null, flowEndRate: null,
          scalesWithBatch: false, // off the clock: never scales
        });
      }
      return;
    }
    brewing = true;
    const water = rules.water === 'none' ? null : optional(d.water, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true });
    const temp = d.temp.trim() ? parseTemp(d.temp, tempUnit) : null;
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
      scalesWithBatch: d.scalesWithBatch,
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
export const ESPRESSO_FINISH_DEFAULT_SPREAD_SEC = 3; // a shot's window is closer
// The finish window's default spread for a brewer kind (docs/api/recipes.md §5).
export function finishSpread(kind: MethodKind | null | undefined): number {
  return kind === 'espresso' ? ESPRESSO_FINISH_DEFAULT_SPREAD_SEC : FINISH_DEFAULT_SPREAD_SEC;
}
// Espresso first-drop window default spread (docs/api/recipes.md §5).
export const FIRST_DROP_DEFAULT_SPREAD_SEC = 3;

// "2:45" / "" -> window; one end alone gets the other ±spread (docs/api/recipes.md §5).
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
  const end = plannedEnd(opts.steps)?.at ?? null;
  if (opts.finishMaxSec !== null && end !== null && opts.finishMaxSec < end) {
    warnings.push(`The target finish window ends (${formatTime(opts.finishMaxSec)}) before the steps do (${formatTime(end)}).`);
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
      held: number; // seconds this step has been held so far
      holding: boolean; // held now: its countdown is stopped (Resume or Next)
      amount: number | null;
      prevIndex: number | null;
      nextIndex: number | null;
      from: number; // progress bar window
      to: number | null;
    }
  | { kind: 'done'; prevIndex: number; from: number }; // after a timed last step

// A timed step with its holds: the countdown stops while it's held, so it ends
// later by the time held; Next while held (a step_end) ends it then. Holds
// after the step's end are ignored. left: its countdown's remaining seconds.
function withHolds(start: number, duration: number, holds: ReturnType<typeof holdsOf>, next: number | null, t: number) {
  let at = start;
  let left = duration;
  let held = 0;
  for (const h of holds) {
    if (h.from >= at + left) break;
    const from = Math.max(h.from, at);
    left -= from - at;
    if (h.to === null) {
      if (next !== null && next >= from) return { end: next, held: held + next - from, holding: false, left };
      return { end: null, held: held + Math.max(0, t - from), holding: true, left };
    }
    held += Math.max(0, h.to - from);
    at = Math.max(h.to, from);
  }
  return { end: at + left, held, holding: false, left };
}

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
    let hold = { held: 0, holding: false, guideEnd };
    if (step.advance === 'tap') end = tapped === null ? null : Math.max(start, tapped);
    else if (step.advance === 'first_drop') end = firstDrop === null ? null : Math.max(start, firstDrop);
    else if (step.durationSec === null) end = null;
    else {
      const h = withHolds(start, step.durationSec, holdsOf(marks, i + 1), tapped, t);
      end = h.end;
      // While held, the countdown stays at what was left.
      hold = { held: h.held, holding: h.holding, guideEnd: h.end ?? t + h.left };
    }
    const frame = { index: i, step, start, guideEnd: hold.guideEnd, held: hold.held, holding: hold.holding, amount: amounts[i] ?? null, prevIndex: i > 0 ? i - 1 : null, nextIndex: i < last ? i + 1 : null };

    // An instant step is shown briefly without delaying what follows.
    if (end === start && step.advance !== 'tap' && step.advance !== 'first_drop') {
      if (t < start + INSTANT_STEP_SEC) return { kind: 'step', ...frame, end, due: false, from: start, to: start + INSTANT_STEP_SEC };
      continue;
    }
    if (end === null || t < end) {
      const to = end ?? frame.guideEnd ?? (step.advance === 'first_drop' ? (windows.firstDropMax ?? null) : i === last ? (windows.finishMax ?? null) : null);
      // The progress bar leaves out the time held, so it stops while held.
      return { kind: 'step', ...frame, end, due: step.advance === 'tap' && guideEnd !== null && t >= guideEnd, from: start + frame.held, to };
    }
    start = end;
  }
  return { kind: 'done', prevIndex: last, from: start };
}

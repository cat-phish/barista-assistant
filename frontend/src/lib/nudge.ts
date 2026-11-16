// The −/+ "nudge" buttons under brew-log fields (NudgeButtons.vue), which
// fields get them (Settings → Brew setup, docs/api/auth.md §1 nudgeButtons),
// and how a tap changes the text in the box. Pure, tested in nudge.test.ts.
import type { NudgeKey } from '../api/types';
import { formatGrams, formatTime, parseTime } from './format';

// In Settings → Brew setup's order.
export const NUDGE_OPTIONS: readonly { key: NudgeKey; label: string }[] = [
  { key: 'dose', label: 'Dose' },
  { key: 'water', label: 'Water' },
  { key: 'yield', label: 'Yield / shot weight' },
  { key: 'brix', label: 'Brix' },
  { key: 'tds', label: 'TDS' },
  { key: 'time', label: 'Time' },
  { key: 'temp', label: 'Water temp' },
  { key: 'grind', label: 'Grind setting' },
];

// The master switch's state: all on, none, or some (indeterminate).
export function nudgeAllState(on: readonly NudgeKey[]): 'all' | 'none' | 'some' {
  const set = new Set(on);
  const count = NUDGE_OPTIONS.filter((o) => set.has(o.key)).length;
  return count === 0 ? 'none' : count === NUDGE_OPTIONS.length ? 'all' : 'some';
}

// The list with one field switched, in the options' order, each once.
export function withNudge(on: readonly NudgeKey[], key: NudgeKey, enabled: boolean): NudgeKey[] {
  const set = new Set(on);
  return NUDGE_OPTIONS.map((o) => o.key).filter((k) => (k === key ? enabled : set.has(k)));
}

export interface NudgeSpec {
  steps: readonly number[]; // positive steps, smallest first: [1, 5]
  unit: string; // for screen readers: "Add 5 g"
  parse: (text: string) => number | null; // null = empty or not a number
  format: (value: number) => string;
  stepText: (step: number) => string; // the button: "+0.5", "+5s"
  // Dose and water: an empty box counts as 0, and 0 or less empties it so the
  // required error shows. Otherwise an empty box needs an expected value and
  // a result never goes below 0.
  fromZero?: boolean;
}

function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function parseSeconds(text: string): number | null {
  if (!text.trim()) return null;
  const t = parseTime(text);
  return t.ok ? t.value : null;
}
const decimal = (steps: readonly number[], unit: string, fromZero = false): NudgeSpec => ({
  steps,
  unit,
  parse: parseNumber,
  format: formatGrams,
  stepText: formatGrams,
  fromZero,
});

// Temp works in the person's unit (the box's text), so its unit is passed in.
export function nudgeSpec(key: NudgeKey, tempUnit = '°C'): NudgeSpec {
  switch (key) {
    case 'dose':
      return decimal([0.1, 0.5], 'g', true);
    case 'water':
      return decimal([1, 5], 'g', true);
    case 'yield':
      return decimal([0.5, 1], 'g');
    case 'brix':
      return decimal([0.1, 0.5], '°Bx');
    case 'tds':
      return decimal([0.01, 0.1], '%');
    case 'time':
      return { steps: [1, 5], unit: 's', parse: parseSeconds, format: formatTime, stepText: (s) => `${s}s` };
    case 'temp':
      return decimal([1, 5], tempUnit);
    case 'grind':
      return decimal([1, 5], '');
  }
}

// What the buttons do now: change the value, fill in the expected one first
// (shown greyed), or nothing (disabled) for this step.
export type NudgeMode = 'value' | 'expected' | 'off';
export function nudgeMode(text: string, spec: NudgeSpec, expected: number | null | undefined, delta: number): NudgeMode {
  if (spec.parse(text) !== null) return 'value';
  if (expected != null && Number.isFinite(expected)) return 'expected';
  return spec.fromZero && delta > 0 ? 'value' : 'off';
}

// The box's text after a tap, or null when the tap does nothing. On an empty
// box with an expected value, the step goes on top of it: + gives
// expected + step, − gives expected − step.
export function nudgeText(text: string, spec: NudgeSpec, delta: number, expected?: number | null): string | null {
  const mode = nudgeMode(text, spec, expected, delta);
  if (mode === 'off') return null;
  const base = mode === 'expected' ? (expected as number) : (spec.parse(text) ?? 0);
  const next = Math.round((base + delta) * 1000) / 1000;
  if (spec.fromZero) return next > 0 ? spec.format(next) : '';
  return spec.format(Math.max(0, next));
}

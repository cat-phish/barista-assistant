// Timer marks (docs/api/brew-logs.md §6): first drop, the real end of steps that
// wait for a tap or have a "Log it" button, and steps held on the timer.
import type { Mark } from '../api/types';
import { parseDecimal, type Parsed } from './format';

const isHoldMark = (m: Mark) => m.kind === 'step_hold' || m.kind === 'step_resume';

// Record (or re-record) a mark at t, to 0.1 s, keeping marks earliest first.
// Holds and resumes add to the step's list instead, each at least 0.1 s after
// the last (the API wants them in order).
export function withMark(marks: readonly Mark[], kind: Mark['kind'], t: number, stepOrder: number | null = null): Mark[] {
  let atSec = Math.round(t * 10) / 10;
  if (kind === 'step_hold' || kind === 'step_resume') {
    const last = marks.filter((m) => isHoldMark(m) && m.stepOrder === stepOrder).at(-1);
    if (last && atSec <= last.atSec) atSec = Math.round((last.atSec + 0.1) * 10) / 10;
    return [...marks, { kind, stepOrder, atSec }].sort((a, b) => a.atSec - b.atSec);
  }
  const same = (m: Mark) => m.kind === kind && m.stepOrder === stepOrder;
  return [...marks.filter((m) => !same(m)), { kind, stepOrder, atSec }].sort((a, b) => a.atSec - b.atSec);
}

// A step's holds, earliest first: from a step_hold to its step_resume (null:
// not resumed, so held until Next, or the end of the brew).
export function holdsOf(marks: readonly Mark[], stepOrder: number): Array<{ from: number; to: number | null }> {
  const holds: Array<{ from: number; to: number | null }> = [];
  for (const m of marks) {
    if (m.stepOrder !== stepOrder) continue;
    if (m.kind === 'step_hold') holds.push({ from: m.atSec, to: null });
    else if (m.kind === 'step_resume' && holds.length) holds[holds.length - 1]!.to = m.atSec;
  }
  return holds;
}

// How long a step was held, in seconds: a hold left open ends at the step's
// step_end (Next), or at `until` (now, or the brew's time).
export function heldSec(marks: readonly Mark[], stepOrder: number, until: number): number {
  const next = marks.find((m) => m.kind === 'step_end' && m.stepOrder === stepOrder)?.atSec ?? null;
  return holdsOf(marks, stepOrder).reduce((sum, h) => {
    const to = h.to ?? (next !== null && next >= h.from ? next : until);
    return sum + Math.max(0, to - h.from);
  }, 0);
}

// "0:07.4": seconds with one decimal.
export function formatMark(sec: number): string {
  const tenths = Math.round(sec * 10); // in tenths, so 7.96 becomes 0:08.0
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`;
}

// "7.4" (seconds) or "0:07.4" -> seconds; '' = not recorded.
export function parseMark(text: string): Parsed<number> | null {
  const t = text.trim();
  if (!t) return null;
  const mmss = /^(\d{1,3}):([0-5]\d(?:\.\d)?)$/.exec(t);
  if (mmss) return { ok: true, value: Math.round((Number(mmss[1]) * 60 + Number(mmss[2])) * 10) / 10 };
  return parseDecimal(t, { scale: 1, min: 0, max: 24 * 3600 });
}

// First drop against the recipe's window.
export function firstDropVerdict(at: number, window: { min: number; max: number } | null): 'early' | 'in the window' | 'late' | null {
  if (!window) return null;
  return at < window.min ? 'early' : at > window.max ? 'late' : 'in the window';
}

// Timer marks (docs/api/brew-logs.md §6): first drop, and the real end of steps that
// wait for a tap or have a "Log it" button.
import type { Mark } from '../api/types';
import { parseDecimal, type Parsed } from './format';

// Record (or re-record) a mark at t, to 0.1 s, keeping marks earliest first.
export function withMark(marks: readonly Mark[], kind: Mark['kind'], t: number, stepOrder: number | null = null): Mark[] {
  const atSec = Math.round(t * 10) / 10;
  const same = (m: Mark) => m.kind === kind && m.stepOrder === stepOrder;
  return [...marks.filter((m) => !same(m)), { kind, stepOrder, atSec }].sort((a, b) => a.atSec - b.atSec);
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

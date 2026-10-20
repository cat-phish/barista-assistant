// Shot timer logic (docs/timer_architecture.md, "Shot timer"): what the
// pre-infusion and first-drop cards show at elapsed time t, given the
// recipe, the machine's pre-infusion capability and the taps so far.
import type { Mark, MarkKind, Preinfusion, RecipeStep } from '../api/types';

export interface ShotPlan {
  preinfusion: { start: number; end: number } | null; // the recipe's pre-infusion step
  firstDrop: { min: number; max: number } | null; // target window
}

export function shotPlan(recipe: { steps: RecipeStep[]; firstDropMinSec: number | null; firstDropMaxSec: number | null }): ShotPlan {
  const step = recipe.steps.find((s) => s.stepType === 'preinfusion');
  return {
    preinfusion: step ? { start: step.startSec, end: step.endSec } : null,
    firstDrop: recipe.firstDropMinSec !== null && recipe.firstDropMaxSec !== null ? { min: recipe.firstDropMinSec, max: recipe.firstDropMaxSec } : null,
  };
}

export interface PreinfusionState {
  // Who ends it: the machine (automatic), the barista (manual; also when no
  // machine is chosen), or nobody (the machine can't pre-infuse).
  mode: 'automatic' | 'manual' | 'none';
  status: 'running' | 'due' | 'done' | 'skipped';
  endsAt: number; // planned end
  endedAt: number | null; // tapped end (manual)
  progress: number; // 0..1 through the planned window
}

export interface FirstDropState {
  status: 'waiting' | 'overdue' | 'recorded';
  at: number | null;
  verdict: 'early' | 'in_window' | 'late' | null; // null without a window
  progress: number; // 0..1 towards the window's end
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const markAt = (marks: readonly Mark[], kind: MarkKind) => marks.find((m) => m.kind === kind)?.atSec ?? null;

// machine: the machine's pre-infusion capability, or null when none is chosen.
export function shotState(plan: ShotPlan, machine: Preinfusion | null, t: number, marks: readonly Mark[]): { preinfusion: PreinfusionState | null; firstDrop: FirstDropState } {
  let preinfusion: PreinfusionState | null = null;
  if (plan.preinfusion) {
    const { start, end } = plan.preinfusion;
    const progress = end > start ? clamp((t - start) / (end - start)) : 1;
    const mode = machine === 'none' ? 'none' : machine === 'automatic' ? 'automatic' : 'manual';
    const endedAt = mode === 'manual' ? markAt(marks, 'preinfusion_end') : null;
    const status =
      mode === 'none' ? 'skipped' : endedAt !== null || (mode === 'automatic' && t >= end) ? 'done' : t >= end ? 'due' : 'running';
    preinfusion = { mode, status, endsAt: end, endedAt, progress: status === 'skipped' ? 0 : endedAt !== null ? 1 : progress };
  }

  const at = markAt(marks, 'first_drop');
  const w = plan.firstDrop;
  const firstDrop: FirstDropState =
    at !== null
      ? { status: 'recorded', at, verdict: w ? (at < w.min ? 'early' : at > w.max ? 'late' : 'in_window') : null, progress: 1 }
      : { status: w && t > w.max ? 'overdue' : 'waiting', at: null, verdict: null, progress: w && w.max > 0 ? clamp(t / w.max) : 0 };
  return { preinfusion, firstDrop };
}

// Record (or re-record) a tap at t, to 0.1 s, keeping marks earliest first.
export function withMark(marks: readonly Mark[], kind: MarkKind, t: number): Mark[] {
  const atSec = Math.round(t * 10) / 10;
  return [...marks.filter((m) => m.kind !== kind), { kind, atSec }].sort((a, b) => a.atSec - b.atSec);
}

// "0:07.4": seconds with one decimal, for marks.
export function formatMark(sec: number): string {
  const tenths = Math.round(sec * 10); // in tenths, so 7.96 becomes 0:08.0
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`;
}

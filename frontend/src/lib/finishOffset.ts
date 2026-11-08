// Finish offset (docs/api/brewers.md §3, docs/api/recipes.md §5): seconds
// taken off the brew time when Finish & Save is tapped, for brewers whose brew
// ends while your hands are busy (pressing an OXO until the hiss). Negative
// adds them instead, for tapping early.
import type { Brewer, Mark, Recipe } from '../api/types';
import { parseDecimal, type Parsed } from './format';

export const FINISH_OFFSET_MAX_SEC = 60;

// The form's text: blank = null (none, or for a recipe the brewer's). A sign
// in front (-, + or the typographic −) is allowed.
export function parseFinishOffset(text: string): Parsed<number | null> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  const negative = /^[-−]/.test(trimmed);
  const magnitude = parseDecimal(trimmed.replace(/^[-−+]\s*/, ''), { scale: 0, min: 0, max: FINISH_OFFSET_MAX_SEC });
  if (!magnitude.ok) {
    return magnitude.error.startsWith('Must be') ? { ok: false, error: `Must be between -${FINISH_OFFSET_MAX_SEC} and ${FINISH_OFFSET_MAX_SEC}` } : magnitude;
  }
  return { ok: true, value: negative && magnitude.value ? -magnitude.value : magnitude.value };
}

// The recipe's when it has one (0 = none), else its brewer's, else none.
export function finishOffsetFor(recipe: Pick<Recipe, 'finishOffsetSec'> | null, brewer: Pick<Brewer, 'finishOffsetSec'> | null): number {
  return recipe?.finishOffsetSec ?? brewer?.finishOffsetSec ?? 0;
}

// "−4 s" (taken off) or "+4 s" (added), for the Finish & Save button.
export function formatFinishOffset(offset: number): string {
  return `${offset > 0 ? '−' : '+'}${Math.abs(offset)} s`;
}

// The time at Finish & Save less the offset. Taking time off stops at the last
// mark (the API wants every mark within the time) and at 0; adding has no
// limit and leaves the marks as they are. takenOff: the seconds actually
// removed, negative when added, 0 when nothing changed.
export function applyFinishOffset(seconds: number, marks: readonly Mark[], offset: number): { seconds: number; marks: Mark[]; takenOff: number } {
  if (offset < 0) return { seconds: seconds - offset, marks: [...marks], takenOff: offset };
  const lastMark = marks.reduce((max, m) => Math.max(max, m.atSec), 0);
  const adjusted = Math.min(seconds, Math.max(seconds - offset, Math.ceil(lastMark), 0));
  return { seconds: adjusted, marks: marks.map((m) => ({ ...m, atSec: Math.min(m.atSec, adjusted) })), takenOff: seconds - adjusted };
}

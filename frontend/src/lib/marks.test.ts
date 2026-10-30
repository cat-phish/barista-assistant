import { describe, expect, it } from 'vitest';
import { firstDropVerdict, formatMark, heldSec, holdsOf, parseMark, withMark } from './marks';

describe('marks', () => {
  it('re-recording replaces the same mark (per step for step_end), earliest first', () => {
    let marks = withMark([], 'first_drop', 7.04);
    marks = withMark(marks, 'step_end', 5, 1);
    marks = withMark(marks, 'step_end', 12, 2);
    marks = withMark(marks, 'first_drop', 8);
    expect(marks).toEqual([
      { kind: 'step_end', stepOrder: 1, atSec: 5 },
      { kind: 'first_drop', stepOrder: null, atSec: 8 },
      { kind: 'step_end', stepOrder: 2, atSec: 12 },
    ]);
  });
  it('holds add up per step, each after the last; an open hold ends at Next or the end', () => {
    let marks = withMark([], 'step_hold', 10, 2);
    marks = withMark(marks, 'step_resume', 10.02, 2); // same tenth: nudged later
    marks = withMark(marks, 'step_hold', 20, 2);
    marks = withMark(marks, 'step_hold', 25, 3);
    expect(holdsOf(marks, 2)).toEqual([{ from: 10, to: 10.1 }, { from: 20, to: null }]);
    expect(heldSec(marks, 2, 30)).toBeCloseTo(10.1);
    expect(heldSec(withMark(marks, 'step_end', 24, 2), 2, 30)).toBeCloseTo(4.1);
    expect(heldSec(marks, 3, 30)).toBe(5);
    expect(heldSec(marks, 1, 30)).toBe(0);
  });
  it('formats and parses with tenths', () => {
    expect(formatMark(7.4)).toBe('0:07.4');
    expect(formatMark(7.96)).toBe('0:08.0');
    expect(parseMark('7.4')).toEqual({ ok: true, value: 7.4 });
    expect(parseMark('1:05.5')).toEqual({ ok: true, value: 65.5 });
    expect(parseMark('')).toBeNull();
    expect(parseMark('7.45')).toMatchObject({ ok: false });
  });
  it('judges the first drop against the window', () => {
    expect(firstDropVerdict(5, { min: 6, max: 9 })).toBe('early');
    expect(firstDropVerdict(7, { min: 6, max: 9 })).toBe('in the window');
    expect(firstDropVerdict(9.1, { min: 6, max: 9 })).toBe('late');
    expect(firstDropVerdict(7, null)).toBeNull();
  });
});

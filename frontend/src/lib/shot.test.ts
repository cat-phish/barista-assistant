import { describe, expect, it } from 'vitest';
import type { RecipeStep } from '../api/types';
import { formatMark, shotPlan, shotState, withMark } from './shot';

const pi: RecipeStep = { id: 'p', stepOrder: 1, stepType: 'preinfusion', label: null, startSec: 0, endSec: 8, targetWaterGrams: null };
const plan = shotPlan({ steps: [pi], firstDropMinSec: 6, firstDropMaxSec: 9 });

describe('shotPlan', () => {
  it('takes the pre-infusion step and the first-drop window', () => {
    expect(plan).toEqual({ preinfusion: { start: 0, end: 8 }, firstDrop: { min: 6, max: 9 } });
    expect(shotPlan({ steps: [], firstDropMinSec: null, firstDropMaxSec: null })).toEqual({ preinfusion: null, firstDrop: null });
  });
});

describe('pre-infusion by machine', () => {
  it('automatic runs on the clock', () => {
    expect(shotState(plan, 'automatic', 4, []).preinfusion).toMatchObject({ mode: 'automatic', status: 'running', progress: 0.5 });
    expect(shotState(plan, 'automatic', 8, []).preinfusion).toMatchObject({ status: 'done', progress: 1 });
  });
  it('manual (or no machine) counts down, then is due until tapped', () => {
    expect(shotState(plan, 'manual', 4, []).preinfusion).toMatchObject({ mode: 'manual', status: 'running' });
    expect(shotState(plan, null, 9, []).preinfusion).toMatchObject({ mode: 'manual', status: 'due', progress: 1 });
    const tapped = withMark([], 'preinfusion_end', 7.46);
    expect(shotState(plan, 'manual', 12, tapped).preinfusion).toMatchObject({ status: 'done', endedAt: 7.5 });
    // Tapping early ends it early.
    expect(shotState(plan, 'manual', 5, withMark([], 'preinfusion_end', 5)).preinfusion?.status).toBe('done');
  });
  it('a machine without pre-infusion skips it', () => {
    expect(shotState(plan, 'none', 4, []).preinfusion).toMatchObject({ mode: 'none', status: 'skipped', progress: 0 });
  });
  it('no pre-infusion step, no card', () => {
    expect(shotState({ ...plan, preinfusion: null }, 'manual', 4, []).preinfusion).toBeNull();
  });
});

describe('first drop', () => {
  it('waits, then is overdue past the window', () => {
    expect(shotState(plan, null, 4.5, []).firstDrop).toEqual({ status: 'waiting', at: null, verdict: null, progress: 0.5 });
    expect(shotState(plan, null, 9.5, []).firstDrop.status).toBe('overdue');
  });
  it('judges the tap against the window', () => {
    expect(shotState(plan, null, 20, withMark([], 'first_drop', 5)).firstDrop).toMatchObject({ status: 'recorded', at: 5, verdict: 'early' });
    expect(shotState(plan, null, 20, withMark([], 'first_drop', 7)).firstDrop.verdict).toBe('in_window');
    expect(shotState(plan, null, 20, withMark([], 'first_drop', 9.1)).firstDrop.verdict).toBe('late');
    expect(shotState({ ...plan, firstDrop: null }, null, 20, withMark([], 'first_drop', 7)).firstDrop.verdict).toBeNull();
  });
});

describe('marks', () => {
  it('re-tapping replaces, earliest first', () => {
    const marks = withMark(withMark([], 'first_drop', 7), 'preinfusion_end', 6);
    expect(marks).toEqual([{ kind: 'preinfusion_end', atSec: 6 }, { kind: 'first_drop', atSec: 7 }]);
    expect(withMark(marks, 'first_drop', 8.04)).toEqual([{ kind: 'preinfusion_end', atSec: 6 }, { kind: 'first_drop', atSec: 8 }]);
  });
  it('formats with tenths', () => {
    expect(formatMark(7.4)).toBe('0:07.4');
    expect(formatMark(65)).toBe('1:05.0');
    expect(formatMark(7.96)).toBe('0:08.0');
  });
});

import { describe, expect, it } from 'vitest';
import type { RecipeStep } from '../api/types';
import { finishStatus, formatFinishWindow, insertStepAfter, moveStep, parseFinishWindow, parseSteps, pourAmounts, recipeWarnings, stepTitle, timerPhase, type StepDraft } from './steps';

const d = (over: Partial<StepDraft>): StepDraft => ({ key: Math.random().toString(), stepType: 'pour', label: '', start: '0:00', end: '0:30', water: '', ...over });

describe('parseSteps', () => {
  it('parses typed, timed steps with gaps; drops water from non-water types', () => {
    const { steps, errors } = parseSteps([
      d({ stepType: 'bloom', end: '0:10', water: '45' }),
      d({ stepType: 'swirl', start: '0:10', end: '0:10', water: '99' }), // water ignored
      d({ stepType: 'bloom', label: ' Second bloom ', start: '0:30', end: '0:40', water: '90' }),
      d({ stepType: 'pour', start: '1:00', end: '2:00', water: '250' }),
    ]);
    expect(errors).toEqual({});
    expect(steps.map((s) => [s.stepType, s.label, s.startSec, s.endSec, s.targetWaterGrams])).toEqual([
      ['bloom', null, 0, 10, 45],
      ['swirl', null, 10, 10, null],
      ['bloom', 'Second bloom', 30, 40, 90],
      ['pour', null, 60, 120, 250],
    ]);
  });
  it('flags the same problems as the API, on the right step', () => {
    expect(parseSteps([d({ water: '' })]).errors).toEqual({ 0: 'Enter the weight to pour to' });
    expect(parseSteps([d({ start: '0:30', end: '0:10', water: '50' })]).errors).toEqual({ 0: 'Ends before it starts' });
    expect(parseSteps([d({ water: '50' }), d({ start: '0:20', end: '0:40', water: '80' })]).errors).toEqual({ 1: 'Starts before the previous step ends (0:30)' });
    expect(parseSteps([d({ water: '100' }), d({ start: '0:30', end: '0:40', water: '80' })]).errors).toEqual({ 1: 'Pour-to is a running total: at least 100 g' });
    expect(parseSteps([d({ start: 'x', water: '50' })]).errors[0]).toMatch(/^Start:/);
  });
  it("'other' takes optional water", () => {
    expect(parseSteps([d({ stepType: 'other', label: 'Remove filter' })]).errors).toEqual({});
  });
});

describe('pourAmounts and warnings', () => {
  it('per-step amount = difference from the previous water step', () => {
    expect(pourAmounts([{ targetWaterGrams: 45 }, { targetWaterGrams: null }, { targetWaterGrams: 150 }, { targetWaterGrams: 250 }])).toEqual([45, null, 105, 100]);
  });
  it('warns when steps and recipe disagree', () => {
    const steps = parseSteps([d({ water: '350', end: '2:30' })]).steps;
    expect(recipeWarnings({ waterGrams: 250, finishMaxSec: 120, steps })).toEqual([
      "The steps pour to 350 g, but the recipe's water is 250 g.",
      'The target finish window ends (2:00) before the last step does (2:30).',
    ]);
    expect(recipeWarnings({ waterGrams: 350, finishMaxSec: null, steps })).toEqual([]);
  });
  it('titles fall back to the type name', () => {
    expect(stepTitle({ stepType: 'wait', label: null })).toBe('Wait / drawdown');
    expect(stepTitle({ stepType: 'bloom', label: 'Second bloom' })).toBe('Second bloom');
  });
});

describe('timerPhase', () => {
  const s = (o: Partial<RecipeStep>): RecipeStep => ({ id: String(o.stepOrder), stepOrder: 1, stepType: 'pour', label: null, startSec: 0, endSec: 0, targetWaterGrams: null, ...o });
  const steps = [
    s({ stepOrder: 1, stepType: 'bloom', startSec: 0, endSec: 10, targetWaterGrams: 45 }),
    s({ stepOrder: 2, stepType: 'swirl', startSec: 10, endSec: 10 }),
    s({ stepOrder: 3, stepType: 'pour', startSec: 45, endSec: 90, targetWaterGrams: 250 }),
  ];
  it('shows the step whose window contains t, with its pour amount', () => {
    expect(timerPhase(steps, 3)).toMatchObject({ kind: 'step', index: 0, endsAt: 10, amount: 45 });
    expect(timerPhase(steps, 60)).toMatchObject({ kind: 'step', index: 2, endsAt: 90, amount: 205 });
  });
  it('keeps an instant step on screen briefly, then waits for the next', () => {
    expect(timerPhase(steps, 10)).toMatchObject({ kind: 'step', index: 1, endsAt: 12 });
    expect(timerPhase(steps, 11.5)).toMatchObject({ kind: 'step', index: 1 });
    expect(timerPhase(steps, 12)).toMatchObject({ kind: 'wait', nextIndex: 2, startsIn: 33 });
  });
  it("an instant step's display never overlaps the next step", () => {
    const tight = [s({ stepType: 'swirl', startSec: 10, endSec: 10 }), s({ stepOrder: 2, startSec: 11, endSec: 20, targetWaterGrams: 100 })];
    expect(timerPhase(tight, 10.5)).toMatchObject({ kind: 'step', index: 0, endsAt: 11 });
    expect(timerPhase(tight, 11)).toMatchObject({ kind: 'step', index: 1 });
  });
  it('waits before the first step, is done after the last, idle without steps', () => {
    const late = [s({ startSec: 5, endSec: 10, targetWaterGrams: 50 })];
    expect(timerPhase(late, 2)).toMatchObject({ kind: 'wait', nextIndex: 0, startsIn: 3 });
    expect(timerPhase(steps, 90)).toEqual({ kind: 'done' });
    expect(timerPhase([], 30)).toEqual({ kind: 'idle' });
  });
});

describe('moveStep (re-time to fit)', () => {
  // bloom 0:00-0:10, gap 20 s, second bloom 0:30-0:40, gap 20 s, pour 1:00-2:00
  const steps = [
    d({ key: 'a', stepType: 'bloom', start: '0:00', end: '0:10', water: '45' }),
    d({ key: 'b', stepType: 'bloom', start: '0:30', end: '0:40', water: '90' }),
    d({ key: 'c', stepType: 'pour', start: '1:00', end: '2:00', water: '250' }),
  ];
  const times = (list: StepDraft[]) => list.map((x) => `${x.key} ${x.start}-${x.end}`);

  it('keeps each step\'s length and leading gap, laid out in the new order', () => {
    expect(times(moveStep(steps, 2, 0))).toEqual(['c 0:20-1:20', 'a 1:20-1:30', 'b 1:50-2:00']);
    expect(times(moveStep(steps, 0, 2))).toEqual(['b 0:20-0:30', 'c 0:50-1:50', 'a 1:50-2:00']);
  });
  it('keeps everything else on the row (type, label, water, key)', () => {
    const moved = moveStep(steps, 2, 0);
    expect(moved[0]).toMatchObject({ key: 'c', stepType: 'pour', water: '250' });
  });
  it('no-ops for the same or out-of-range positions', () => {
    expect(moveStep(steps, 1, 1)).toBe(steps);
    expect(moveStep(steps, 0, 5)).toBe(steps);
  });
  it('rows with unparsed times keep their text and do not move the clock', () => {
    const withBad = [steps[0]!, d({ key: 'x', start: 'soon', end: '0:20', water: '60' }), steps[2]!];
    expect(times(moveStep(withBad, 0, 2))).toEqual(['x soon-0:20', 'c 0:50-1:50', 'a 1:50-2:00']);
  });
  it('the result still validates (no overlaps)', () => {
    const moved = moveStep(steps, 2, 0);
    expect(parseSteps(moved).errors[0]).toBeUndefined();
    expect(parseSteps(moved).errors).toEqual({ 1: 'Pour-to is a running total: at least 250 g', 2: 'Pour-to is a running total: at least 250 g' });
  });
});

describe('finish window', () => {
  it('one end alone gets the other ±15 s (same as the API)', () => {
    expect(parseFinishWindow('2:45', '')).toEqual({ ok: true, value: { min: 165, max: 180 } });
    expect(parseFinishWindow('', '3:15')).toEqual({ ok: true, value: { min: 180, max: 195 } });
    expect(parseFinishWindow('', '0:10')).toEqual({ ok: true, value: { min: 0, max: 10 } });
    expect(parseFinishWindow('', '')).toEqual({ ok: true, value: null });
    expect(parseFinishWindow('3:20', '3:00')).toMatchObject({ ok: false, error: '"From" is after "to"' });
    expect(parseFinishWindow('x', '')).toMatchObject({ ok: false });
  });
  it('formats and reports timer status', () => {
    expect(formatFinishWindow(165, 195)).toBe('2:45–3:15');
    expect(formatFinishWindow(180, 180)).toBe('3:00');
    expect(formatFinishWindow(null, null)).toBeNull();
    expect(finishStatus(165, 195, 125.2)).toBe('Target 2:45–3:15 · in 0:40');
    expect(finishStatus(165, 195, 170)).toBe('Target 2:45–3:15 · in the window');
    expect(finishStatus(165, 195, 207.5)).toBe('Target 2:45–3:15 · 0:12 over');
    expect(finishStatus(null, null, 10)).toBeNull();
  });
});

describe('insertStepAfter', () => {
  const times = (list: StepDraft[]) => list.map((x) => `${x.key} ${x.stepType} ${x.start}-${x.end}${x.water ? ` ${x.water}` : ''}`);
  // bloom 0:00-0:10, wait 20 s, pour 0:30-1:30
  const base = [
    d({ key: 'a', stepType: 'bloom', start: '0:00', end: '0:10', water: '45' }),
    d({ key: 'b', stepType: 'pour', start: '0:30', end: '1:30', water: '250' }),
  ];

  it('fits into a wait gap without moving anything', () => {
    const { steps, index } = insertStepAfter(base, 0, 'n');
    expect(index).toBe(1);
    expect(times(steps)).toEqual(['a bloom 0:00-0:10 45', 'n pour 0:10-0:20 45', 'b pour 0:30-1:30 250']);
    expect(parseSteps(steps).errors).toEqual({}); // valid as inserted
  });

  it('shifts later steps by just enough when the gap is too small', () => {
    const tight = [base[0]!, d({ key: 'b', stepType: 'pour', start: '0:15', end: '1:15', water: '250' }), d({ key: 'c', stepType: 'wait', start: '1:30', end: '2:00' })];
    const { steps } = insertStepAfter(tight, 0, 'n');
    expect(times(steps)).toEqual(['a bloom 0:00-0:10 45', 'n pour 0:10-0:20 45', 'b pour 0:20-1:20 250', 'c wait 1:35-2:05']);
  });

  it('back-to-back steps move by the full 10 s', () => {
    const backToBack = [base[0]!, d({ key: 'b', stepType: 'pour', start: '0:10', end: '0:40', water: '150' })];
    expect(times(insertStepAfter(backToBack, 0, 'n').steps)).toEqual(['a bloom 0:00-0:10 45', 'n pour 0:10-0:20 45', 'b pour 0:20-0:50 150']);
  });

  it('pour-to defaults to the running total, skipping non-water steps', () => {
    const withSwirl = [base[0]!, d({ key: 's', stepType: 'swirl', start: '0:10', end: '0:12' }), base[1]!];
    const { steps } = insertStepAfter(withSwirl, 1, 'n');
    expect(steps[2]).toMatchObject({ key: 'n', water: '45', start: '0:12', end: '0:22' });
  });

  it('ignores a bad index', () => {
    expect(insertStepAfter(base, 5, 'n')).toEqual({ steps: base, index: -1 });
  });
});

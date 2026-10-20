import { describe, expect, it } from 'vitest';
import type { Mark, StepFields } from '../api/types';
import {
  brewSchedule,
  finishStatus,
  formatFinishWindow,
  insertStepAfter,
  machineNote,
  moveStep,
  parseFinishWindow,
  parseSteps,
  plannedStarts,
  pourAmounts,
  recipeWarnings,
  stepDraft,
  stepInstruction,
  stepTitle,
  stepTypesFor,
} from './steps';

const step = (s: Partial<StepFields>): StepFields => ({
  stepType: 'pour', label: null, durationSec: 10, advance: 'auto', targetWaterGrams: null, targetTempC: null,
  pressureBar: null, pressureEndBar: null, flowRate: null, flowEndRate: null, ...s,
});
const draft = (s: Partial<StepFields> & { water?: string }) => ({ ...stepDraft('k', { durationSec: 10, ...s }), ...(s.water !== undefined ? { water: s.water } : {}) });
const mark = (kind: Mark['kind'], atSec: number, stepOrder: number | null = null): Mark => ({ kind, stepOrder, atSec });

describe('step types per kind', () => {
  it('pour over and espresso get their own types, both get Other', () => {
    expect(stepTypesFor('pour_over')).toEqual(['bloom', 'pour', 'swirl', 'stir', 'wait', 'press', 'other']);
    expect(stepTypesFor('espresso')).toEqual(['preinfusion', 'soak', 'pressure', 'flow', 'other']);
  });
});

describe('parseSteps', () => {
  it('parses durations, how each step moves on, and values', () => {
    const { steps, errors } = parseSteps(
      [
        draft({ stepType: 'bloom', durationSec: 45, advance: 'tap', targetWaterGrams: 50, targetTempC: 85 }),
        draft({ stepType: 'pour', durationSec: 30, targetWaterGrams: 250, targetTempC: 93 }),
        { ...draft({ stepType: 'wait', label: 'Drawdown' }), duration: '' }, // last: until you finish
      ],
      'pour_over',
    );
    expect(errors).toEqual({});
    expect(steps.map((s) => [s.stepType, s.durationSec, s.advance, s.targetWaterGrams, s.targetTempC, s.label])).toEqual([
      ['bloom', 45, 'tap', 50, 85, null],
      ['pour', 30, 'auto', 250, 93, null],
      ['wait', null, 'auto', null, null, 'Drawdown'],
    ]);
  });

  it('flags the same problems as the API, on the right step', () => {
    const open = { ...draft({ stepType: 'wait' }), duration: '' };
    expect(parseSteps([open, draft({ stepType: 'stir' })], 'pour_over').errors[0]).toMatch(/only the last step/);
    expect(parseSteps([{ ...open, advance: 'auto_log' }], 'pour_over').errors[0]).toMatch(/how long/);
    expect(parseSteps([draft({ stepType: 'pour', water: '' })], 'pour_over').errors[0]).toMatch(/weight to pour to/);
    expect(parseSteps([draft({ water: '100' }), draft({ water: '50' })], 'pour_over').errors[1]).toMatch(/running total/);
    expect(parseSteps([{ ...draft({ stepType: 'stir' }), duration: '1:7' }], 'pour_over').errors[0]).toMatch(/Time/);
    expect(parseSteps([{ ...draft({ stepType: 'stir' }), advance: 'first_drop' }], 'pour_over').errors[0]).toMatch(/espresso/);
    // A tap step's time is only a guide.
    expect(parseSteps([{ ...draft({ stepType: 'stir', advance: 'tap' }), duration: '' }, draft({ stepType: 'stir' })], 'pour_over').errors).toEqual({});
  });

  it('espresso: pressure/flow per type, ramps, one first-drop step; no water', () => {
    const profile = [
      { ...draft({ stepType: 'pressure', advance: 'first_drop' }), duration: '', pressure: '9' },
      draft({ stepType: 'soak', durationSec: 10 }),
      { ...draft({ stepType: 'flow' }), duration: '', flow: '4', flowEnd: '2' },
    ];
    const ok = parseSteps(profile, 'espresso');
    expect(ok.errors).toEqual({});
    expect(ok.steps.map((s) => [s.stepType, s.advance, s.durationSec, s.pressureBar, s.flowRate, s.flowEndRate])).toEqual([
      ['pressure', 'first_drop', null, 9, null, null],
      ['soak', 'auto', 10, null, null, null],
      ['flow', 'auto', null, null, 4, 2],
    ]);
    expect(parseSteps([{ ...draft({ stepType: 'pressure' }), pressure: '' }], 'espresso').errors[0]).toMatch(/pressure/);
    expect(parseSteps([{ ...draft({ stepType: 'flow' }), flowEnd: '2' }], 'espresso').errors[0]).toMatch(/flow/i);
    expect(parseSteps([{ ...draft({ stepType: 'preinfusion' }), pressure: '3', flow: '2' }], 'espresso').errors[0]).toMatch(/not both/);
    expect(parseSteps([{ ...draft({ stepType: 'pressure' }), pressure: '25' }], 'espresso').errors[0]).toMatch(/0–20/);
    const twoDrops = [{ ...draft({ stepType: 'soak', advance: 'first_drop' }) }, { ...draft({ stepType: 'soak', advance: 'first_drop' }) }];
    expect(parseSteps(twoDrops, 'espresso').errors[1]).toMatch(/Only one/);
    // A pour-over step left over after switching the method to espresso.
    expect(parseSteps([draft({ stepType: 'bloom', water: '50' })], 'espresso').errors[0]).toMatch(/shot profile step type/);
    // Water typed on an espresso "other" step is ignored, not sent.
    expect(parseSteps([{ ...draft({ stepType: 'other', label: 'x' }), water: '40' }], 'espresso').steps[0]?.targetWaterGrams).toBeNull();
  });
});

describe('planned starts', () => {
  it('add up durations; after a tap or first-drop step they are estimates; after an open step unknown', () => {
    expect(plannedStarts([step({ durationSec: 45, advance: 'tap' }), step({ durationSec: 30 }), step({ durationSec: null })])).toEqual([
      { at: 0, exact: true },
      { at: 45, exact: false },
      { at: 75, exact: false },
    ]);
    expect(plannedStarts([step({ durationSec: null, advance: 'first_drop' }), step({})])).toEqual([{ at: 0, exact: true }, null]);
  });
});

describe('what a card says', () => {
  it('instructions: pour-to with amount, pressure/flow (ramps), pump off', () => {
    expect(stepInstruction(step({ targetWaterGrams: 150 }), 100, 'g_s')).toBe('Pour to 150 g (+100)');
    expect(stepInstruction(step({ stepType: 'pressure', pressureBar: 9 }), null, 'g_s')).toBe('9 bar');
    expect(stepInstruction(step({ stepType: 'pressure', pressureBar: 9, pressureEndBar: 6 }), null, 'g_s')).toBe('9 → 6 bar');
    expect(stepInstruction(step({ stepType: 'flow', flowRate: 4, flowEndRate: 2 }), null, 'ml_s')).toBe('4 → 2 ml/s');
    expect(stepInstruction(step({ stepType: 'soak' }), null, 'g_s')).toBe('Pump off');
    expect(stepInstruction(step({ stepType: 'swirl' }), null, 'g_s')).toBeNull();
  });
  it("notes what the machine can't do", () => {
    const basic = { preinfusion: 'none', flowControl: 'none', pressureControl: 'none' } as const;
    expect(machineNote(step({ stepType: 'pressure', pressureBar: 6 }), basic)).toBe("Your machine can't set pressure");
    expect(machineNote(step({ stepType: 'flow', flowRate: 2 }), { ...basic, flowControl: 'manual' })).toBeNull();
    expect(machineNote(step({ stepType: 'preinfusion' }), basic)).toBe('Your machine has no pre-infusion');
    expect(machineNote(step({ stepType: 'pressure', pressureBar: 6 }), null)).toBeNull();
  });
  it('titles fall back to the type name', () => {
    expect(stepTitle({ stepType: 'soak', label: null })).toBe('Soak (pump off)');
    expect(stepTitle({ stepType: 'pour', label: ' Center pour ' })).toBe('Center pour');
  });
});

describe('brewSchedule', () => {
  // Bloom waits for the kettle (tap, 45 s guide), then a timed pour, then drawdown until finish.
  const v60 = [
    step({ stepType: 'bloom', durationSec: 45, advance: 'tap', targetWaterGrams: 50 }),
    step({ stepType: 'pour', durationSec: 30, targetWaterGrams: 250 }),
    step({ stepType: 'wait', durationSec: null }),
  ];

  it('a tap step waits; past its guide it is due; later steps follow the real tap', () => {
    expect(brewSchedule(v60, 20, [])).toMatchObject({ kind: 'step', index: 0, start: 0, end: null, guideEnd: 45, due: false, from: 0, to: 45, amount: 50 });
    expect(brewSchedule(v60, 50, [])).toMatchObject({ index: 0, due: true });
    const tapped = [mark('step_end', 52, 1)];
    expect(brewSchedule(v60, 60, tapped)).toMatchObject({ index: 1, start: 52, end: 82, amount: 200, prevIndex: 0, nextIndex: 2 });
    expect(brewSchedule(v60, 90, tapped, { finishMax: 180 })).toMatchObject({ index: 2, start: 82, end: null, from: 82, to: 180 });
  });

  it('auto steps run on the clock; a timed last step ends in done', () => {
    const timed = [step({ durationSec: 30, targetWaterGrams: 100 }), step({ durationSec: 30, targetWaterGrams: 200 })];
    expect(brewSchedule(timed, 45, [])).toMatchObject({ index: 1, start: 30, end: 60 });
    expect(brewSchedule(timed, 61, [])).toEqual({ kind: 'done', prevIndex: 1, from: 60 });
    // A logged moment doesn't change the schedule.
    expect(brewSchedule([step({ advance: 'auto_log', durationSec: 30 }), step({})], 35, [mark('step_end', 40, 1)])).toMatchObject({ index: 1, start: 30 });
  });

  it('an instant step shows briefly without delaying the next', () => {
    const steps = [step({ durationSec: 10 }), step({ stepType: 'swirl', durationSec: 0 }), step({ durationSec: 20 })];
    expect(brewSchedule(steps, 11, [])).toMatchObject({ index: 1, from: 10, to: 12 });
    expect(brewSchedule(steps, 12.5, [])).toMatchObject({ index: 2, start: 10, end: 30 });
  });

  it('espresso: first-drop step ends at the tap (or right away if it already happened)', () => {
    const profile = [
      step({ stepType: 'pressure', pressureBar: 9, advance: 'first_drop', durationSec: null }),
      step({ stepType: 'soak', durationSec: 10 }),
      step({ stepType: 'flow', flowRate: 4, flowEndRate: 2, durationSec: null }),
    ];
    expect(brewSchedule(profile, 5, [], { firstDropMax: 9 })).toMatchObject({ index: 0, end: null, to: 9 });
    expect(brewSchedule(profile, 10, [mark('first_drop', 7.4)])).toMatchObject({ index: 1, start: 7.4, end: 17.4 });
    expect(brewSchedule(profile, 20, [mark('first_drop', 7.4)])).toMatchObject({ index: 2, start: 17.4, end: null });
    // Timed pre-infusion first; the drop came during it, so the first-drop step ends as soon as it starts.
    const timed = [step({ stepType: 'preinfusion', durationSec: 8 }), step({ stepType: 'pressure', pressureBar: 9, advance: 'first_drop' }), step({ stepType: 'soak', durationSec: 5 })];
    expect(brewSchedule(timed, 9, [mark('first_drop', 6)])).toMatchObject({ index: 2, start: 8 });
  });

  it('idle without steps', () => {
    expect(brewSchedule([], 10, [])).toEqual({ kind: 'idle' });
  });
});

describe('editing the list', () => {
  it('moves without re-timing; no-ops out of range', () => {
    expect(moveStep(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    const list = ['a', 'b'];
    expect(moveStep(list, 0, 5)).toBe(list);
  });
  it('inserts a 10 s pour to the running total, or a soak for espresso', () => {
    const drafts = [draft({ stepType: 'bloom', targetWaterGrams: 50 }), draft({ stepType: 'stir' }), draft({ stepType: 'pour', targetWaterGrams: 250 })];
    const { steps, index } = insertStepAfter(drafts, 1, 'new', 'pour_over');
    expect(index).toBe(2);
    expect(steps[2]).toMatchObject({ key: 'new', stepType: 'pour', duration: '0:10', water: '50' });
    expect(insertStepAfter(drafts, -1, 'first', 'espresso').steps[0]).toMatchObject({ stepType: 'soak', duration: '0:10' });
    expect(insertStepAfter(drafts, 9, 'x', 'pour_over').index).toBe(-1);
  });
});

describe('pourAmounts and warnings', () => {
  it('per-step amount = difference from the previous water step', () => {
    expect(pourAmounts([{ targetWaterGrams: 50 }, { targetWaterGrams: null }, { targetWaterGrams: 250 }])).toEqual([50, null, 200]);
  });
  it('warns when steps and recipe disagree', () => {
    const steps = [step({ durationSec: 60, targetWaterGrams: 240 }), step({ durationSec: 120 })];
    expect(recipeWarnings({ waterGrams: 250, finishMaxSec: 150, steps })).toEqual([
      'The steps pour to 240 g, but the recipe\'s water is 250 g.',
      'The target finish window ends (2:30) before the steps do (3:00).',
    ]);
    expect(recipeWarnings({ waterGrams: 240, finishMaxSec: 200, steps })).toEqual([]);
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
    expect(parseFinishWindow('0:06', '', 3)).toEqual({ ok: true, value: { min: 6, max: 9 } });
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

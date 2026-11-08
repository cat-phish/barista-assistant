import { describe, expect, it } from 'vitest';
import type { Mark } from '../api/types';
import { applyFinishOffset, finishOffsetFor, formatFinishOffset, parseFinishOffset } from './finishOffset';

describe('parseFinishOffset', () => {
  it('blank is null; whole seconds 0-60', () => {
    expect(parseFinishOffset('  ')).toEqual({ ok: true, value: null });
    expect(parseFinishOffset('0')).toEqual({ ok: true, value: 0 });
    expect(parseFinishOffset('4')).toEqual({ ok: true, value: 4 });
    expect(parseFinishOffset('60')).toEqual({ ok: true, value: 60 });
    for (const bad of ['61', '-61', '2.5', '-2.5', 'x', '--3']) expect(parseFinishOffset(bad).ok, bad).toBe(false);
  });
  it('a sign in front: negative adds time', () => {
    expect(parseFinishOffset('-3')).toEqual({ ok: true, value: -3 });
    expect(parseFinishOffset('−3')).toEqual({ ok: true, value: -3 });
    expect(parseFinishOffset('+3')).toEqual({ ok: true, value: 3 });
    expect(parseFinishOffset('-60')).toEqual({ ok: true, value: -60 });
    expect(parseFinishOffset('-0')).toEqual({ ok: true, value: 0 });
    expect(parseFinishOffset('-61')).toEqual({ ok: false, error: 'Must be between -60 and 60' });
  });
});

describe('finishOffsetFor', () => {
  it("the recipe's wins, 0 included; else the brewer's; else none", () => {
    expect(finishOffsetFor({ finishOffsetSec: 6 }, { finishOffsetSec: 4 })).toBe(6);
    expect(finishOffsetFor({ finishOffsetSec: 0 }, { finishOffsetSec: 4 })).toBe(0);
    expect(finishOffsetFor({ finishOffsetSec: null }, { finishOffsetSec: 4 })).toBe(4);
    expect(finishOffsetFor(null, { finishOffsetSec: 4 })).toBe(4);
    expect(finishOffsetFor({ finishOffsetSec: null }, null)).toBe(0);
    expect(finishOffsetFor(null, { finishOffsetSec: null })).toBe(0);
  });
});

describe('applyFinishOffset', () => {
  const end = (atSec: number): Mark => ({ kind: 'step_end', stepOrder: 1, atSec });

  it('takes the offset off the time', () => {
    expect(applyFinishOffset(196, [end(60)], 4)).toEqual({ seconds: 192, marks: [end(60)], takenOff: 4 });
  });
  it('no offset changes nothing', () => {
    expect(applyFinishOffset(196, [end(60)], 0)).toEqual({ seconds: 196, marks: [end(60)], takenOff: 0 });
  });
  it('stops at the last mark, rounded up to a whole second', () => {
    expect(applyFinishOffset(196, [end(60), end(193.4)], 10)).toEqual({ seconds: 194, marks: [end(60), end(193.4)], takenOff: 2 });
  });
  it('a negative offset adds time and leaves the marks', () => {
    expect(applyFinishOffset(196, [end(60), end(195)], -3)).toEqual({ seconds: 199, marks: [end(60), end(195)], takenOff: -3 });
  });
  it('never below 0', () => {
    expect(applyFinishOffset(3, [], 10)).toEqual({ seconds: 0, marks: [], takenOff: 3 });
  });
});

describe('formatFinishOffset', () => {
  it('minus for time taken off, plus for time added', () => {
    expect(formatFinishOffset(4)).toBe('−4 s');
    expect(formatFinishOffset(-3)).toBe('+3 s');
  });
});

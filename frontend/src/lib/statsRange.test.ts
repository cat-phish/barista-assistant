import { describe, expect, it } from 'vitest';
import { formatChartPeriod, inRange, parseChartPeriod, resolveRange, widestRange } from './statsRange';

describe('resolveRange', () => {
  it('counts back from today, today included', () => {
    expect(resolveRange({ range: '30d', from: '', to: '' }, '2026-10-29')).toEqual({ from: '2026-09-30', to: '2026-10-29' });
  });
  it('leaves all time open', () => {
    expect(resolveRange({ range: 'all', from: '', to: '' }, '2026-10-29')).toEqual({ from: null, to: null });
  });
  it('swaps custom dates typed the wrong way round and drops bad ones', () => {
    expect(resolveRange({ range: 'custom', from: '2026-05-01', to: '2026-02-01' }, '2026-10-29')).toEqual({ from: '2026-02-01', to: '2026-05-01' });
    expect(resolveRange({ range: 'custom', from: 'nope', to: '2026-02-01' }, '2026-10-29')).toEqual({ from: null, to: '2026-02-01' });
  });
});

describe('widestRange', () => {
  it('takes the earliest start and the latest end', () => {
    expect(widestRange([{ from: '2026-09-30', to: '2026-10-29' }, { from: '2026-01-01', to: '2026-03-01' }])).toEqual({ from: '2026-01-01', to: '2026-10-29' });
  });
  it('stays open when any side is open', () => {
    expect(widestRange([{ from: '2026-09-30', to: '2026-10-29' }, { from: null, to: '2026-03-01' }])).toEqual({ from: null, to: '2026-10-29' });
  });
});

describe('inRange', () => {
  it('includes both ends', () => {
    const r = { from: '2026-01-01', to: '2026-01-31' };
    expect([inRange('2026-01-01', r), inRange('2026-01-31', r), inRange('2026-02-01', r)]).toEqual([true, true, false]);
    expect(inRange('1999-01-01', { from: null, to: null })).toBe(true);
  });
});

describe('chart periods in the URL', () => {
  it('round-trips a range key and custom dates', () => {
    for (const p of [{ range: '90d', from: '', to: '' }, { range: 'custom', from: '2026-01-01', to: '' }] as const) {
      expect(parseChartPeriod(formatChartPeriod(p))).toEqual(p);
    }
  });
  it('follows the page for anything else', () => {
    expect(parseChartPeriod('custom')).toBeNull();
    expect(parseChartPeriod('5d')).toBeNull();
    expect(parseChartPeriod(undefined)).toBeNull();
  });
});

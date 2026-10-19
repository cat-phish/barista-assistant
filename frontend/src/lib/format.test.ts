import { describe, expect, it } from 'vitest';
import { formatRatio, formatTime, localDateInput, parseDecimal, parseSteps, parseTime, toDateInput } from './format';

describe('parseDecimal', () => {
  const dose = { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true };
  it('accepts dots and commas', () => {
    expect(parseDecimal('18.5', dose)).toEqual({ ok: true, value: 18.5 });
    expect(parseDecimal(' 18,25 ', dose)).toEqual({ ok: true, value: 18.25 });
  });
  it('mirrors the API limits', () => {
    expect(parseDecimal('15.123', dose)).toMatchObject({ ok: false, error: 'At most 2 decimal places' });
    expect(parseDecimal('0', dose)).toMatchObject({ ok: false, error: 'Must be more than 0' });
    expect(parseDecimal('1000', dose)).toMatchObject({ ok: false, error: 'Must be less than 1000' });
    expect(parseDecimal('100', { scale: 1, min: 0, max: 100 })).toEqual({ ok: true, value: 100 });
    expect(parseDecimal('93.25', { scale: 1, min: 0, max: 100 })).toMatchObject({ ok: false, error: 'At most 1 decimal place' });
  });
  it('rejects non-numbers', () => {
    for (const bad of ['', 'abc', '-5', '1e3', '1.2.3']) expect(parseDecimal(bad, dose).ok, bad).toBe(false);
  });
});

describe('time', () => {
  it('formats and parses m:ss', () => {
    expect(formatTime(150)).toBe('2:30');
    expect(formatTime(5)).toBe('0:05');
    expect(parseTime('2:30')).toEqual({ ok: true, value: 150 });
    expect(parseTime('45')).toEqual({ ok: true, value: 45 });
    expect(parseTime('2:75').ok).toBe(false);
    expect(parseTime('abc').ok).toBe(false);
    expect(parseTime('1441:00').ok).toBe(false);
  });
});

describe('parseSteps', () => {
  it('parses valid cumulative steps', () => {
    const { steps, errors } = parseSteps([
      { actionName: ' Bloom ', time: '0:45', water: '50' },
      { actionName: 'Pour', time: '2:00', water: '250' },
      { actionName: 'Drawdown', time: '3:00', water: '250' }, // same weight is fine
    ]);
    expect(errors).toEqual({});
    expect(steps).toEqual([
      { actionName: 'Bloom', targetTimeSec: 45, targetWaterGrams: 50 },
      { actionName: 'Pour', targetTimeSec: 120, targetWaterGrams: 250 },
      { actionName: 'Drawdown', targetTimeSec: 180, targetWaterGrams: 250 },
    ]);
  });
  it('flags non-increasing times and decreasing water on the offending step', () => {
    expect(parseSteps([
      { actionName: 'A', time: '1:00', water: '100' },
      { actionName: 'B', time: '1:00', water: '150' },
    ]).errors).toEqual({ 1: 'Must end after the previous step (1:00)' });
    expect(parseSteps([
      { actionName: 'A', time: '1:00', water: '100' },
      { actionName: 'B', time: '2:00', water: '90' },
    ]).errors).toEqual({ 1: 'Water is cumulative: at least 100 g' });
  });
  it('requires a name', () => {
    expect(parseSteps([{ actionName: ' ', time: '0:30', water: '40' }]).errors[0]).toMatch(/Name this step/);
  });
});

describe('dates and ratios', () => {
  it('handles dates as calendar days', () => {
    expect(toDateInput('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(toDateInput(null)).toBe('');
    expect(localDateInput(new Date(2026, 9, 19, 23, 59))).toBe('2026-10-19'); // local, not UTC
  });
  it('formats brew ratios', () => {
    expect(formatRatio(15, 250)).toBe('1:16.7');
    expect(formatRatio(18, 36)).toBe('1:2');
  });
});

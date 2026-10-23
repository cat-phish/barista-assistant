import { describe, expect, it } from 'vitest';
import { formatRatio, formatTime, localDateInput, parseDecimal, parseTime, toDateInput } from './format';

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
    // Long cold brews: hours, up to 7 days.
    expect(formatTime(57600)).toBe('16:00:00');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(parseTime('16:00:00')).toEqual({ ok: true, value: 57600 });
    expect(parseTime('169:00:00').ok).toBe(false);
    expect(parseTime('2:75').ok).toBe(false);
    expect(parseTime('abc').ok).toBe(false);
    expect(parseTime('604801').ok).toBe(false); // over 7 days
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

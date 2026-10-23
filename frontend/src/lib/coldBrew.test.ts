import { describe, expect, it } from 'vitest';
import { dilutionText, hoursText, isColdStyle, isLongStyle, parseSteepWindow, steepWindowText } from './coldBrew';
import { usesWater } from './extraction';

describe('cold styles', () => {
  it('long ones steep for hours; rapid cold is cold but timed', () => {
    expect([isLongStyle('cold_brew'), isLongStyle('kyoto_drip'), isLongStyle('rapid_cold'), isLongStyle(null)]).toEqual([true, true, false, false]);
    expect([isColdStyle('rapid_cold'), isColdStyle('pour_over')]).toEqual([true, false]);
  });
  it('rapid cold and cold brew are immersion for extraction; Kyoto drip is percolation', () => {
    expect([usesWater('cold_brew'), usesWater('rapid_cold'), usesWater('kyoto_drip')]).toEqual([true, true, false]);
  });
  it('describes the steep window and the dilution', () => {
    expect(steepWindowText(12, 18)).toBe('12–18 h');
    expect(steepWindowText(16, 16)).toBe('16 h');
    expect(steepWindowText(null, null)).toBe('');
    expect(dilutionText(1, 'water')).toBe('1 : 1 with water');
    expect(dilutionText(0.5, null)).toBe('1 : 0.5');
    expect(dilutionText(null, 'milk')).toBe('');
  });
  it('reads a steep window typed in hours: both ends or neither, in order', () => {
    expect(parseSteepWindow('12', '18')).toEqual({ ok: true, value: { min: 12, max: 18 } });
    expect(parseSteepWindow(' 2,5 ', '4')).toEqual({ ok: true, value: { min: 2.5, max: 4 } });
    expect(parseSteepWindow('', ' ')).toEqual({ ok: true, value: null });
    expect(parseSteepWindow('12', '')).toEqual({ ok: false, error: 'Enter both ends, or neither' });
    expect(parseSteepWindow('18', '12')).toEqual({ ok: false, error: '"To" must not be less than "from"' });
    expect(parseSteepWindow('0.2', '1')).toEqual({ ok: false, error: 'From: Must be at least 0.5' });
    expect(parseSteepWindow('12', '80')).toEqual({ ok: false, error: 'To: Must be at most 72' });
    expect([hoursText(12), hoursText(2.5), hoursText(null)]).toEqual(['12', '2.5', '']);
  });
});

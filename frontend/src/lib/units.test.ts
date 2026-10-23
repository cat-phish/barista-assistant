import { describe, expect, it } from 'vitest';
import { altitudeText, formatAltitude, formatTemp, formatTempChange, gramsToVolume, parseAltitude, parseTemp, tempText, volumeUnits } from './units';

describe('temperature', () => {
  it('shows °C as stored and °F rounded', () => {
    expect(formatTemp(93.5, 'c')).toBe('93.5 °C');
    expect(formatTemp(93.3, 'f')).toBe('200 °F');
  });

  it('round-trips form text without drifting', () => {
    for (const c of [0, 85, 93.3, 94, 96.5, 100]) {
      const back = parseTemp(tempText(c, 'f'), 'f');
      expect(back).toEqual({ ok: true, value: c });
    }
    expect(tempText(null, 'f')).toBe('');
  });

  it('parses °F into °C and keeps the 0–100 °C range', () => {
    expect(parseTemp('200', 'f')).toEqual({ ok: true, value: 93.3 });
    expect(parseTemp('213', 'f').ok).toBe(false);
    expect(parseTemp('31', 'f').ok).toBe(false);
    expect(parseTemp('94', 'c')).toEqual({ ok: true, value: 94 });
  });

  it('converts a suggested change', () => {
    expect(formatTempChange(0, 'f')).toBe('Keep the temperature');
    expect(formatTempChange(1, 'f')).toBe('+2 °F');
    expect(formatTempChange(-1.5, 'f')).toBe('−2.5 °F');
    expect(formatTempChange(-1.5, 'c')).toBe('−1.5 °C');
  });
});

describe('altitude', () => {
  it('shows and takes feet, storing whole metres', () => {
    expect(formatAltitude(1950, 'm')).toBe('1,950 m');
    expect(formatAltitude(1950, 'ft')).toBe('6,398 ft');
    expect(altitudeText(1950, 'ft')).toBe('6398');
    expect(parseAltitude('6398', 'ft')).toEqual({ ok: true, value: 1950 });
    for (const m of [0, 1, 1200, 1950, 2345, 9000]) expect(parseAltitude(altitudeText(m, 'ft'), 'ft')).toEqual({ ok: true, value: m });
    expect(parseAltitude('29529', 'ft').ok).toBe(false);
  });
});

describe('volume', () => {
  it('lists the units to show and converts grams', () => {
    expect(volumeUnits('fl_oz', false)).toEqual(['fl_oz']);
    expect(volumeUnits('ml', true)).toEqual(['ml', 'fl_oz']);
    expect(gramsToVolume(355, 'fl_oz')).toBe(12);
    expect(gramsToVolume(354.6, 'ml')).toBe(355);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../composables/usePreferences';
import { NUDGE_OPTIONS, nudgeAllState, nudgeMode, nudgeSpec, nudgeText, withNudge } from './nudge';

describe('nudge preference list', () => {
  it('offers every key once, and the default is dose and water', () => {
    const keys = NUDGE_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['dose', 'water', 'yield', 'brix', 'tds', 'time', 'temp', 'grind']);
    expect(DEFAULT_PREFERENCES.nudgeButtons).toEqual(['dose', 'water']);
  });
  it('switches one field, keeping the options order and each once', () => {
    expect(withNudge(['water', 'dose'], 'tds', true)).toEqual(['dose', 'water', 'tds']);
    expect(withNudge(['dose', 'water'], 'dose', false)).toEqual(['water']);
    expect(withNudge(['dose', 'dose'], 'dose', true)).toEqual(['dose']);
  });
  it('the master switch is all, none or some', () => {
    expect(nudgeAllState([])).toBe('none');
    expect(nudgeAllState(['dose'])).toBe('some');
    expect(nudgeAllState(NUDGE_OPTIONS.map((o) => o.key))).toBe('all');
  });
});

describe('nudgeText', () => {
  it('dose and water behave as before: empty counts as 0 for +, − needs a value, 0 or less empties', () => {
    const dose = nudgeSpec('dose');
    expect(nudgeText('', dose, 0.5)).toBe('0.5');
    expect(nudgeMode('', dose, null, -0.1)).toBe('off');
    expect(nudgeText('', dose, -0.1)).toBeNull();
    expect(nudgeText('18', dose, 0.1)).toBe('18.1');
    expect(nudgeText('0.3', dose, -0.5)).toBe('');
    expect(nudgeText('250,5', nudgeSpec('water'), -1)).toBe('249.5');
  });
  it('an empty box with an expected value: the first tap fills it and steps', () => {
    const tds = nudgeSpec('tds');
    expect(nudgeMode('', tds, 1.38, 0.01)).toBe('expected');
    expect(nudgeText('', tds, 0.01, 1.38)).toBe('1.39');
    expect(nudgeText('', tds, -0.1, 1.38)).toBe('1.28');
    expect(nudgeText('1.38', tds, 0.1, 9)).toBe('1.48'); // a value wins over the expected one
    expect(nudgeText('', nudgeSpec('yield'), 1, 36)).toBe('37');
  });
  it('without an expected value an empty box stays off', () => {
    for (const key of ['yield', 'brix', 'tds', 'time', 'temp', 'grind'] as const) {
      expect(nudgeMode('', nudgeSpec(key), null, 1), key).toBe('off');
      expect(nudgeText('', nudgeSpec(key), 1), key).toBeNull();
    }
  });
  it('never goes below 0', () => {
    expect(nudgeText('', nudgeSpec('brix'), -0.5, 0.2)).toBe('0');
    expect(nudgeText('0.05', nudgeSpec('tds'), -0.1)).toBe('0');
  });
  it('time steps seconds and writes m:ss back', () => {
    const time = nudgeSpec('time');
    expect(nudgeText('2:59', time, 1)).toBe('3:00');
    expect(nudgeText('3:00', time, -5)).toBe('2:55');
    expect(nudgeText('', time, 5, 150)).toBe('2:35');
    expect(nudgeText('0:03', time, -5)).toBe('0:00');
    expect(nudgeText('59:58', time, 5)).toBe('1:00:03');
    expect(nudgeMode('3:7', time, null, 1)).toBe('off'); // not a time yet
  });
  it('temp and grind step the number as typed', () => {
    expect(nudgeText('93', nudgeSpec('temp'), 1)).toBe('94');
    expect(nudgeText('199.4', nudgeSpec('temp', '°F'), -5)).toBe('194.4');
    expect(nudgeText('20', nudgeSpec('grind'), -1)).toBe('19');
    expect(nudgeText('4.25', nudgeSpec('grind'), 5)).toBe('9.25');
  });
});

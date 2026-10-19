import { describe, expect, it } from 'vitest';
import type { BrewLog } from '../api/types';
import { draftFromLog, emptyDraft, parseBrewDraft } from './brewDraft';

describe('parseBrewDraft', () => {
  it('parses a complete draft, trimming text and blanking empty optionals', () => {
    const draft = { dose: '18,5', yieldGrams: '36', temp: '', grinderId: '', grind: '  ', time: '0:28', rating: 4, notes: ' Bright ' };
    expect(parseBrewDraft(draft)).toEqual({
      errors: {},
      values: { actualDoseGrams: 18.5, actualYieldGrams: 36, actualTempC: null, grinderId: null, actualGrindSetting: null, actualTimeSec: 28, rating: 4, tastingNotes: 'Bright' },
    });
  });
  it('reports every invalid field and returns no values', () => {
    const { errors, values } = parseBrewDraft({ ...emptyDraft(), temp: '120' });
    expect(values).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['dose', 'temp', 'time', 'yieldGrams']);
  });
});

describe('draftFromLog', () => {
  it('round-trips a stored brew log', () => {
    const log = { actualDoseGrams: 15, actualYieldGrams: 250.5, actualTempC: 93.5, grinderId: 'g1', actualGrindSetting: '20 clicks', actualTimeSec: 150, rating: null, tastingNotes: null } as BrewLog;
    const draft = draftFromLog(log);
    expect(draft).toEqual({ dose: '15', yieldGrams: '250.5', temp: '93.5', grinderId: 'g1', grind: '20 clicks', time: '2:30', rating: null, notes: '' });
    expect(parseBrewDraft(draft).values).toMatchObject({ actualDoseGrams: 15, actualYieldGrams: 250.5, actualTempC: 93.5, grinderId: 'g1', actualTimeSec: 150 });
  });
});

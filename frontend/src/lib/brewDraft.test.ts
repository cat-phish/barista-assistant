import { describe, expect, it } from 'vitest';
import type { BrewLog } from '../api/types';
import { draftFromLog, emptyDraft, parseBrewDraft } from './brewDraft';

describe('parseBrewDraft', () => {
  it('parses a complete draft, trimming text and blanking empty optionals', () => {
    const draft = { dose: '18,5', water: '250', yieldGrams: '', temp: '', grinderId: '', machineId: 'm1', firstDrop: '', grind: '  ', time: '0:28', rating: 4, notes: ' Bright ' };
    expect(parseBrewDraft(draft)).toEqual({
      errors: {},
      firstDropSec: null,
      values: { actualDoseGrams: 18.5, actualWaterGrams: 250, actualYieldGrams: null, actualTempC: null, grinderId: null, machineId: null, actualGrindSetting: null, actualTimeSec: 28, rating: 4, tastingNotes: 'Bright' },
    });
  });
  it('reports every invalid field and returns no values', () => {
    const { errors, values } = parseBrewDraft({ ...emptyDraft(), temp: '120', yieldGrams: 'lots' });
    expect(values).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['dose', 'temp', 'time', 'water', 'yieldGrams']);
  });
  it('measured yield is optional', () => {
    const ok = parseBrewDraft({ ...emptyDraft(), dose: '15', water: '250', yieldGrams: '226.5', time: '3:00' });
    expect(ok.values).toMatchObject({ actualWaterGrams: 250, actualYieldGrams: 226.5 });
  });
});

describe('parseBrewDraft for espresso', () => {
  const shot = { ...emptyDraft(), dose: '18', water: '250', time: '0:28' };
  it('needs the shot weight and sends no water', () => {
    expect(parseBrewDraft(shot, 'espresso').errors).toEqual({ yieldGrams: 'Enter the shot weight' });
    expect(parseBrewDraft({ ...shot, yieldGrams: '36.5', machineId: 'm1' }, 'espresso').values).toMatchObject({ actualWaterGrams: null, actualYieldGrams: 36.5, machineId: 'm1' });
  });
  it('first drop: optional seconds, within the shot, only for espresso', () => {
    const done = { ...shot, yieldGrams: '36' };
    expect(parseBrewDraft({ ...done, firstDrop: '7.4' }, 'espresso').firstDropSec).toBe(7.4);
    expect(parseBrewDraft({ ...done, firstDrop: '' }, 'espresso').firstDropSec).toBeNull();
    expect(parseBrewDraft({ ...done, firstDrop: '30' }, 'espresso').errors.firstDrop).toMatch(/end of the shot/);
    expect(parseBrewDraft({ ...done, firstDrop: 'soon' }, 'espresso').values).toBeNull();
    expect(parseBrewDraft({ ...done, firstDrop: '7.4', water: '250' }, 'pour_over').firstDropSec).toBeNull();
  });
  it('other kinds still need water', () => {
    expect(parseBrewDraft({ ...shot, water: '' }, 'pour_over').errors).toHaveProperty('water');
    expect(parseBrewDraft({ ...shot, water: '' }, null).errors).toHaveProperty('water');
  });
});

describe('draftFromLog', () => {
  it('round-trips a stored brew log', () => {
    const log = { actualDoseGrams: 15, actualWaterGrams: 250.5, actualYieldGrams: null, actualTempC: 93.5, grinderId: 'g1', actualGrindSetting: '20 clicks', actualTimeSec: 150, rating: null, tastingNotes: null } as BrewLog;
    const draft = draftFromLog(log);
    expect(draft).toEqual({ dose: '15', water: '250.5', yieldGrams: '', temp: '93.5', grinderId: 'g1', machineId: '', firstDrop: '', grind: '20 clicks', time: '2:30', rating: null, notes: '' });
    expect(parseBrewDraft(draft).values).toMatchObject({ actualDoseGrams: 15, actualWaterGrams: 250.5, actualYieldGrams: null, actualTempC: 93.5, grinderId: 'g1', actualTimeSec: 150 });
  });
});

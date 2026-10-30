import { describe, expect, it } from 'vitest';
import type { BrewLog } from '../api/types';
import { draftFromLog, emptyDraft, parseBrewDraft } from './brewDraft';

describe('parseBrewDraft', () => {
  it('parses a complete draft, trimming text and blanking empty optionals', () => {
    const draft = { dose: '18,5', water: '250', ice: '', yieldGrams: '', tds: '', temp: '', grinderId: '', waterProfileId: '', toolIds: [], problemIds: [], flavors: [], firstDrop: '', grind: '  ', rpm: '', beanIn: '', groundOut: '', steepTemp: '' as const, dilution: '', dilutedWith: '' as const, time: '0:28', rating: 4, notes: ' Bright ', drinkRating: 5, drinkNotes: ' Sweet ' };
    expect(parseBrewDraft(draft)).toEqual({
      errors: {},
      firstDropSec: null,
      values: { actualDoseGrams: 18.5, actualWaterGrams: 250, actualIceGrams: null, actualYieldGrams: null, tdsPercent: null, actualTempC: null, grinderId: null, waterProfileId: null, toolIds: [], problemIds: [], flavors: [], actualGrindSetting: null, grindRpm: null, beanWeightInGrams: null, groundWeightOutGrams: null, steepTemp: null, dilutionRatio: null, dilutedWith: null, actualTimeSec: 28, rating: 4, tastingNotes: 'Bright', drinkRating: null, drinkTastingNotes: null },
    });
  });
  it("sends the drink's own rating and notes only for a drink with ingredients", () => {
    const draft = { ...emptyDraft(), dose: '18', water: '250', time: '0:28', rating: null, drinkRating: 4, drinkNotes: ' caramel ' };
    expect(parseBrewDraft(draft, 'filter', true).values).toMatchObject({ rating: null, drinkRating: 4, drinkTastingNotes: 'caramel' });
    expect(parseBrewDraft(draft, 'filter', false).values).toMatchObject({ drinkRating: null, drinkTastingNotes: null });
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
  it('TDS is optional: > 0, at most 30, two decimals', () => {
    const base = { ...emptyDraft(), dose: '15', water: '250', time: '3:00' };
    expect(parseBrewDraft({ ...base, tds: '1,38' }).values).toMatchObject({ tdsPercent: 1.38 });
    expect(parseBrewDraft(base).values).toMatchObject({ tdsPercent: null });
    for (const tds of ['0', '30.01', '1.385', 'high']) {
      expect(parseBrewDraft({ ...base, tds }).errors.tds, tds).toBeTruthy();
    }
  });
});

describe('grind speed', () => {
  const base = { ...emptyDraft(), dose: '15', water: '250', time: '3:00', rpm: '900' };
  const ek = { variableSpeed: true, rpmMin: 300, rpmMax: 1500 };
  it('is sent only for a variable-speed grinder', () => {
    expect(parseBrewDraft(base, null, false, 'c', ek).values).toMatchObject({ grindRpm: 900 });
    expect(parseBrewDraft(base, null, false, 'c', { ...ek, variableSpeed: false }).values).toMatchObject({ grindRpm: null });
    expect(parseBrewDraft(base).values).toMatchObject({ grindRpm: null });
    expect(parseBrewDraft({ ...base, rpm: '' }, null, false, 'c', ek).values).toMatchObject({ grindRpm: null });
  });
  it("is a whole number within the grinder's range", () => {
    expect(parseBrewDraft({ ...base, rpm: '1600' }, null, false, 'c', ek).errors.rpm).toMatch(/300–1500/);
    expect(parseBrewDraft({ ...base, rpm: '900.5' }, null, false, 'c', ek).errors.rpm).toBeTruthy();
    expect(parseBrewDraft({ ...base, rpm: '4000' }, null, false, 'c', { ...ek, rpmMin: null, rpmMax: null }).values).toMatchObject({ grindRpm: 4000 });
    expect(parseBrewDraft({ ...base, rpm: '6000' }, null, false, 'c', { ...ek, rpmMin: null, rpmMax: null }).errors.rpm).toBeTruthy();
  });
});

describe('grind setting', () => {
  const base = { ...emptyDraft(), dose: '15', water: '250', time: '3:00' };
  it("is the number on the grinder's dial, at most 2 decimals; blank is none", () => {
    expect(parseBrewDraft({ ...base, grind: ' 20,5 ' }).values).toMatchObject({ actualGrindSetting: 20.5 });
    expect(parseBrewDraft({ ...base, grind: '0' }).values).toMatchObject({ actualGrindSetting: 0 });
    expect(parseBrewDraft(base).values).toMatchObject({ actualGrindSetting: null });
    for (const grind of ['18 clicks', '4.125', '10000']) expect(parseBrewDraft({ ...base, grind }).errors.grind, grind).toBeTruthy();
  });
});

describe('cold styles', () => {
  const base = { ...emptyDraft(), dose: '100', water: '800', time: '16:00:00' };
  it('records where it steeped and how it was served', () => {
    expect(parseBrewDraft({ ...base, steepTemp: 'fridge', dilution: '1', dilutedWith: 'water' }).values).toMatchObject({
      actualTimeSec: 57600, steepTemp: 'fridge', dilutionRatio: 1, dilutedWith: 'water',
    });
    expect(parseBrewDraft(base).values).toMatchObject({ steepTemp: null, dilutionRatio: null, dilutedWith: null });
    expect(parseBrewDraft({ ...base, dilution: '0' }).errors.dilution).toBeTruthy();
    // What it was diluted with only counts with a dilution.
    expect(parseBrewDraft({ ...base, dilutedWith: 'milk' }).values).toMatchObject({ dilutionRatio: null, dilutedWith: null });
  });
});

describe('grinder weights', () => {
  const base = { ...emptyDraft(), dose: '15', water: '250', time: '3:00' };
  it('are optional, each on its own; grounds out no more than beans in', () => {
    expect(parseBrewDraft({ ...base, beanIn: '18,2', groundOut: '17.9' }).values).toMatchObject({ beanWeightInGrams: 18.2, groundWeightOutGrams: 17.9 });
    expect(parseBrewDraft({ ...base, groundOut: '17.9' }).values).toMatchObject({ beanWeightInGrams: null, groundWeightOutGrams: 17.9 });
    expect(parseBrewDraft({ ...base, beanIn: '18', groundOut: '18.1' }).errors.groundOut).toMatch(/More than/);
    expect(parseBrewDraft({ ...base, beanIn: '0' }).errors.beanIn).toBeTruthy();
    expect(parseBrewDraft({ ...base, groundOut: 'lots' }).errors.groundOut).toBeTruthy();
  });
});

describe('parseBrewDraft for espresso', () => {
  const shot = { ...emptyDraft(), dose: '18', water: '250', time: '0:28' };
  it('needs the shot weight and sends no water', () => {
    expect(parseBrewDraft(shot, 'espresso').errors).toEqual({ yieldGrams: 'Enter the shot weight' });
    expect(parseBrewDraft({ ...shot, yieldGrams: '36.5' }, 'espresso').values).toMatchObject({ actualWaterGrams: null, actualYieldGrams: 36.5 });
  });
  it('first drop: optional seconds, within the shot, only for espresso', () => {
    const done = { ...shot, yieldGrams: '36' };
    expect(parseBrewDraft({ ...done, firstDrop: '7.4' }, 'espresso').firstDropSec).toBe(7.4);
    expect(parseBrewDraft({ ...done, firstDrop: '' }, 'espresso').firstDropSec).toBeNull();
    expect(parseBrewDraft({ ...done, firstDrop: '30' }, 'espresso').errors.firstDrop).toMatch(/end of the shot/);
    expect(parseBrewDraft({ ...done, firstDrop: 'soon' }, 'espresso').values).toBeNull();
    expect(parseBrewDraft({ ...done, firstDrop: '7.4', water: '250' }, 'filter').firstDropSec).toBeNull();
  });
  it('other kinds still need water', () => {
    expect(parseBrewDraft({ ...shot, water: '' }, 'filter').errors).toHaveProperty('water');
    expect(parseBrewDraft({ ...shot, water: '' }, null).errors).toHaveProperty('water');
  });
});

describe('parseBrewDraft for flash chilled (docs/api/brew-logs.md §6)', () => {
  const base = { ...emptyDraft(), dose: '15', water: '150', yieldGrams: '228', time: '2:30' };
  it('sends the ice, and no TDS with it', () => {
    expect(parseBrewDraft({ ...base, ice: '100', tds: '1.3' }).values).toMatchObject({ actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 228, tdsPercent: null });
    expect(parseBrewDraft({ ...base, ice: '', tds: '1.3' }).values).toMatchObject({ actualIceGrams: null, tdsPercent: 1.3 });
  });
  it('checks the ice like water, and ignores it for espresso', () => {
    expect(parseBrewDraft({ ...base, ice: '0' }).errors).toHaveProperty('ice');
    expect(parseBrewDraft({ ...base, ice: 'lots' }).values).toBeNull();
    expect(parseBrewDraft({ ...base, ice: '100' }, 'espresso').values).toMatchObject({ actualWaterGrams: null, actualIceGrams: null });
  });
});

describe('draftFromLog', () => {
  it('round-trips a stored brew log', () => {
    const log = { actualDoseGrams: 15, actualWaterGrams: 250.5, actualIceGrams: null, actualYieldGrams: null, tdsPercent: 1.38, actualTempC: 93.5, grinderId: 'g1', waterProfileId: 'w1', tools: [{ id: 't1', name: 'WDT' }], problems: [{ id: 'p1', name: 'Fast drawdown', methodKind: 'filter' }], flavors: ['fruity.citrus.lemon'], actualGrindSetting: 20.5, grindRpm: 1100, beanWeightInGrams: 18.2, groundWeightOutGrams: null, steepTemp: 'fridge', dilutionRatio: 1, dilutedWith: 'milk', actualTimeSec: 150, rating: null, tastingNotes: null, drinkRating: 3, drinkTastingNotes: 'milky' } as BrewLog;
    const draft = draftFromLog(log);
    expect(draft).toEqual({ dose: '15', water: '250.5', ice: '', yieldGrams: '', tds: '1.38', temp: '93.5', grinderId: 'g1', waterProfileId: 'w1', toolIds: ['t1'], problemIds: ['p1'], flavors: ['fruity.citrus.lemon'], firstDrop: '', grind: '20.5', rpm: '1100', beanIn: '18.2', groundOut: '', steepTemp: 'fridge', dilution: '1', dilutedWith: 'milk', time: '2:30', rating: null, notes: '', drinkRating: 3, drinkNotes: 'milky' });
    expect(parseBrewDraft(draft, null, false, 'c', { variableSpeed: true, rpmMin: null, rpmMax: null }).values).toMatchObject({ actualDoseGrams: 15, actualWaterGrams: 250.5, actualYieldGrams: null, tdsPercent: 1.38, actualTempC: 93.5, grinderId: 'g1', waterProfileId: 'w1', toolIds: ['t1'], problemIds: ['p1'], flavors: ['fruity.citrus.lemon'], grindRpm: 1100, beanWeightInGrams: 18.2, groundWeightOutGrams: null, actualTimeSec: 150 });
  });
});

import { describe, expect, it } from 'vitest';
import type { StatsBean, StatsBrew, StatsData } from '../api/types';
import { bannerFor, markSeen, recapFigures, recapsDue, type RecapBannerPrefs, type RecapDue } from './recap';

const brew = (fields: Partial<StatsBrew> = {}): StatsBrew => ({
  id: 'b', timestamp: '2026-11-03T15:00:00.000Z', utcOffsetMinutes: null, userId: 'u', beanId: 'kenya', recipeId: null, brewerId: null,
  methodId: null, styleId: null, brewsLike: null, grinderId: null, drinkId: null, toolIds: [], problemIds: [], doseGrams: 20,
  waterGrams: 300, iceGrams: null, yieldGrams: null, servingSize: null, servingUnit: null, drinkServingSize: null, drinkServingUnit: null,
  dilutionRatio: null, timeSec: 150, expectedFinishMinSec: null, expectedFinishMaxSec: null, grindSetting: null, tempC: null,
  tdsPercent: null, rating: null, drinkRating: null, ...fields,
});
const bean = (fields: Partial<StatsBean> = {}): StatsBean => ({
  id: 'kenya', roasterName: 'House', beanName: 'Kenya Nyeri', batchNumber: null, country: null, originArea: null, altitudeMasl: null, processId: null,
  roastLevel: 'medium_light', roastDate: null, varieties: null, species: null, decaf: false, priceAmount: null, priceCurrency: null, bagWeightGrams: null,
  inventoryWeightGrams: 100, purchaseDate: null, createdAt: '2026-10-01T09:00:00.000Z', archivedAt: null, freezes: [], photoCount: 0, ...fields,
});
const lookups = (): StatsData['lookups'] => ({
  brewers: [{ id: 'v60', name: 'V60', methodId: null }, { id: 'oxo', name: 'OXO', methodId: null }],
  methods: [],
  styles: [],
  recipes: [
    { id: 'ramped', name: 'Ramped Bloom', expectedFinishMinSec: 140, expectedFinishMaxSec: 170, createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'soup', name: 'Soup', expectedFinishMinSec: 45, expectedFinishMaxSec: 60, createdAt: '2026-11-06T21:00:00.000Z' },
  ],
  grinders: [],
  tools: [],
  problems: [],
  processes: [],
  drinks: [],
});
const week = { start: '2026-11-02', end: '2026-11-08' };

describe('recapFigures', () => {
  const data: StatsData = {
    brews: [
      brew({ id: 'last-week', timestamp: '2026-11-01T12:00:00.000Z', rating: 5 }), // outside the week
      brew({ id: 'b1', timestamp: '2026-11-02T08:00:00.000Z', recipeId: 'ramped', brewerId: 'v60', rating: 3.5, yieldGrams: 260 }),
      brew({ id: 'b2', timestamp: '2026-11-04T08:00:00.000Z', recipeId: 'ramped', brewerId: 'v60', rating: 4.5 }),
      brew({ id: 'b3', timestamp: '2026-11-04T18:00:00.000Z', recipeId: 'soup', brewerId: 'oxo', beanId: 'panama', doseGrams: 22, waterGrams: 100, yieldGrams: 79, rating: 4.5 }),
      brew({ id: 'b4', timestamp: '2026-11-07T08:00:00.000Z', recipeId: 'ramped', brewerId: 'v60' }), // unrated
    ],
    beans: [
      bean(),
      bean({ id: 'panama', roasterName: 'Proud Mary', beanName: 'Panama Elida', purchaseDate: '2026-11-03' }),
      bean({ id: 'old', beanName: 'Old Guji', archivedAt: '2026-11-05T10:00:00.000Z' }),
    ],
    lookups: lookups(),
  };
  const previous: StatsData = { brews: [brew({ id: 'p1', rating: 3 }), brew({ id: 'p2', rating: 4 })], beans: data.beans, lookups: lookups() };

  it('counts the week and compares it with the one before', () => {
    const r = recapFigures(data, previous, week, 'light', '2026-11-09');
    expect(r.brews).toBe(4);
    expect(r.previousBrews).toBe(2);
    expect(r.daysBrewed).toBe(3);
    expect(r.rating).toEqual({ mean: 12.5 / 3, n: 3 });
    expect(r.previousRating).toBe(3.5);
    expect(r.coffeeGrams).toBe(82);
  });

  it('keeps the tied best brews, newest first, with what they were', () => {
    const r = recapFigures(data, previous, week, 'light', '2026-11-09');
    expect(r.best).toEqual([
      { brewId: 'b3', rating: 4.5, day: '2026-11-04', bean: 'Proud Mary – Panama Elida', recipe: 'Soup', brewer: 'OXO' },
      { brewId: 'b2', rating: 4.5, day: '2026-11-04', bean: 'House – Kenya Nyeri', recipe: 'Ramped Bloom', brewer: 'V60' },
    ]);
  });

  it('adds up volume (marking estimates) and caffeine', () => {
    const r = recapFigures(data, previous, week, 'light', '2026-11-09');
    // 260 + 79 measured; two estimated at 300 − 2.05 × 20 = 259.
    expect(r.volume).toEqual({ ml: 260 + 79 + 259 + 259, estimated: true });
    expect(r.caffeineMg).toBeCloseTo(82 * 1000 * 0.012 * 0.9);
  });

  it('lists beans brewed, added and finished, new recipes and the most used', () => {
    const r = recapFigures(data, previous, week, 'light', '2026-11-09');
    expect(r.beansBrewed).toEqual([
      { id: 'kenya', label: 'House – Kenya Nyeri', brews: 3 },
      { id: 'panama', label: 'Proud Mary – Panama Elida', brews: 1 },
    ]);
    expect(r.beansAdded).toEqual([{ id: 'panama', label: 'Proud Mary – Panama Elida' }]);
    expect(r.beansFinished).toEqual([{ id: 'old', label: 'House – Old Guji' }]);
    expect(r.newRecipes).toEqual([{ id: 'soup', name: 'Soup' }]);
    expect(r.topRecipe).toEqual({ name: 'Ramped Bloom', brews: 3 });
    expect(r.topBrewer).toEqual({ name: 'V60', brews: 3 });
  });

  it('is empty, not broken, for a quiet week', () => {
    const r = recapFigures({ brews: [], beans: [], lookups: lookups() }, null, week, 'light', '2026-11-09');
    expect(r).toMatchObject({ brews: 0, previousBrews: 0, daysBrewed: 0, rating: null, previousRating: null, best: [], caffeineMg: null, volume: null, topRecipe: null });
  });
});

describe('recap banner', () => {
  const prefs: RecapBannerPrefs = { recaps: true, recapPeriods: 'both', weekStartsOn: 1, recapBanner: true, recapBannerDays: 3, recapSeen: {} };
  const lastWeek: RecapDue = { kind: 'weekly', period: { start: '2026-11-02', end: '2026-11-08' } };
  const october: RecapDue = { kind: 'monthly', period: { start: '2026-10-01', end: '2026-10-31' } };

  it('offers the week and month just ended, for the days chosen', () => {
    expect(recapsDue(prefs, '2026-11-09')).toEqual([lastWeek]); // October ended 9 days ago
    expect(recapsDue(prefs, '2026-11-02')).toEqual([{ kind: 'weekly', period: { start: '2026-10-26', end: '2026-11-01' } }, october]);
    expect(recapsDue(prefs, '2026-11-11')).toEqual([lastWeek]); // day 3
    expect(recapsDue(prefs, '2026-11-12')).toEqual([]); // day 4
    expect(recapsDue({ ...prefs, recapBannerDays: 10 }, '2026-11-09')).toEqual([lastWeek, october]);
    expect(recapsDue({ ...prefs, recapPeriods: 'monthly', recapBannerDays: 10 }, '2026-11-09')).toEqual([october]);
  });

  it('follows the week start', () => {
    // Sunday weeks: the week of 1–7 Nov ended on Saturday.
    expect(recapsDue({ ...prefs, weekStartsOn: 0 }, '2026-11-09')).toEqual([{ kind: 'weekly', period: { start: '2026-11-01', end: '2026-11-07' } }]);
  });

  it('is off with recaps or the banner off, and once seen', () => {
    expect(recapsDue({ ...prefs, recaps: false }, '2026-11-09')).toEqual([]);
    expect(recapsDue({ ...prefs, recapBanner: false }, '2026-11-09')).toEqual([]);
    expect(recapsDue({ ...prefs, recapSeen: { weekly: '2026-11-02' } }, '2026-11-09')).toEqual([]);
    expect(recapsDue({ ...prefs, recapSeen: { weekly: '2026-10-26' } }, '2026-11-09')).toEqual([lastWeek]);
  });

  it('says which are ready, skipping periods without brews', () => {
    expect(bannerFor(prefs, '2026-11-02', () => true)?.text).toBe('Your weekly and monthly recaps are ready.');
    expect(bannerFor(prefs, '2026-11-02', (d) => d.kind === 'monthly')).toEqual({ due: [october], text: 'Your monthly recap is ready.' });
    expect(bannerFor(prefs, '2026-11-09', () => true)?.text).toBe('Your weekly recap is ready.');
    expect(bannerFor(prefs, '2026-11-09', () => false)).toBeNull();
  });

  it('marks periods seen without going back', () => {
    expect(markSeen({ monthly: '2026-10-01' }, [lastWeek])).toEqual({ weekly: '2026-11-02', monthly: '2026-10-01' });
    expect(markSeen({ weekly: '2026-11-09' }, [lastWeek])).toEqual({ weekly: '2026-11-09' });
  });
});

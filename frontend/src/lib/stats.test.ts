import { describe, expect, it } from 'vitest';
import type { StatsBean, StatsBrew } from '../api/types';
import {
  boughtOn,
  brewEY,
  brewRoastAge,
  brewVolumeMl,
  bucketOf,
  bucketRange,
  countBy,
  cumulative,
  finishFit,
  ratingWithWithout,
  seriesByKey,
  formatDuration,
  formatWeight,
  freezeState,
  isAvailable,
  localDay,
  localHour,
  localWeekday,
  longestStreak,
  meanBy,
  meanByBucket,
  pickGranularity,
  spendByCurrency,
  splitCountries,
  sumByBucket,
  topWithOther,
} from './stats';

const brew = (fields: Partial<StatsBrew> = {}): StatsBrew => ({
  id: 'b', timestamp: '2026-10-20T15:00:00.000Z', utcOffsetMinutes: null, userId: 'u', beanId: 'bean', recipeId: null, brewerId: null,
  methodId: null, styleId: null, brewsLike: null, grinderId: null, drinkId: null, toolIds: [], problemIds: [], doseGrams: 15,
  waterGrams: 250, iceGrams: null, yieldGrams: null, servingSize: null, servingUnit: null, drinkServingSize: null, drinkServingUnit: null,
  dilutionRatio: null, timeSec: 150, expectedFinishMinSec: null, expectedFinishMaxSec: null, grindSetting: null, tempC: null,
  tdsPercent: null, rating: null, drinkRating: null, ...fields,
});

const bean = (fields: Partial<StatsBean> = {}): StatsBean => ({
  id: 'bean', roasterName: 'Onyx', beanName: 'Monarch', batchNumber: null, country: null, originArea: null, altitudeMasl: null, processId: null,
  roastLevel: null, roastDate: null, varieties: null, species: null, decaf: false, priceAmount: null, priceCurrency: null, bagWeightGrams: null,
  inventoryWeightGrams: 0, purchaseDate: null, createdAt: '2026-10-01T09:00:00.000Z', archivedAt: null, freezes: [], photoCount: 0, ...fields,
});

describe('local date and time', () => {
  it('shifts by the device offset, UTC when unknown', () => {
    const late = brew({ timestamp: '2026-10-21T03:30:00.000Z', utcOffsetMinutes: -420 });
    expect(localDay(late)).toBe('2026-10-20');
    expect(localHour(late)).toBe(20);
    expect(localWeekday(late)).toBe(1); // Tuesday
    expect(localDay(brew({ timestamp: '2026-10-21T03:30:00.000Z' }))).toBe('2026-10-21');
    expect(localDay(brew({ timestamp: '2026-10-20T20:00:00.000Z', utcOffsetMinutes: 600 }))).toBe('2026-10-21');
  });
});

describe('brewVolumeMl', () => {
  it("uses the brew's size, then the drink's default", () => {
    expect(brewVolumeMl(brew({ drinkId: 'd', servingSize: 300, servingUnit: 'ml', drinkServingSize: 8, drinkServingUnit: 'fl_oz' }), null, 'light')).toEqual({ ml: 300, source: 'serving' });
    const v = brewVolumeMl(brew({ drinkId: 'd', drinkServingSize: 8, drinkServingUnit: 'fl_oz', yieldGrams: 40 }), null, 'light');
    expect(v?.source).toBe('serving');
    expect(v?.ml).toBeCloseTo(236.6, 1);
  });
  it('uses the measured yield, then the estimate from the roast level', () => {
    expect(brewVolumeMl(brew({ yieldGrams: 220 }), 'dark', 'light')).toEqual({ ml: 220, source: 'measured' });
    expect(brewVolumeMl(brew(), 'dark', 'light')).toEqual({ ml: 216, source: 'estimate' }); // 250 − 2.3 × 15, rounded
    expect(brewVolumeMl(brew(), null, 'light')).toEqual({ ml: 220, source: 'estimate' }); // 250 − 2.0 × 15
    expect(brewVolumeMl(brew({ waterGrams: 150, iceGrams: 100 }), null, 'light')).toEqual({ ml: 220, source: 'estimate' });
  });
  it('counts a dilution, and is null with nothing to go on', () => {
    expect(brewVolumeMl(brew({ yieldGrams: 200, dilutionRatio: 1.5 }), null, 'light')).toEqual({ ml: 500, source: 'measured' });
    expect(brewVolumeMl(brew({ waterGrams: null }), null, 'light')).toBeNull();
  });
});

describe('brew and bean figures', () => {
  it('works out EY with the style', () => {
    expect(brewEY(brew({ tdsPercent: 1.4, yieldGrams: 220 }))).toBe(20.5);
    expect(brewEY(brew({ tdsPercent: 1.4, yieldGrams: 220, brewsLike: 'immersion' }))).toBe(23.3);
    expect(brewEY(brew())).toBeNull();
  });
  it('gives the roast age on the brew day, frozen days left out', () => {
    const b = bean({ roastDate: '2026-10-01T00:00:00.000Z', freezes: [{ frozenOn: '2026-10-05', thawedOn: '2026-10-15' }] });
    expect(brewRoastAge(brew(), b)).toBe(9);
    expect(brewRoastAge(brew(), bean())).toBeNull();
    expect(brewRoastAge(brew(), undefined)).toBeNull();
  });
  it('tells frozen, thawed and fresh apart; available = in stock and active', () => {
    expect(freezeState(bean({ freezes: [{ frozenOn: '2026-10-05', thawedOn: '2026-10-10' }, { frozenOn: '2026-10-12', thawedOn: null }] }))).toBe('frozen');
    expect(freezeState(bean({ freezes: [{ frozenOn: '2026-10-05', thawedOn: '2026-10-10' }] }))).toBe('thawed');
    expect(freezeState(bean())).toBe('fresh');
    expect(isAvailable(bean({ inventoryWeightGrams: 10 }))).toBe(true);
    expect(isAvailable(bean())).toBe(false);
    expect(isAvailable(bean({ inventoryWeightGrams: 10, archivedAt: '2026-10-10T00:00:00.000Z' }))).toBe(false);
  });
  it('splits blends into countries', () => {
    expect(splitCountries('Colombia, Ethiopia')).toEqual(['Colombia', 'Ethiopia']);
    expect(splitCountries('Kenya & Rwanda / Kenya')).toEqual(['Kenya', 'Rwanda']);
    expect(splitCountries('Trinidad and Tobago')).toEqual(['Trinidad and Tobago']);
    expect(splitCountries(null)).toEqual([]);
  });
  it('adds up spend per currency by the day bought', () => {
    const beans = [
      bean({ priceAmount: 20.1, priceCurrency: 'USD', purchaseDate: '2026-10-03' }),
      bean({ priceAmount: 10.2, priceCurrency: 'USD', createdAt: '2026-10-10T09:00:00.000Z' }),
      bean({ priceAmount: 15, priceCurrency: 'EUR', purchaseDate: '2026-09-01' }),
      bean(),
    ];
    expect(boughtOn(beans[1]!)).toBe('2026-10-10');
    expect(spendByCurrency(beans)).toEqual([
      { currency: 'USD', amount: 30.3, bags: 2 },
      { currency: 'EUR', amount: 15, bags: 1 },
    ]);
    expect(spendByCurrency(beans, '2026-10-05', '2026-10-31')).toEqual([{ currency: 'USD', amount: 10.2, bags: 1 }]);
  });
  it('finds the longest run of brewing days', () => {
    expect(longestStreak(['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06'])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });
});

describe('time buckets', () => {
  it('picks a granularity from the range', () => {
    expect(pickGranularity('2026-08-01', '2026-10-31')).toBe('day');
    expect(pickGranularity('2025-10-01', '2026-10-31')).toBe('week');
    expect(pickGranularity('2023-01-01', '2026-10-31')).toBe('month');
  });
  it('puts a day in its week (Monday) or month', () => {
    expect(bucketOf('2026-10-21', 'week')).toBe('2026-10-19');
    expect(bucketOf('2026-10-19', 'week')).toBe('2026-10-19');
    expect(bucketOf('2026-10-25', 'week')).toBe('2026-10-19');
    expect(bucketOf('2026-10-21', 'month')).toBe('2026-10-01');
  });
  it('lists every bucket so quiet ones show as zero', () => {
    expect(bucketRange('2026-10-30', '2026-11-02', 'day')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(bucketRange('2026-10-21', '2026-11-03', 'week')).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(bucketRange('2026-11-15', '2027-01-02', 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
  it('sums, averages and accumulates per bucket', () => {
    const brews = [brew({ rating: 4 }), brew({ rating: 2 }), brew({ timestamp: '2026-10-22T15:00:00.000Z' })];
    const buckets = bucketRange('2026-10-20', '2026-10-22', 'day');
    const counts = sumByBucket(brews, buckets, 'day');
    expect(counts).toEqual([2, 0, 1]);
    expect(sumByBucket(brews, buckets, 'day', (b) => b.doseGrams)).toEqual([30, 0, 15]);
    expect(meanByBucket(brews, buckets, 'day', (b) => b.rating)).toEqual([3, null, null]);
    expect(cumulative(counts)).toEqual([2, 2, 3]);
  });
});

describe('groups', () => {
  it('counts under each key, an item with several under each', () => {
    const items = [{ k: ['a', 'b'] }, { k: ['a'] }, { k: [] }];
    expect(countBy(items, (i) => i.k)).toEqual([{ key: 'a', n: 2 }, { key: 'b', n: 1 }]);
    expect(countBy([{ k: 'x' }, { k: null }], (i) => i.k)).toEqual([{ key: 'x', n: 1 }]);
  });
  it('averages under each key with n, skipping missing values', () => {
    const items = [{ k: 'a', v: 4 }, { k: 'a', v: 5 }, { k: 'b', v: 3 }, { k: 'b', v: null }];
    expect(meanBy(items, (i) => i.k, (i) => i.v)).toEqual([{ key: 'a', mean: 4.5, n: 2 }, { key: 'b', mean: 3, n: 1 }]);
  });
  it('folds the long tail into Other', () => {
    const counts = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, n: 10 - i }));
    expect(topWithOther(counts, 7)).toHaveLength(8);
    expect(topWithOther(counts, 7).at(-1)).toEqual({ key: 'Other', n: 3 + 2 + 1 });
    expect(topWithOther(counts.slice(0, 8), 7)).toHaveLength(8); // one extra slice isn't worth folding
  });
});

describe('formatting', () => {
  it('writes long durations and weights', () => {
    expect(formatDuration(7500)).toBe('2 h 05 min');
    expect(formatDuration(720)).toBe('12 min');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatWeight(850.4)).toBe('850 g');
    expect(formatWeight(1240)).toBe('1.24 kg');
  });
});

describe('per-item breakdowns', () => {
  const buckets = ['2026-10-20', '2026-10-21'];
  const on21 = '2026-10-21T15:00:00.000Z';
  const brews = [
    brew({ grinderId: 'a', toolIds: ['wdt'], rating: 5 }),
    brew({ grinderId: 'a', toolIds: ['wdt', 'rdt'], rating: 3, timestamp: on21 }),
    brew({ grinderId: 'b', rating: 2, timestamp: on21 }),
    brew({ grinderId: 'c', toolIds: ['rdt'] }),
    brew({ grinderId: null }),
  ];
  it('splits the busiest keys into series and folds the rest into Other', () => {
    expect(seriesByKey(brews, buckets, 'day', (b) => b.grinderId, { keep: 1 })).toEqual([
      { key: 'a', data: [1, 1] },
      { key: 'Other', data: [1, 1] },
    ]);
    expect(seriesByKey(brews, buckets, 'day', (b) => b.grinderId, { value: (b) => b.doseGrams, keep: 2 })).toEqual([
      { key: 'a', data: [15, 15] },
      { key: 'b', data: [0, 15] },
      { key: 'Other', data: [15, 0] },
    ]);
  });
  it('counts a brew under each of its tools, with no Other', () => {
    expect(seriesByKey(brews, buckets, 'day', (b) => b.toolIds, { other: false })).toEqual([
      { key: 'rdt', data: [1, 1] },
      { key: 'wdt', data: [1, 1] },
    ]);
  });
  it('compares the rating with and without a tool', () => {
    expect(ratingWithWithout(brews, ['wdt', 'rdt'])).toEqual([
      { key: 'wdt', with: { mean: 4, n: 2 }, without: { mean: 2, n: 1 } },
      { key: 'rdt', with: { mean: 3, n: 1 }, without: { mean: 3.5, n: 2 } },
    ]);
  });
  it('places the time against the finish window', () => {
    const w = { expectedFinishMinSec: 150, expectedFinishMaxSec: 180 };
    expect(finishFit({ timeSec: 140, ...w })).toBe('early');
    expect(finishFit({ timeSec: 180, ...w })).toBe('inside');
    expect(finishFit({ timeSec: 200, ...w })).toBe('late');
    const none = { expectedFinishMinSec: null, expectedFinishMaxSec: null };
    expect(finishFit({ timeSec: 160, ...none })).toBeNull();
    expect(finishFit({ timeSec: 160, ...none }, w)).toBe('inside'); // the recipe's
    expect(finishFit({ timeSec: 160, ...w }, { expectedFinishMinSec: 100, expectedFinishMaxSec: 120 })).toBe('inside'); // its own wins
  });
});

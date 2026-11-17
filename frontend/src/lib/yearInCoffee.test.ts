import { describe, expect, it } from 'vitest';
import type { StatsBean, StatsBrew, StatsData } from '../api/types';
import { latestYear, longestStreak, yearFigures } from './yearInCoffee';

const brew = (fields: Partial<StatsBrew> = {}): StatsBrew => ({
  id: 'b', timestamp: '2026-03-03T08:00:00.000Z', utcOffsetMinutes: 0, userId: 'u', beanId: 'kenya', recipeId: null, brewerId: null,
  methodId: null, styleId: null, brewsLike: null, grinderId: null, drinkId: null, toolIds: [], problemIds: [], doseGrams: 20,
  waterGrams: 300, iceGrams: null, yieldGrams: null, servingSize: null, servingUnit: null, drinkServingSize: null, drinkServingUnit: null,
  dilutionRatio: null, timeSec: 150, expectedFinishMinSec: null, expectedFinishMaxSec: null, grindSetting: null, tempC: null,
  tdsPercent: null, rating: null, drinkRating: null, forMe: true, guestIds: [], unnamedGuests: 0, servings: [], flavors: [], ...fields,
});
const bean = (fields: Partial<StatsBean> = {}): StatsBean => ({
  id: 'kenya', roasterName: 'House', beanName: 'Kenya Nyeri', batchNumber: null, country: 'Kenya', originArea: null, altitudeMasl: null, processId: 'washed',
  roastLevel: 'medium_light', roastDate: null, varieties: ['SL28'], species: null, decaf: false, priceAmount: null, priceCurrency: null, bagWeightGrams: null,
  inventoryWeightGrams: 100, purchaseDate: null, createdAt: '2026-01-01T09:00:00.000Z', archivedAt: null, freezes: [], photoCount: 0, ...fields,
});
const data = (brews: StatsBrew[]): StatsData => ({
  brews,
  beans: [bean(), bean({ id: 'blend', roasterName: 'Atlas', beanName: 'Blend', country: 'Ethiopia, Colombia', processId: 'natural', varieties: ['Heirloom', 'SL28'] })],
  lookups: {
    brewers: [],
    methods: [],
    styles: [],
    recipes: [{ id: 'v60', name: 'V60 Daily', expectedFinishMinSec: null, expectedFinishMaxSec: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    grinders: [],
    tools: [],
    problems: [],
    processes: [{ id: 'washed', name: 'Washed' }, { id: 'natural', name: 'Natural' }],
    drinks: [],
    guests: [],
  },
});
const at = (day: string, hour = 8) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

describe('Your Year in Coffee figures (backlog 65)', () => {
  const brews = [
    brew({ id: 'a', timestamp: at('2026-03-02'), recipeId: 'v60', rating: 3, flavors: ['Lemon', 'Sweet'] }),
    brew({ id: 'b', timestamp: at('2026-03-03'), recipeId: 'v60', rating: 3, flavors: ['Lemon'] }),
    brew({ id: 'c', timestamp: at('2026-03-04', 9), recipeId: 'v60', rating: 4.5, beanId: 'blend', userId: 'v' }),
    brew({ id: 'd', timestamp: at('2026-07-10'), recipeId: 'v60', rating: 4.5, beanId: 'blend', flavors: ['Sweet', 'Jasmine'] }),
    brew({ id: 'e', timestamp: at('2026-07-11', 17), beanId: 'blend', flavors: ['Sweet'] }),
    brew({ id: 'last-year', timestamp: at('2025-12-31'), rating: 5 }),
  ];
  const f = yearFigures(data(brews), data([brew({ id: 'x', timestamp: at('2025-05-01') })]), 2026, 'medium', '2026-12-31');

  it('counts the year as a recap does, next to the year before', () => {
    expect(f.recap.brews).toBe(5);
    expect(f.recap.previousBrews).toBe(1);
    expect(f.recap.coffeeGrams).toBe(100);
    expect(f.months).toEqual([0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0]);
  });

  it('finds the longest streak and the busiest times', () => {
    expect(f.streak).toEqual({ days: 3, start: '2026-03-02', end: '2026-03-04' });
    expect(f.busiestMonth).toEqual({ month: 2, brews: 3 });
    expect(f.favouriteHour).toEqual({ hour: 8, brews: 3 });
    expect(f.busiestWeekday).toEqual({ weekday: 0, brews: 1 }); // a tie: Monday first
  });

  it('ranks origins, roasters, processes, varieties and flavors', () => {
    expect(f.origins).toEqual([
      { name: 'Colombia', brews: 3 },
      { name: 'Ethiopia', brews: 3 },
      { name: 'Kenya', brews: 2 },
    ]);
    expect(f.roasters.map((r) => r.name)).toEqual(['Atlas', 'House']);
    expect(f.processes[0]).toEqual({ name: 'Natural', brews: 3 });
    expect(f.varieties[0]).toEqual({ name: 'SL28', brews: 5 });
    expect(f.flavors).toEqual([
      { name: 'Sweet', brews: 3 },
      { name: 'Lemon', brews: 2 },
      { name: 'Jasmine', brews: 1 },
    ]);
  });

  it('finds the most improved recipe, early brews against late', () => {
    expect(f.mostImproved).toEqual({ kind: 'recipe', name: 'V60 Daily', from: 3, to: 4.5, brews: 4 });
  });

  it("names who brewed on the bar's year, and whose was the best cup", () => {
    expect(f.people).toEqual([
      { userId: 'u', brews: 4 },
      { userId: 'v', brews: 1 },
    ]);
    expect(f.bestCupBy).toBe('u'); // the newest of the 4.5s
  });

  it('skips a figure without enough behind it', () => {
    const small = yearFigures(data([brew({ id: 'a', rating: 4 }), brew({ id: 'b', timestamp: at('2026-03-05'), rating: 5 })]), null, 2026, 'medium', '2026-12-31');
    expect(small.streak).toBeNull();
    expect(small.busiestMonth).toBeNull();
    expect(small.favouriteHour).toBeNull();
    expect(small.origins).toEqual([]); // one origin isn't a ranking
    expect(small.mostImproved).toBeNull();
    expect(small.people).toEqual([]); // only one person brewed
    expect(small.bestCupBy).toBeNull();
  });
});

describe('longestStreak', () => {
  it('keeps the first of equal runs, and counts a day once', () => {
    expect(longestStreak(['2026-01-05', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-06'])).toEqual({ days: 2, start: '2026-01-01', end: '2026-01-02' });
    expect(longestStreak(['2026-12-31'])).toBeNull();
    expect(longestStreak([])).toBeNull();
  });
});

describe('latestYear', () => {
  it('offers this year from 1 December, else the one just ended', () => {
    expect(latestYear('2026-11-30')).toBe(2025);
    expect(latestYear('2026-12-01')).toBe(2026);
    expect(latestYear('2027-01-01')).toBe(2026);
  });
});

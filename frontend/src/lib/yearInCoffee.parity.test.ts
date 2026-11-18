import { describe, expect, it } from 'vitest';
import type { StatsBean, StatsBrew, StatsData } from '../api/types';
import { recapFigures } from './recap';
import { shared } from './yearShared.testing';
// Your Year in Coffee is counted and frozen on the server
// (@barista/shared/yearInCoffee); the Yearly tab counts live here. They must
// agree (docs/api/recaps.md §11c "Parity", CLAUDE.md rule 15): a figure added
// to one goes in the other in the same change.

const brew = (fields: Partial<StatsBrew> = {}): StatsBrew => ({
  id: 'b', timestamp: '2026-03-03T08:00:00.000Z', utcOffsetMinutes: 0, userId: 'u', beanId: 'kenya', recipeId: null, brewerId: null,
  methodId: null, styleId: null, brewsLike: null, grinderId: null, drinkId: null, toolIds: [], problemIds: [], doseGrams: 20,
  waterGrams: 300, iceGrams: null, yieldGrams: null, servingSize: null, servingUnit: null, drinkServingSize: null, drinkServingUnit: null,
  dilutionRatio: null, timeSec: 150, expectedFinishMinSec: null, expectedFinishMaxSec: null, grindSetting: null, tempC: null,
  tdsPercent: null, rating: null, drinkRating: null, forMe: true, guestIds: [], unnamedGuests: 0, servings: [], flavors: [], ...fields,
});
const bean = (fields: Partial<StatsBean> = {}): StatsBean => ({
  id: 'kenya', roasterName: 'House', beanName: 'Kenya Nyeri', batchNumber: '3', country: 'Kenya', originArea: null, altitudeMasl: null, processId: 'washed',
  roastLevel: 'medium_light', roastDate: null, varieties: ['SL28'], species: null, decaf: false, priceAmount: null, priceCurrency: null, bagWeightGrams: null,
  inventoryWeightGrams: 100, purchaseDate: null, createdAt: '2025-01-01T09:00:00.000Z', archivedAt: null, freezes: [], photoCount: 0, ...fields,
});
const at = (day: string, hour = 8) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

// Something of everything a recap or a year counts.
const brews: StatsBrew[] = [];
const recipes = ['v60', 'aero', null];
const beanIds = ['kenya', 'blend', 'decaf', 'gone'];
for (let i = 0; i < 160; i++) {
  const year = 2024 + (i % 3);
  const day = `${year}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`;
  brews.push(
    brew({
      id: `b${i}`,
      timestamp: at(day, (i * 5) % 24),
      utcOffsetMinutes: i % 4 === 0 ? 120 : i % 5 === 0 ? null : -300,
      userId: i % 5 === 0 ? 'v' : 'u',
      beanId: beanIds[i % 4]!,
      recipeId: recipes[i % 3]!,
      brewerId: i % 2 ? 'switch' : i % 5 ? 'v60b' : null,
      drinkId: i % 7 === 0 ? 'latte' : null,
      drinkServingSize: i % 7 === 0 ? 8 : null,
      drinkServingUnit: i % 7 === 0 ? 'fl_oz' : null,
      servingSize: i % 11 === 0 ? 250 : null,
      servingUnit: i % 11 === 0 ? 'ml' : null,
      waterGrams: i % 6 === 0 ? null : 300,
      iceGrams: i % 8 === 0 ? 100 : null,
      yieldGrams: i % 9 === 0 ? 36 : null,
      dilutionRatio: i % 10 === 0 ? 1 : null,
      doseGrams: 15 + (i % 6),
      rating: i % 4 === 3 ? null : 2 + ((i * 7) % 7) / 2,
      flavors: i % 2 ? ['Lemon', ' Sweet '] : ['Jasmine'],
      forMe: i % 13 !== 0,
      guestIds: i % 6 === 0 ? ['g1'] : i % 13 === 0 ? ['g2', 'gone'] : [],
      unnamedGuests: i % 17 === 0 ? 2 : 0,
      servings: i % 19 === 0 ? [{ guestId: 'g1', forGuest: true, concentrateGrams: 60 }, { guestId: null, forGuest: false, concentrateGrams: 40 }] : [],
    }),
  );
}
const data: StatsData = {
  brews,
  beans: [
    bean(),
    bean({ id: 'blend', roasterName: ' Atlas', beanName: 'Blend', batchNumber: null, country: 'Ethiopia, Colombia', processId: 'natural', varieties: ['Heirloom', 'SL28'], species: ['arabica', 'robusta'], roastLevel: null, purchaseDate: '2026-02-10' }),
    bean({ id: 'decaf', beanName: 'Decaf', decaf: true, country: 'Kenya & Rwanda', processId: null, varieties: null, archivedAt: '2026-06-01T10:00:00.000Z', createdAt: '2026-05-01T10:00:00.000Z' }),
  ],
  lookups: {
    brewers: [
      { id: 'switch', name: 'Switch', methodId: null, groundsRetention: null, measured: [{ doseGrams: 20, waterGrams: 300, iceGrams: null, yieldGrams: 255 }, { doseGrams: 20, waterGrams: 300, iceGrams: 20, yieldGrams: 280 }, { doseGrams: 20, waterGrams: 300, iceGrams: null, yieldGrams: 100 }] },
      { id: 'v60b', name: 'V60', methodId: null, groundsRetention: 1.8, measured: [] },
    ],
    methods: [],
    styles: [],
    recipes: [
      { id: 'v60', name: 'V60 Daily', expectedFinishMinSec: null, expectedFinishMaxSec: null, createdAt: '2026-04-01T00:00:00.000Z' },
      { id: 'aero', name: 'Aero', expectedFinishMinSec: null, expectedFinishMaxSec: null, createdAt: '2024-01-01T00:00:00.000Z' },
    ],
    grinders: [],
    tools: [],
    problems: [],
    processes: [{ id: 'washed', name: 'Washed' }, { id: 'natural', name: 'Natural' }],
    drinks: [],
    guests: [{ id: 'g1', name: 'Sam' }, { id: 'g2', name: 'Ana' }],
  },
};
const within = (d: StatsData, start: string, end: string): StatsData => ({ ...d, brews: d.brews.filter((b) => b.timestamp.slice(0, 10) >= start && b.timestamp.slice(0, 10) <= end) });
// The server copy is fed the same rows; floating sums may differ in the last bits.
const same = (a: unknown, b: unknown) => expect(JSON.parse(JSON.stringify(a), (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))).toEqual(JSON.parse(JSON.stringify(b), (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));

describe('Your Year in Coffee, counted on the server, matches the Yearly tab', () => {
  it.each([
    ['a whole year', { start: '2026-01-01', end: '2026-12-31' }],
    ['the 1 January–6 December window', { start: '2025-01-01', end: '2025-12-06' }],
    ['a month', { start: '2026-03-01', end: '2026-03-31' }],
  ])('recap figures: %s', (_name, period) => {
    const prev = within(data, `${Number(period.start.slice(0, 4)) - 1}-01-01`, `${Number(period.start.slice(0, 4)) - 1}-12-31`);
    same(shared.recapFigures(data, prev, period, 'light', '2026-12-20'), recapFigures(data, prev, period, 'light', '2026-12-20'));
  });

  it('a year counts its recap as the Yearly tab does', () => {
    const prev = within(data, '2025-01-01', '2025-12-31');
    const year = shared.yearFigures(data, prev, { start: '2026-01-01', end: '2026-12-31' }, 'medium', '2026-12-31');
    same(year.recap, recapFigures(data, prev, { start: '2026-01-01', end: '2026-12-31' }, 'medium', '2026-12-31'));
    expect(year.recap.forOthers).not.toBeNull(); // the fixture reaches the guest figures
    expect(year.people.length).toBe(2); // and the bar's people
  });

  it('every figure the Yearly tab has, the frozen copy has', () => {
    const period = { start: '2026-01-01', end: '2026-12-31' };
    expect(Object.keys(shared.recapFigures(data, null, period, 'light', '2026-12-31')).sort()).toEqual(Object.keys(recapFigures(data, null, period, 'light', '2026-12-31')).sort());
  });
});

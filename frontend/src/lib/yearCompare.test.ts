import { describe, expect, it } from 'vitest';
import type { StatsBean, StatsBrew, StatsData } from '../api/types';
import { compareChips, deltaChip, newToYou } from './yearCompare';
import { shared } from './yearShared.testing';
import type { YearFigures } from './yearInCoffee';

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

describe('Your Year in Coffee compared with earlier years (backlog 65)', () => {
  it('words a change: percent, about the same, a multiple, days, stars', () => {
    expect(deltaChip('percent', 105, 100, '2025')).toEqual({ dir: 'up', text: '+5% on 2025' });
    expect(deltaChip('percent', 80, 100, '2025')).toEqual({ dir: 'down', text: '−20% on 2025' });
    expect(deltaChip('percent', 101.5, 100, '2025')).toEqual({ dir: 'same', text: 'About the same as 2025' });
    expect(deltaChip('percent', 240, 100, '2025')).toEqual({ dir: 'up', text: '2.4× 2025' });
    expect(deltaChip('percent', 200, 100, '2025').text).toBe('2× 2025');
    expect(deltaChip('days', 13, 9, '2025')).toEqual({ dir: 'up', text: '+4 days on 2025' });
    expect(deltaChip('days', 8, 9, '2025').text).toBe('−1 day on 2025');
    expect(deltaChip('stars', 4.3, 4.0, '2025')).toEqual({ dir: 'up', text: '+0.3 ★ on 2025' });
    expect(deltaChip('stars', 4.04, 4.0, '2025')).toEqual({ dir: 'same', text: 'About the same as 2025' });
  });

  it('needs 5 brews in an earlier year, and 2 years for an average or record', () => {
    const e = (year: number, value: number, brews = 50) => ({ year, value, brews });
    expect(compareChips(2026, 10, [e(2025, 8, 4)], 'percent')).toEqual([]); // too few brews
    expect(compareChips(2026, 10, [e(2025, 0)], 'percent')).toEqual([]); // nothing then
    expect(compareChips(2026, null, [e(2025, 8)], 'percent')).toEqual([]); // nothing now
    expect(compareChips(2026, 10, [e(2024, 8)], 'percent')).toEqual([]); // no last year, one year: nothing
    expect(compareChips(2026, 10, [e(2025, 8), e(2024, 9)], 'percent', { record: 'Best' }).map((c) => c.text)).toEqual(['+25% on 2025', 'Best']);
    expect(compareChips(2026, 10, [e(2025, 8), e(2024, 12)], 'percent', { record: 'Best' }).map((c) => c.text)).toEqual(['+25% on 2025', 'About the same as an average year']);
    expect(compareChips(2026, 10, [e(2025, 8), e(2024, 12)], 'percent', { average: false })).toHaveLength(1);
    expect(compareChips(2026, 10, [e(2025, 8)], 'percent', { soFar: true })[0]!.text).toBe('+25% on 2025 by this date');
  });

  it('finds names never brewed before, ignoring case', () => {
    const h = [{ originNames: ['kenya'] }, { originNames: ['Peru'] }] as unknown as YearFigures[];
    expect(newToYou(['Kenya', 'Peru', 'Laos'], h, (y) => y.originNames)).toEqual(['Laos']);
  });

  it('marks a first year joined after January as partial, scaled to a full year', () => {
    const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => brew({ id: `${from}-${i}`, timestamp: at(new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10)) }));
    const all = data([...days('2024-10-01', 10), ...days('2025-03-01', 10), ...days('2026-02-01', 10)]);
    // Counted on the server (@barista/shared/yearInCoffee): each year 1 January–6 December.
    const h = shared.yearHistory(all, 2026, 'medium', '2026-12-08');
    expect(h.map((y) => y.year)).toEqual([2025, 2024]);
    expect(h[0]!.covered).toBeUndefined(); // a later year is whole, gaps and all
    expect(h[1]!.covered).toMatchObject({ from: '2024-10-01', days: 67, tooShort: false }); // to 6 December
    expect(h[1]!.covered!.scale).toBeCloseTo(341 / 67);
    // From 15 January: whole.
    expect(shared.yearHistory(data(days('2025-01-15', 10)), 2026, 'medium', '2026-12-08')[0]!.covered).toBeUndefined();
    // Under 30 days: too short.
    expect(shared.yearHistory(data(days('2025-11-20', 10)), 2026, 'medium', '2026-12-08')[0]!.covered!.tooShort).toBe(true);
    // After 6 December: not in that year at all.
    expect(shared.yearHistory(data(days('2025-12-10', 10)), 2026, 'medium', '2026-12-08')).toEqual([]);
  });

  it("compares with a partial year at its pace", () => {
    const chips = compareChips(2025, 112, [{ year: 2024, value: 25, brews: 25, scale: 4, note: '(n)' }], 'percent');
    expect(chips).toEqual([{ dir: 'up', text: "+12% on 2024's pace", note: '(n)' }]);
    const avg = compareChips(2026, 110, [{ year: 2025, value: 100, brews: 100 }, { year: 2024, value: 30, brews: 30, scale: 4 }], 'percent');
    expect(avg[1]!.text).toBe('About the same as an average year'); // (100 + 120) / 2
  });
});

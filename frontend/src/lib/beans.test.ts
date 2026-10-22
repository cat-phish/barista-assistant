import { describe, expect, it } from 'vitest';
import type { Bean } from '../api/types';
import { BEAN_PROCESSES, BEAN_SORT_COLUMNS, DETAILED_ROAST_LEVELS, formatAltitude, formatPricePerGram, freezeState, latestThaw, periodsLatestFirst, pricePerGram } from './beans';
import { sortBy, sortColumnOptions } from './listSort';
import { ROAST_LEVELS } from './scale';

describe('detailed roast levels', () => {
  it('each map to a 5-step level, never getting lighter as the roast darkens', () => {
    const order = Object.keys(ROAST_LEVELS);
    const steps = Object.values(DETAILED_ROAST_LEVELS).map((d) => order.indexOf(d.roastLevel));
    expect(steps.every((s) => s >= 0)).toBe(true);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});

describe('processes', () => {
  it('has the ten built-in processes, each labelled', () => {
    expect(Object.keys(BEAN_PROCESSES)).toHaveLength(10);
    expect(Object.values(BEAN_PROCESSES).every((p) => p.label.length > 0)).toBe(true);
  });
});

describe('formatAltitude', () => {
  it('groups thousands', () => {
    expect(formatAltitude(1950)).toBe('1,950 m');
  });
});

describe('pricePerGram', () => {
  it('divides the bag price by its weight', () => {
    const p = pricePerGram({ priceAmount: 21.5, priceCurrency: 'USD', bagWeightGrams: 340 });
    expect(p?.currency).toBe('USD');
    expect(formatPricePerGram(p!)).toBe('0.063 USD/g');
  });

  it('is null without a price or a bag weight', () => {
    expect(pricePerGram({ priceAmount: null, priceCurrency: null, bagWeightGrams: 340 })).toBeNull();
    expect(pricePerGram({ priceAmount: 20, priceCurrency: 'EUR', bagWeightGrams: null })).toBeNull();
  });
});

const bean = (over: Partial<Bean>): Bean => ({
  id: over.beanName ?? 'x',
  workspaceId: 'w',
  roasterName: 'Onyx',
  beanName: 'Bean',
  process: null,
  roastLevel: null,
  roastDate: null,
  inventoryWeightGrams: 0,
  showOnPublicMenu: true,
  roastType: null,
  detailedRoastLevel: null,
  blendType: null,
  decaf: false,
  website: null,
  priceAmount: null,
  priceCurrency: null,
  bagWeightGrams: null,
  notes: null,
  flavorProfile: null,
  region: null,
  altitudeMasl: null,
  producer: null,
  purchaseDate: null,
  greenSupplier: null,
  rating: null,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  freezePeriods: [],
  frozen: false,
  ...over,
});
const order = (beans: Bean[], key: string) => sortBy(beans, key, BEAN_SORT_COLUMNS, (b) => b.beanName).map((b) => b.beanName);

describe('bean sorting', () => {
  it('sorts by roast lightness, using the 5-step level when there is no roast name', () => {
    const beans = [
      bean({ beanName: 'French', detailedRoastLevel: 'french', roastLevel: 'dark' }),
      bean({ beanName: 'Unknown' }),
      bean({ beanName: 'Medium only', roastLevel: 'medium' }),
      bean({ beanName: 'Cinnamon', detailedRoastLevel: 'cinnamon', roastLevel: 'light' }),
    ];
    expect(order(beans, 'roast_asc')).toEqual(['Cinnamon', 'Medium only', 'French', 'Unknown']);
    expect(order(beans, 'roast_desc')).toEqual(['French', 'Medium only', 'Cinnamon', 'Unknown']); // unset stays last
  });

  it('sorts by freeze state: frozen, thawed, never', () => {
    const beans = [
      bean({ beanName: 'Never' }),
      bean({ beanName: 'Thawed', freezePeriods: [{ id: '1', frozenOn: '2026-10-02', thawedOn: '2026-10-05' }] }),
      bean({ beanName: 'Frozen', frozen: true, freezePeriods: [{ id: '2', frozenOn: '2026-10-02', thawedOn: null }] }),
    ];
    expect(order(beans, 'frozen_asc')).toEqual(['Frozen', 'Thawed', 'Never']);
    expect(freezeState(beans[0]!)).toBe('never');
  });

  it('follows the frozen flag, not the order of the periods', () => {
    // A refreeze on the same date: the open period may come back first.
    const periods = [
      { id: 'b', frozenOn: '2026-10-05', thawedOn: null },
      { id: 'a', frozenOn: '2026-10-05', thawedOn: '2026-10-05' },
    ];
    expect(freezeState(bean({ frozen: true, freezePeriods: periods }))).toBe('frozen');
  });

  it('sorts by rating, stock, decaf and process, breaking ties by name', () => {
    const beans = [
      bean({ beanName: 'B', rating: 3, inventoryWeightGrams: 100, decaf: true, process: 'washed' }),
      bean({ beanName: 'A', rating: 5, inventoryWeightGrams: 100, process: 'natural' }),
      bean({ beanName: 'C', inventoryWeightGrams: 0, process: 'anaerobic' }),
    ];
    expect(order(beans, 'rating_desc')).toEqual(['A', 'B', 'C']);
    expect(order(beans, 'stock_desc')).toEqual(['A', 'B', 'C']);
    expect(order(beans, 'decaf_desc')).toEqual(['B', 'A', 'C']);
    expect(order(beans, 'process_asc')).toEqual(['C', 'A', 'B']); // Anaerobic Fermentation, Natural, Washed
  });

  it('sorts by effective roast age, freshest first', () => {
    const beans = [
      bean({ beanName: 'Old', roastDate: '2026-09-01T00:00:00.000Z' }),
      bean({ beanName: 'No date' }),
      // Roasted earlier, but frozen most of the time since: younger in effect.
      bean({ beanName: 'Frozen long', roastDate: '2026-08-01T00:00:00.000Z', freezePeriods: [{ id: '1', frozenOn: '2026-08-02', thawedOn: '2026-10-15' }] }),
    ];
    expect(order(beans, 'age_asc')).toEqual(['Frozen long', 'Old', 'No date']);
  });

  it('offers every column in the Sort by dropdown', () => {
    expect(sortColumnOptions(BEAN_SORT_COLUMNS).map((c) => c.value)).toEqual([
      'name', 'roaster', 'added', 'purchased', 'roastDate', 'age', 'roast', 'process', 'frozen', 'decaf', 'rating', 'stock',
    ]);
    expect(sortColumnOptions(BEAN_SORT_COLUMNS).find((c) => c.value === 'name')).toMatchObject({ asc: 'Ascending (A–Z)' });
    expect(sortColumnOptions(BEAN_SORT_COLUMNS).find((c) => c.value === 'roast')).toMatchObject({ asc: 'Ascending (lightest first)', desc: 'Descending (darkest first)' });
  });
});

describe('freeze periods', () => {
  it('puts the open period first, then by thaw date, like the API', () => {
    const periods = [
      { id: 'old', frozenOn: '2026-10-01', thawedOn: '2026-10-03' },
      { id: 'open', frozenOn: '2026-10-08', thawedOn: null },
      { id: 'mid', frozenOn: '2026-10-04', thawedOn: '2026-10-06' },
    ];
    expect(periodsLatestFirst(periods).map((p) => p.id)).toEqual(['open', 'mid', 'old']);
    expect(latestThaw(periods)).toBe('2026-10-06');
    expect(latestThaw([])).toBe('');
  });
});

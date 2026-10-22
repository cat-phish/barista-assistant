import { describe, expect, it } from 'vitest';
import { BEAN_PROCESSES, DETAILED_ROAST_LEVELS, formatAltitude, formatPricePerGram, pricePerGram } from './beans';
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

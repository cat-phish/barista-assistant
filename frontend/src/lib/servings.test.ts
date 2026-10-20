import { describe, expect, it } from 'vitest';
import type { Drink } from '../api/types';
import { convertSize, defaultSize, formatAmount, formatSize, knownUnits, scaleAmount, sizeFactor } from './servings';

describe('drink sizes', () => {
  it('scales by the ratio of the sizes, across units', () => {
    expect(sizeFactor({ size: 12, unit: 'fl_oz' }, { size: 8, unit: 'fl_oz' })).toBe(1.5);
    expect(sizeFactor({ size: 8, unit: 'fl_oz' }, { size: 8, unit: 'fl_oz' })).toBe(1);
    expect(sizeFactor({ size: 473.176, unit: 'ml' }, { size: 8, unit: 'fl_oz' })).toBeCloseTo(2);
    expect(sizeFactor(null, { size: 8, unit: 'fl_oz' })).toBe(1);
    expect(sizeFactor({ size: 0, unit: 'ml' }, { size: 8, unit: 'fl_oz' })).toBe(1);
  });

  it('converts a size to the other unit, rounded sensibly', () => {
    expect(convertSize({ size: 8, unit: 'fl_oz' }, 'ml')).toEqual({ size: 237, unit: 'ml' });
    expect(convertSize({ size: 350, unit: 'ml' }, 'fl_oz')).toEqual({ size: 11.8, unit: 'fl_oz' });
    expect(convertSize({ size: 8, unit: 'fl_oz' }, 'fl_oz')).toEqual({ size: 8, unit: 'fl_oz' });
  });

  it('reads the default size only when both parts are set', () => {
    expect(defaultSize({ servingSize: 8, servingUnit: 'fl_oz' })).toEqual({ size: 8, unit: 'fl_oz' });
    expect(defaultSize({ servingSize: null, servingUnit: null })).toBeNull();
    expect(defaultSize(null)).toBeNull();
    expect(formatSize({ size: 8, unit: 'fl_oz' })).toBe('8 fl oz');
  });
});

describe('scaling amounts', () => {
  it('rounds to whole ml and g, 0.1 fl oz, and halves of anything else', () => {
    expect(scaleAmount(180, 'ml', 1.37)).toBe(247);
    expect(scaleAmount(18, 'g', 1.37)).toBe(25);
    expect(scaleAmount(6, 'fl oz', 1.37)).toBe(8.2);
    expect(scaleAmount(2, 'pump', 1.37)).toBe(2.5);
    expect(scaleAmount(2, null, 1.5)).toBe(3);
  });

  it('keeps the amount as written at the default size, and tiny amounts above zero', () => {
    expect(scaleAmount(1.25, 'tsp', 1)).toBe(1.25);
    expect(scaleAmount(0.2, 'tsp', 0.5)).toBe(0.1);
  });

  it('formats value and unit, or the unit alone', () => {
    expect(formatAmount(2, 'pump', 1.5)).toBe('3 pump');
    expect(formatAmount(2, null)).toBe('2');
    expect(formatAmount(null, 'to taste', 2)).toBe('to taste');
    expect(formatAmount(null, null)).toBeNull();
  });
});

describe('unit suggestions', () => {
  it('offers the built-in units, then the others in use, deduplicated', () => {
    const drink = (units: Array<string | null>) =>
      ({ ingredients: units.map((u) => ({ amountUnit: u })) }) as unknown as Drink;
    expect(knownUnits([drink(['pump', 'G', null]), drink(['Pump', 'tsp ', 'fl oz'])])).toEqual(['fl oz', 'ml', 'g', 'pump', 'tsp']);
  });
});

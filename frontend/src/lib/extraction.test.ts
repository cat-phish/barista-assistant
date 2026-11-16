import { describe, expect, it } from 'vitest';
import { brixToTds, DEFAULT_EY_ESPRESSO, DEFAULT_EY_FILTER, expectedBrix, expectedEy, expectedTds, extractionYield, type EyBrew } from './extraction';

const brew = { tdsPercent: 1.38, doseGrams: 15, yieldGrams: 220, waterGrams: 250 };

describe('extractionYield', () => {
  it('uses the measured yield for percolation and espresso', () => {
    expect(extractionYield({ ...brew, style: 'pour_over' })).toBe(20.2); // 1.38 × 220 / 15
    expect(extractionYield({ tdsPercent: 9.5, doseGrams: 18, yieldGrams: 36, waterGrams: null, style: 'standard' })).toBe(19);
  });

  it('uses the water for immersion styles', () => {
    expect(extractionYield({ ...brew, style: 'immersion' })).toBe(23); // 1.38 × 250 / 15
    expect(extractionYield({ ...brew, style: 'cold_brew' })).toBe(23);
  });

  it('falls back to the yield without a recipe style', () => {
    expect(extractionYield({ ...brew, style: null })).toBe(20.2);
  });

  it('is null without TDS, the beverage weight it needs, or a dose', () => {
    expect(extractionYield({ ...brew, tdsPercent: null, style: 'pour_over' })).toBeNull();
    expect(extractionYield({ ...brew, yieldGrams: null, style: 'pour_over' })).toBeNull();
    expect(extractionYield({ ...brew, waterGrams: null, style: 'immersion' })).toBeNull();
    expect(extractionYield({ ...brew, doseGrams: 0, style: 'pour_over' })).toBeNull();
  });
});

describe('brixToTds', () => {
  it('converts along the curve, to 2 decimals', () => {
    expect(brixToTds(1.6)).toBe(1.27); // filter
    expect(brixToTds(2)).toBe(1.59);
    expect(brixToTds(11)).toBe(9.12); // espresso
  });

  it('never goes below 0', () => {
    expect(brixToTds(0)).toBe(0);
    expect(brixToTds(0.005)).toBe(0);
  });
});

describe('expected readings', () => {
  it('expectedTds is EY × dose / beverage, 0.01', () => {
    expect(expectedTds(15, 250, 20)).toBe(1.2);
    expect(expectedTds(18, 36, 19)).toBe(9.5);
    expect(expectedTds(null, 250, 20)).toBeNull();
    expect(expectedTds(15, 0, 20)).toBeNull();
  });
  it('expectedBrix inverts brixToTds, 0.1', () => {
    for (const brix of [1.6, 11, 12.4]) expect(expectedBrix(brixToTds(brix))).toBe(brix);
    expect(expectedBrix(null)).toBeNull();
    expect(expectedBrix(0)).toBeNull();
  });
  const log = (recipeId: string, kind: string, ey: number): EyBrew => ({
    recipeId,
    actualDoseGrams: 15,
    actualWaterGrams: 250,
    actualYieldGrams: 200,
    tdsPercent: (ey * 15) / 200,
    style: null,
    recipe: { methodKind: kind, style: null },
  });
  it('expectedEy: your recipe average, else the method kind, else the default', () => {
    const opts = { recipeId: 'r1', methodKind: 'filter', espresso: false };
    expect(expectedEy([log('r1', 'filter', 21), log('r1', 'filter', 22), log('r2', 'filter', 18)], opts)).toBe(21.5);
    expect(expectedEy([log('r1', 'filter', 21), log('r2', 'filter', 18), log('r3', 'espresso', 30)], opts)).toBe(19.5);
    expect(expectedEy([log('r1', 'filter', 21)], opts)).toBe(DEFAULT_EY_FILTER);
    expect(expectedEy([], { ...opts, espresso: true })).toBe(DEFAULT_EY_ESPRESSO);
    expect(expectedEy([{ ...log('r1', 'filter', 21), tdsPercent: null }, log('r1', 'filter', 22)], opts)).toBe(DEFAULT_EY_FILTER);
  });
});

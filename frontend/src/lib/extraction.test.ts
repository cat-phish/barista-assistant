import { describe, expect, it } from 'vitest';
import { extractionYield } from './extraction';

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

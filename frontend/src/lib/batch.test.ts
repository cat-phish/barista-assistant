import { describe, expect, it } from 'vitest';
import { batchYield, servingShare, stockLeft } from './batch';

const log = (fields: Partial<Parameters<typeof batchYield>[0]> = {}) => ({ actualDoseGrams: 40, actualWaterGrams: 400, actualIceGrams: null, actualYieldGrams: null, ...fields });
const roast = { roastLevel: null, recipeRoastLevel: 'light' as const };

describe('batchYield', () => {
  it('takes the measured yield as it is', () => {
    expect(batchYield(log({ actualYieldGrams: 290 }), roast)).toEqual({ grams: 290, estimated: false });
  });
  it("estimates from the brewer's retention, else the roast level", () => {
    expect(batchYield(log(), roast)).toEqual({ grams: 320, estimated: true }); // 400 − 2.0 × 40
    expect(batchYield(log(), { roastLevel: 'dark', recipeRoastLevel: 'light' })).toEqual({ grams: 308, estimated: true }); // 2.3
    expect(batchYield(log(), roast, { typed: 2.5, measured: [] })).toEqual({ grams: 300, estimated: true });
    const measured = [{ actualDoseGrams: 40, actualWaterGrams: 400, actualIceGrams: null, actualYieldGrams: 300 }];
    expect(batchYield(log(), roast, { typed: null, measured })).toEqual({ grams: 300, estimated: true });
  });
  it('is null without water', () => {
    expect(batchYield(log({ actualWaterGrams: null }), roast)).toBeNull();
  });
});

describe('servingShare and stockLeft', () => {
  it('splits the batch by concentrate poured', () => {
    expect(servingShare(80, 320, 160)).toBe(0.25);
    expect(stockLeft(320, 160)).toBe(160);
  });
  it('never adds up past the whole batch when more was poured than the yield', () => {
    const pours = [150, 150, 100]; // 400 g from a batch estimated at 320 g
    const total = pours.reduce((a, b) => a + b, 0);
    expect(pours.reduce((sum, p) => sum + servingShare(p, 320, total), 0)).toBeCloseTo(1);
    expect(stockLeft(320, total)).toBe(0);
  });
  it('gives nothing from an empty batch', () => {
    expect(servingShare(50, 0, 0)).toBe(0);
    expect(stockLeft(0, 0)).toBe(0);
  });
});

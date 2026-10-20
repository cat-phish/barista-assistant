import { describe, expect, it } from 'vitest';
import type { RecipeStep } from '../api/types';
import { brewRetention, estimateYield, GRAMS_PER_FL_OZ, retentionOf, scaleBatch, scaleShot, scaleSteps } from './scale';

const recipe = { targetDoseGrams: 15, targetWaterGrams: 250, expectedYieldGrams: null };

describe('yield and retention', () => {
  it('estimates yield as water minus what the grounds keep', () => {
    expect(estimateYield(15, 250, 2)).toBe(220);
    expect(estimateYield(100, 50, 2)).toBe(0);
  });

  it('ignores implausible retention (typos, unmeasured drips)', () => {
    expect(retentionOf(15, 250, 220)).toBe(2);
    expect(retentionOf(15, 250, 250)).toBeNull();
    expect(retentionOf(15, 250, 100)).toBeNull();
  });

  it('prefers measured brews (median), then the recipe adjusted for roast, then the roast default', () => {
    const measured = [
      { actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: 217 }, // 2.2
      { actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: 220 }, // 2.0
      { actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: 218.5 }, // 2.1
      { actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: null },
      { actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: 250 }, // implausible
    ];
    const m = brewRetention({ roastLevel: 'dark', recipe, measured });
    expect(m.source).toEqual({ kind: 'measured', count: 3 });
    expect(m.retention).toBeCloseTo(2.1);

    // Recipe says 15 g -> 250 g gives 223 g (1.8 g/g for a light roast); dark keeps 2.3/2.0 more.
    const r = brewRetention({ roastLevel: 'dark', recipe: { ...recipe, expectedYieldGrams: 223 }, measured: [] });
    expect(r.source).toEqual({ kind: 'recipe', roastLevel: 'dark' });
    expect(r.retention).toBeCloseTo(1.8 * 1.15);

    expect(brewRetention({ roastLevel: null, recipe, measured: [] })).toEqual({ retention: 2, source: { kind: 'roast', roastLevel: 'light' } });
    expect(brewRetention({ roastLevel: 'medium', recipe: null, measured: [] }).retention).toBe(2.1);
  });
});

describe('scaleBatch', () => {
  it('keeps the recipe exactly when not scaled', () => {
    expect(scaleBatch({ targetDoseGrams: 15, targetWaterGrams: 250.5 }, { field: 'dose', value: 15 }, 2)).toMatchObject({
      dose: 15,
      water: 250.5,
      yield: 221,
      factor: 1,
    });
  });

  it('scales from dose, water or yield with the ratio fixed', () => {
    expect(scaleBatch(recipe, { field: 'dose', value: 22.5 }, 2)).toMatchObject({ dose: 22.5, water: 375, yield: 330, factor: 1.5 });
    expect(scaleBatch(recipe, { field: 'water', value: 400 }, 2)).toMatchObject({ dose: 24, water: 400, yield: 352, factor: 1.6 });
    // 15:250 at 2 g/g keeps 88% of the water as beverage: 330 g out needs 375 g in.
    expect(scaleBatch(recipe, { field: 'yield', value: 330 }, 2)).toMatchObject({ dose: 22.5, water: 375, yield: 330, factor: 1.5 });
  });

  it('a custom ratio keeps the entered value and moves the other side', () => {
    // 15 g at 1:15 -> 225 g; 400 g water at 1:15 -> 26.7 g coffee.
    expect(scaleBatch(recipe, { field: 'dose', value: 15 }, 2, 15)).toMatchObject({ dose: 15, water: 225, yield: 195, ratio: 15, factor: 0.9 });
    expect(scaleBatch(recipe, { field: 'water', value: 400 }, 2, 15)).toMatchObject({ dose: 26.7, water: 400 });
    // Same yield at a stronger ratio needs more water (the grounds keep more of it).
    const weaker = scaleBatch(recipe, { field: 'yield', value: 300 }, 2, 17)!;
    const stronger = scaleBatch(recipe, { field: 'yield', value: 300 }, 2, 15)!;
    expect(stronger.water).toBeGreaterThan(weaker.water);
    expect(scaleBatch(recipe, { field: 'dose', value: 15 }, 2, 0)).toBeNull();
    expect(scaleBatch(recipe, { field: 'yield', value: 300 }, 2, 2)).toBeNull(); // grounds would keep all the water
  });

  it('scales from a mug size in US fl oz and reports yield in fl oz', () => {
    const mug = scaleBatch(recipe, { field: 'yieldOz', value: 12 }, 2)!;
    expect(mug.water).toBe(Math.round((12 * GRAMS_PER_FL_OZ) / 0.88));
    expect(Math.abs(mug.yieldOz - 12)).toBeLessThanOrEqual(0.1);
    expect(scaleBatch(recipe, { field: 'dose', value: 15 }, 2)!.yieldOz).toBe(7.4); // 220 g
  });

  it('rounds dose to 0.1 g and water to whole grams', () => {
    const b = scaleBatch(recipe, { field: 'water', value: 333 }, 2)!;
    expect(b.dose).toBe(20);
    expect(scaleBatch(recipe, { field: 'dose', value: 17.3 }, 2)!.water).toBe(288);
  });

  it('refuses values that cannot make a batch', () => {
    expect(scaleBatch(recipe, { field: 'dose', value: 0 }, 2)).toBeNull();
    expect(scaleBatch(recipe, { field: 'water', value: Number.NaN }, 2)).toBeNull();
    expect(scaleBatch({ targetDoseGrams: 18, targetWaterGrams: 36 }, { field: 'yield', value: 40 }, 2)).toBeNull();
  });
});

describe('scaleSteps', () => {
  const base = { label: null, advance: 'auto', targetTempC: null, pressureBar: null, pressureEndBar: null, flowRate: null, flowEndRate: null } as const;
  const steps: RecipeStep[] = [
    { ...base, id: 'a', stepOrder: 1, stepType: 'bloom', durationSec: 45, targetWaterGrams: 50 },
    { ...base, id: 'b', stepOrder: 2, stepType: 'swirl', durationSec: 0, targetWaterGrams: null },
    { ...base, id: 'c', stepOrder: 3, stepType: 'pour', durationSec: 30, targetWaterGrams: 250 },
  ];

  it('scales pour targets, keeps times, and ends on the batch water', () => {
    const b = scaleBatch(recipe, { field: 'dose', value: 17.3 }, 2)!;
    const scaled = scaleSteps(steps, b.factor);
    expect(scaled.map((s) => s.targetWaterGrams)).toEqual([58, null, b.water]);
    expect(scaled.map((s) => s.durationSec)).toEqual(steps.map((s) => s.durationSec));
    expect(scaleSteps(steps, 1)).toBe(steps);
  });
});

describe('scaleShot', () => {
  const classic = { targetDoseGrams: 18, expectedYieldGrams: 36 };
  it('keeps the recipe exactly, scales either side at the ratio, and takes a custom ratio', () => {
    expect(scaleShot(classic, { field: 'dose', value: 18 })).toEqual({ dose: 18, yield: 36, ratio: 2 });
    expect(scaleShot(classic, { field: 'dose', value: 20 })).toEqual({ dose: 20, yield: 40, ratio: 2 });
    expect(scaleShot(classic, { field: 'yield', value: 45 })).toEqual({ dose: 22.5, yield: 45, ratio: 2 });
    expect(scaleShot(classic, { field: 'dose', value: 18 }, 2.5)).toEqual({ dose: 18, yield: 45, ratio: 2.5 });
    expect(scaleShot(classic, { field: 'yield', value: 40 }, 2.5)!.dose).toBe(16);
  });
  it('refuses values that cannot make a shot', () => {
    expect(scaleShot(classic, { field: 'dose', value: 0 })).toBeNull();
    expect(scaleShot(classic, { field: 'dose', value: 18 }, Number.NaN)).toBeNull();
  });
});

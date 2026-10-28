import { describe, expect, it } from 'vitest';
import type { RecipeStep } from '../api/types';
import { brewRetention, estimateYield, factorText, GRAMS_PER_FL_OZ, linkRatio, ratioText, retentionOf, scaleBatch, scaleShot, scaleSteps, sliderDose, sliderPosition, waterShare } from './scale';

const recipe = { targetDoseGrams: 15, targetWaterGrams: 250, targetIceGrams: null, expectedYieldGrams: null };

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
      { actualDoseGrams: 15, actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 217 }, // 2.2, flash chilled
      { actualDoseGrams: 15, actualWaterGrams: 250, actualIceGrams: null, actualYieldGrams: 220 }, // 2.0
      { actualDoseGrams: 15, actualWaterGrams: 250, actualIceGrams: null, actualYieldGrams: 218.5 }, // 2.1
      { actualDoseGrams: 15, actualWaterGrams: 250, actualIceGrams: null, actualYieldGrams: null },
      { actualDoseGrams: 15, actualWaterGrams: 250, actualIceGrams: null, actualYieldGrams: 250 }, // implausible
    ];
    const m = brewRetention({ roastLevel: 'dark', recipeRoastLevel: 'light', recipe, measured });
    expect(m.source).toEqual({ kind: 'measured', count: 3 });
    expect(m.retention).toBeCloseTo(2.1);

    // Recipe says 15 g -> 250 g gives 223 g (1.8 g/g for a light roast); dark keeps 2.3/2.0 more.
    const r = brewRetention({ roastLevel: 'dark', recipeRoastLevel: 'light', recipe: { ...recipe, expectedYieldGrams: 223 }, measured: [] });
    expect(r.source).toEqual({ kind: 'recipe', roastLevel: 'dark' });
    expect(r.retention).toBeCloseTo(1.8 * 1.15);

    expect(brewRetention({ roastLevel: null, recipeRoastLevel: 'light', recipe, measured: [] })).toEqual({ retention: 2, source: { kind: 'roast', roastLevel: 'light' } });
    expect(brewRetention({ roastLevel: 'medium', recipeRoastLevel: 'light', recipe: null, measured: [] }).retention).toBe(2.1);
  });

  it("uses the workspace's recipe roast as the baseline and for beans with no roast level", () => {
    // No roast on the bean: the recipe roast is assumed.
    expect(brewRetention({ roastLevel: null, recipeRoastLevel: 'medium', recipe: null, measured: [] })).toEqual({ retention: 2.1, source: { kind: 'roast', roastLevel: 'medium' } });
    // A recipe written for medium (2.1), brewed with a medium bean: its own figure, unshifted.
    const r = { targetDoseGrams: 15, targetWaterGrams: 250, targetIceGrams: null, expectedYieldGrams: 218.5 }; // retention 2.1
    expect(brewRetention({ roastLevel: 'medium', recipeRoastLevel: 'medium', recipe: r, measured: [] }).retention).toBeCloseTo(2.1);
    expect(brewRetention({ roastLevel: 'dark', recipeRoastLevel: 'medium', recipe: r, measured: [] }).retention).toBeCloseTo(2.3);
  });
});

describe('scaleBatch', () => {
  it('keeps the recipe exactly when not scaled', () => {
    expect(scaleBatch({ targetDoseGrams: 15, targetWaterGrams: 250.5, targetIceGrams: null }, { field: 'dose', value: 15 }, 2)).toMatchObject({
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
    expect(scaleBatch(recipe, { field: 'dose', value: 15 }, 2)!.yieldMl).toBe(220);
    const ml = scaleBatch(recipe, { field: 'yieldMl', value: 350 }, 2)!;
    expect(Math.abs(ml.yieldMl - 350)).toBeLessThanOrEqual(1);
  });

  it('rounds dose to 0.1 g and water to whole grams', () => {
    const b = scaleBatch(recipe, { field: 'water', value: 333 }, 2)!;
    expect(b.dose).toBe(20);
    expect(scaleBatch(recipe, { field: 'dose', value: 17.3 }, 2)!.water).toBe(288);
  });

  it('refuses values that cannot make a batch', () => {
    expect(scaleBatch(recipe, { field: 'dose', value: 0 }, 2)).toBeNull();
    expect(scaleBatch(recipe, { field: 'water', value: Number.NaN }, 2)).toBeNull();
    expect(scaleBatch({ targetDoseGrams: 18, targetWaterGrams: 36, targetIceGrams: null }, { field: 'yield', value: 40 }, 2)).toBeNull();
  });

  // Flash chilled (docs/api/recipes.md §5): 150 g hot water onto 100 g ice, 1:16.7.
  const iced = { targetDoseGrams: 15, targetWaterGrams: 150, targetIceGrams: 100 };
  it('flash chilled: the ratio and yield count the ice, which scales with the water', () => {
    expect(scaleBatch(iced, { field: 'dose', value: 15 }, 2)).toMatchObject({ dose: 15, water: 150, ice: 100, yield: 220, factor: 1 });
    expect(scaleBatch(iced, { field: 'dose', value: 30 }, 2)).toMatchObject({ dose: 30, water: 300, ice: 200, yield: 440, factor: 2 });
    // Typing the hot water keeps the split: 225 g water → 150 g ice, 22.5 g coffee.
    expect(scaleBatch(iced, { field: 'water', value: 225 }, 2)).toMatchObject({ dose: 22.5, water: 225, ice: 150, factor: 1.5 });
    expect(scaleBatch(iced, { field: 'yield', value: 330 }, 2)).toMatchObject({ dose: 22.5, water: 225, ice: 150, yield: 330 });
    expect(scaleBatch(recipe, { field: 'dose', value: 15 }, 2)!.ice).toBeNull();
  });
  it("flash chilled: a brew's own split replaces the recipe's", () => {
    // A repeat of 160 g water + 90 g ice: same ratio, its split.
    expect(scaleBatch(iced, { field: 'dose', value: 15 }, 2, 250 / 15, waterShare(160, 90))).toMatchObject({ dose: 15, water: 160, ice: 90, factor: 160 / 150 });
    expect(waterShare(250, null)).toBe(1);
  });
  it('flash chilled: water and ice add up to the rounded liquid', () => {
    // 251.25 g liquid: 150.75 → 151 g water, so 100 g ice (not 100.5 → 101).
    expect(scaleBatch(iced, { field: 'dose', value: 15.075 }, 2)).toMatchObject({ water: 151, ice: 100 });
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

describe('linkRatio', () => {
  it('typing the dose keeps the water and changes the ratio', () => {
    const r = linkRatio('dose', 18, 250)!;
    expect(ratioText(r)).toBe('13.9');
    expect(scaleBatch(recipe, { field: 'dose', value: 18 }, 2, r)).toMatchObject({ dose: 18, water: 250, yield: 214, factor: 1 });
  });
  it('typing the water keeps the dose and changes the ratio', () => {
    const r = linkRatio('water', 300, 15)!;
    expect(ratioText(r)).toBe('20');
    const b = scaleBatch(recipe, { field: 'water', value: 300 }, 2, r)!;
    expect(b).toMatchObject({ dose: 15, water: 300, yield: 270 });
    expect(b.factor).toBeCloseTo(1.2); // pours follow the water
  });
  it('an espresso shot weight keeps the dose and changes the ratio', () => {
    const r = linkRatio('yield', 40, 18)!;
    expect(scaleShot({ targetDoseGrams: 18, expectedYieldGrams: 36 }, { field: 'yield', value: 40 }, r)).toEqual({ dose: 18, yield: 40, ratio: r });
  });
  it('holds nothing without a valid amount on both sides', () => {
    expect(linkRatio('dose', Number.NaN, 250)).toBeNull();
    expect(linkRatio('dose', 18, null)).toBeNull();
    expect(linkRatio('water', 0, 15)).toBeNull();
  });
});

describe('scale slider', () => {
  it('sits at the dose over the recipe’s, to the nearest step, within half to double', () => {
    expect(sliderPosition(15, 15)).toBe(1);
    expect(sliderPosition(22.5, 15)).toBe(1.5);
    expect(sliderPosition(16, 15)).toBe(1.05); // 1.067
    expect(sliderPosition(5, 15)).toBe(0.5);
    expect(sliderPosition(45, 15)).toBe(2);
    expect(sliderPosition(null, 15)).toBe(1);
  });
  it('gives the dose to 0.1 g, and says the real factor', () => {
    expect(sliderDose(1.35, 15)).toBe(20.3);
    expect(sliderDose(0.5, 18)).toBe(9);
    expect(factorText(22.5, 15)).toBe('×1.5');
    expect(factorText(45, 15)).toBe('×3');
    expect(factorText(15, 15)).toBe('×1');
  });
});

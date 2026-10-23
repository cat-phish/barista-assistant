// Recipe scaling and beverage-yield estimates (docs/roadmap.md, phase 1).
//
// Yield ≈ water − retention × dose, where retention is the water the spent
// grounds keep, in grams per gram of coffee. Published figures put it around
// 2–2.5 g/g; there is no measured light/dark split, so the per-roast numbers
// below are an assumption. Measured brews replace them (brewRetention).
import type { RecipeStep, RoastLevel } from '../api/types';

export const ROAST_LEVELS: Record<RoastLevel, { label: string; retention: number }> = {
  light: { label: 'Light', retention: 2.0 },
  medium_light: { label: 'Medium-light', retention: 2.05 },
  medium: { label: 'Medium', retention: 2.1 },
  medium_dark: { label: 'Medium-dark', retention: 2.2 },
  dark: { label: 'Dark', retention: 2.3 },
};


// Retention outside this range is a typo or an unmeasured drip, not data.
const PLAUSIBLE = { min: 1, max: 3.5 };

const round1 = (n: number) => Math.round(n * 10) / 10;

export function estimateYield(dose: number, water: number, retention: number): number {
  return Math.max(0, Math.round(water - retention * dose));
}

export function retentionOf(dose: number, water: number, yieldGrams: number): number | null {
  if (dose <= 0) return null;
  const r = (water - yieldGrams) / dose;
  return r >= PLAUSIBLE.min && r <= PLAUSIBLE.max ? r : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export type RetentionSource =
  | { kind: 'measured'; count: number } // your brews of this bean with this recipe
  | { kind: 'recipe'; roastLevel: RoastLevel } // the recipe's expected yield, adjusted for roast
  | { kind: 'roast'; roastLevel: RoastLevel }; // the roast-level default

export interface MeasuredBrew {
  actualDoseGrams: number;
  actualWaterGrams: number;
  actualYieldGrams: number | null;
}

// Best retention estimate for brewing this bean with this recipe.
// recipeRoastLevel: the roast the workspace's recipes are written for (its
// "Defaults" setting); also assumed for a bean with no roast level.
export function brewRetention(input: {
  roastLevel: RoastLevel | null;
  recipeRoastLevel: RoastLevel;
  recipe: { targetDoseGrams: number; targetWaterGrams: number; expectedYieldGrams: number | null } | null;
  measured: MeasuredBrew[];
}): { retention: number; source: RetentionSource } {
  const measured = input.measured
    .map((b) => (b.actualYieldGrams === null ? null : retentionOf(b.actualDoseGrams, b.actualWaterGrams, b.actualYieldGrams)))
    .filter((r): r is number => r !== null);
  if (measured.length) return { retention: median(measured), source: { kind: 'measured', count: measured.length } };

  const roastLevel = input.roastLevel ?? input.recipeRoastLevel;
  const roast = ROAST_LEVELS[roastLevel].retention;
  const r = input.recipe;
  const recipeRetention = r && r.expectedYieldGrams !== null ? retentionOf(r.targetDoseGrams, r.targetWaterGrams, r.expectedYieldGrams) : null;
  if (recipeRetention !== null) {
    // The recipe's yield is for a recipeRoastLevel bean; shift it by the roast difference.
    return { retention: recipeRetention * (roast / ROAST_LEVELS[input.recipeRoastLevel].retention), source: { kind: 'recipe', roastLevel } };
  }
  return { retention: roast, source: { kind: 'roast', roastLevel } };
}

// yield (g) is espresso's shot weight; a filter batch's yield is typed as a
// volume (yieldOz / yieldMl, by preference).
export type ScaleField = 'dose' | 'water' | 'yield' | 'yieldOz' | 'yieldMl';

// US fluid ounce. Brewed coffee is close enough to 1 g/ml for a mug-fill estimate.
export const GRAMS_PER_FL_OZ = 29.5735;

export interface Batch {
  dose: number; // 0.1 g
  water: number; // whole grams once scaled
  yield: number; // estimate, whole grams
  yieldOz: number; // estimate, 0.1 US fl oz
  yieldMl: number; // estimate, whole ml
  ratio: number; // water / dose (the "15" in 1:15)
  factor: number; // water / recipe water: what pour targets are multiplied by
}

// Scale a recipe from one entered value. `ratio` (water per gram of coffee)
// defaults to the recipe's own. Returns null if the values can't give a
// sensible batch.
export function scaleBatch(
  recipe: { targetDoseGrams: number; targetWaterGrams: number },
  lead: { field: ScaleField; value: number },
  retention: number,
  ratio?: number,
): Batch | null {
  const { targetDoseGrams: d0, targetWaterGrams: w0 } = recipe;
  const recipeRatio = w0 / d0;
  const r = ratio ?? recipeRatio;
  if (!(lead.value > 0) || !(r > 0) || d0 <= 0 || w0 <= 0) return null;
  // Exact water for the lead value: yield = water − retention × water / ratio.
  const keep = 1 - retention / r;
  let exactWater: number;
  if (lead.field === 'dose') exactWater = lead.value * r;
  else if (lead.field === 'water') exactWater = lead.value;
  else {
    if (keep <= 0) return null;
    const yieldGrams = lead.field === 'yieldOz' ? lead.value * GRAMS_PER_FL_OZ : lead.value; // g ≈ ml
    exactWater = yieldGrams / keep;
  }
  // The recipe as written: keep its exact numbers (no rounding surprises).
  const unscaled = Math.abs(r - recipeRatio) < 1e-9 && Math.abs(exactWater / w0 - 1) < 1e-9;
  const water = unscaled ? w0 : lead.field === 'water' ? lead.value : Math.round(exactWater);
  const dose = unscaled ? d0 : lead.field === 'dose' ? lead.value : round1(exactWater / r);
  if (water <= 0 || dose <= 0) return null;
  const yieldGrams = estimateYield(dose, water, retention);
  return { dose, water, yield: yieldGrams, yieldOz: round1(yieldGrams / GRAMS_PER_FL_OZ), yieldMl: yieldGrams, ratio: r, factor: water / w0 };
}

// Espresso: dose and target shot weight at a ratio (shot ÷ dose, the "2" in
// 1:2), from either one. No water or retention: the shot weight is measured.
export interface Shot {
  dose: number; // 0.1 g
  yield: number; // 0.1 g
  ratio: number;
}

export function scaleShot(
  recipe: { targetDoseGrams: number; expectedYieldGrams: number },
  lead: { field: 'dose' | 'yield'; value: number },
  ratio?: number,
): Shot | null {
  const { targetDoseGrams: d0, expectedYieldGrams: y0 } = recipe;
  const recipeRatio = y0 / d0;
  const r = ratio ?? recipeRatio;
  if (!(lead.value > 0) || !(r > 0) || d0 <= 0 || y0 <= 0) return null;
  // The recipe as written keeps its exact numbers.
  const sameRatio = Math.abs(r - recipeRatio) < 1e-9;
  if (lead.field === 'dose') {
    const unscaled = sameRatio && Math.abs(lead.value - d0) < 1e-9;
    return { dose: lead.value, yield: unscaled ? y0 : round1(lead.value * r), ratio: r };
  }
  const unscaled = sameRatio && Math.abs(lead.value - y0) < 1e-9;
  return { dose: unscaled ? d0 : round1(lead.value / r), yield: lead.value, ratio: r };
}

// Pour targets follow the water; step times stay the same.
export function scaleSteps(steps: RecipeStep[], factor: number): RecipeStep[] {
  if (Math.abs(factor - 1) < 1e-9) return steps;
  return steps.map((s) => (s.targetWaterGrams === null ? s : { ...s, targetWaterGrams: Math.round(s.targetWaterGrams * factor) }));
}

// Figures worked out from a brew log, not stored (docs/api/brew-logs.md §6),
// shared by the backend (CSV export) and the worker (the AI's context). The
// frontend has the same rule in lib/extraction.ts.
import type { RecipeStyle } from "./schema.js";

// Styles where the grounds sit in the water: the liquid they keep is as strong
// as the cup, so extraction is worked out from the water, not the yield.
export const IMMERSION_STYLES: readonly RecipeStyle[] = ["immersion", "cold_brew", "rapid_cold", "ibrik"];

// The water a ratio counts: for a flash chilled brew (docs/api/recipes.md §5)
// the hot water plus the ice in the server. null without water (espresso).
export function ratioWater(water: number | null, ice: number | null): number | null {
  return water === null ? null : Math.round((water + (ice ?? 0)) * 100) / 100;
}

// Extraction yield, %: TDS × beverage ÷ dose, rounded to 0.1; null without a
// TDS reading or the beverage weight it needs, and for a brew made onto ice,
// which takes no TDS (docs/api/brew-logs.md §6).
export function extractionYield(brew: {
  tdsPercent: number | null;
  actualDoseGrams: number;
  actualWaterGrams: number | null;
  actualIceGrams: number | null;
  actualYieldGrams: number | null;
  brewsLike: RecipeStyle | null;
}): number | null {
  if (brew.tdsPercent === null || brew.actualIceGrams !== null || !(brew.actualDoseGrams > 0)) return null;
  const beverage = brew.brewsLike && IMMERSION_STYLES.includes(brew.brewsLike) ? brew.actualWaterGrams : brew.actualYieldGrams;
  return beverage === null ? null : Math.round(((brew.tdsPercent * beverage) / brew.actualDoseGrams) * 10) / 10;
}

// Step times with the batch (docs/api/recipes.md §5): a recipe with
// stepTimeScaling gives its pour and wait steps time × factor^stepTimeScaling,
// to the second, where factor is the batch's water ÷ the recipe's; the finish
// window moves by the time they gained or lost. The frontend has the same rule
// in lib/scale.ts.
export const TIMED_WITH_BATCH: readonly string[] = ["pour", "wait"];
export function scaleStepTimes<S extends { stepType: string; durationSec: number | null }>(
  steps: S[],
  factor: number,
  exponent: number | null,
): { steps: S[]; shiftSec: number } {
  if (exponent === null || !(factor > 0) || Math.abs(factor - 1) < 1e-9) return { steps, shiftSec: 0 };
  const k = factor ** exponent;
  let shiftSec = 0;
  const scaled = steps.map((s) => {
    if (s.durationSec === null || !TIMED_WITH_BATCH.includes(s.stepType)) return s;
    const durationSec = Math.round(s.durationSec * k);
    shiftSec += durationSec - s.durationSec;
    return { ...s, durationSec };
  });
  return { steps: scaled, shiftSec };
}

// A finish window moved by shiftSec, never below 0.
export function shiftWindow(min: number | null, max: number | null, shiftSec: number): { min: number | null; max: number | null } {
  if (min === null || max === null) return { min, max };
  return { min: Math.max(0, min + shiftSec), max: Math.max(0, max + shiftSec) };
}

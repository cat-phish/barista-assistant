// Extraction yield from a TDS reading (docs/api/brew-logs.md §6), worked out,
// not stored. The worker has the same rule (worker/src/context.ts).
import type { RecipeStyle } from '../api/types';

// The grounds sit in the water: the liquid they keep is as strong as the cup,
// so the beverage is the water, not the measured yield.
const IMMERSION_STYLES: readonly (RecipeStyle | null)[] = ['immersion', 'cold_brew', 'ibrik'];

export function usesWater(style: RecipeStyle | null): boolean {
  return IMMERSION_STYLES.includes(style);
}

// EY %, rounded to 0.1, or null when TDS (or the beverage weight it needs) is missing.
export function extractionYield(input: {
  tdsPercent: number | null;
  doseGrams: number;
  yieldGrams: number | null;
  waterGrams: number | null;
  style: RecipeStyle | null;
}): number | null {
  const { tdsPercent, doseGrams, style } = input;
  if (tdsPercent === null || !(doseGrams > 0)) return null;
  const beverage = usesWater(style) ? input.waterGrams : input.yieldGrams;
  return beverage === null ? null : Math.round(((tdsPercent * beverage) / doseGrams) * 10) / 10;
}

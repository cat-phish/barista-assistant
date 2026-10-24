// Figures worked out from a brew log, not stored (docs/api/brew-logs.md §6),
// shared by the backend (CSV export) and the worker (the AI's context). The
// frontend has the same rule in lib/extraction.ts.
import type { RecipeStyle } from "./schema.js";

// Styles where the grounds sit in the water: the liquid they keep is as strong
// as the cup, so extraction is worked out from the water, not the yield.
export const IMMERSION_STYLES: readonly RecipeStyle[] = ["immersion", "cold_brew", "rapid_cold", "ibrik"];

// Extraction yield, %: TDS × beverage ÷ dose, rounded to 0.1; null without a
// TDS reading or the beverage weight it needs.
export function extractionYield(brew: {
  tdsPercent: number | null;
  actualDoseGrams: number;
  actualWaterGrams: number | null;
  actualYieldGrams: number | null;
  brewsLike: RecipeStyle | null;
}): number | null {
  if (brew.tdsPercent === null || !(brew.actualDoseGrams > 0)) return null;
  const beverage = brew.brewsLike && IMMERSION_STYLES.includes(brew.brewsLike) ? brew.actualWaterGrams : brew.actualYieldGrams;
  return beverage === null ? null : Math.round(((brew.tdsPercent * beverage) / brew.actualDoseGrams) * 10) / 10;
}

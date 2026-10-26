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

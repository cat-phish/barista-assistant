// Extraction yield from a TDS reading (docs/api/brew-logs.md §6), worked out,
// not stored. The worker has the same rule (worker/src/context.ts).
import type { RecipeStyle } from '../api/types';

// The grounds sit in the water: the liquid they keep is as strong as the cup,
// so the beverage is the water, not the measured yield.
const IMMERSION_STYLES: readonly (RecipeStyle | null)[] = ['immersion', 'cold_brew', 'rapid_cold', 'ibrik'];

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

// TDS % from a °Brix reading, for refractometers that read Brix. Coffee isn't
// sugar water, so it's a curve rather than a flat ×0.85; the same one
// Beanconqueror uses (brew-brix-calculator). Rounded to 2 decimals, never < 0.
export function brixToTds(brix: number): number {
  const tds = (0.0036 * brix + 0.7897) * brix - 0.0071;
  return Math.max(0, Math.round(tds * 100) / 100);
}

// ---- Expected readings, for the nudge buttons' first tap (lib/nudge.ts) ----

// Without measured brews to go on: a typical extraction.
export const DEFAULT_EY_FILTER = 20;
export const DEFAULT_EY_ESPRESSO = 19;
// Measured brews (with a TDS) needed before their average is used.
export const MIN_EY_BREWS = 2;

// TDS % a brew should read at this extraction: EY × dose / beverage, 0.01.
export function expectedTds(doseGrams: number | null, beverageGrams: number | null, eyPercent: number): number | null {
  if (doseGrams == null || beverageGrams == null || !(doseGrams > 0) || !(beverageGrams > 0) || !(eyPercent > 0)) return null;
  return Math.round(((eyPercent * doseGrams) / beverageGrams) * 100) / 100;
}

// °Brix that reads as this TDS on brixToTds' curve (it rises steadily, so
// bisection finds it), 0.1.
export function expectedBrix(tdsPercent: number | null): number | null {
  if (tdsPercent == null || !(tdsPercent > 0)) return null;
  const curve = (b: number) => (0.0036 * b + 0.7897) * b - 0.0071;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (curve(mid) < tdsPercent) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

// A past brew, as the list endpoint returns it (BrewLog), for its EY.
export interface EyBrew {
  recipeId: string | null;
  actualDoseGrams: number;
  actualWaterGrams: number | null;
  actualYieldGrams: number | null;
  tdsPercent: number | null;
  style: { brewsLike: RecipeStyle } | null;
  recipe: { methodKind: string; style: { brewsLike: RecipeStyle } | null } | null;
}

function averageEy(brews: readonly EyBrew[]): number | null {
  const eys = brews
    .map((b) =>
      extractionYield({
        tdsPercent: b.tdsPercent,
        doseGrams: b.actualDoseGrams,
        yieldGrams: b.actualYieldGrams,
        waterGrams: b.actualWaterGrams,
        style: b.style?.brewsLike ?? b.recipe?.style?.brewsLike ?? null,
      }),
    )
    .filter((ey): ey is number => ey !== null && ey > 0);
  if (eys.length < MIN_EY_BREWS) return null;
  return Math.round((eys.reduce((a, b) => a + b, 0) / eys.length) * 10) / 10;
}

// The EY to expect: your average for this recipe (at least MIN_EY_BREWS
// with a TDS), else for this kind of method, else the default.
export function expectedEy(brews: readonly EyBrew[], opts: { recipeId: string | null; methodKind: string | null; espresso: boolean }): number {
  const forRecipe = opts.recipeId ? averageEy(brews.filter((b) => b.recipeId === opts.recipeId)) : null;
  if (forRecipe !== null) return forRecipe;
  const forKind = opts.methodKind ? averageEy(brews.filter((b) => b.recipe?.methodKind === opts.methodKind)) : null;
  if (forKind !== null) return forKind;
  return opts.espresso ? DEFAULT_EY_ESPRESSO : DEFAULT_EY_FILTER;
}

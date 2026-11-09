// Sanity checks on a recipe's steps, for the AI's recipe proposals
// (docs/api/chat.md, "Proposals"): a proposal that fails one is kept, with
// the warnings shown on its card. Loose on purpose, so a recipe someone
// really brews (double blooms, short waits, a pressed OXO) never trips them.
import { WATER_STEP_TYPES, type MethodKind, type RecipeStepType } from "./schema.js";

export interface CheckedStep {
  stepType: RecipeStepType;
  durationSec: number | null;
  targetWaterGrams: number | null;
}
export interface CheckedRecipe {
  targetWaterGrams: number | null;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  steps: readonly CheckedStep[];
}

// A kettle pours roughly 3–8 g/s; past these it's a typo or an unbrewable plan.
export const POUR_RATE = { min: 1, max: 12 } as const; // g/s
// The last pour reaching the recipe's water, give or take.
export const WATER_TOLERANCE_G = 2;
// Steps ending this long before the window opens leave a gap nothing explains.
export const EARLY_END_SEC = 60;

const isWaterStep = (t: RecipeStepType): boolean => (WATER_STEP_TYPES as readonly string[]).includes(t);
const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const g = (n: number): string => String(Math.round(n * 10) / 10);

// When the brew steps end: their durations added up (prep is before the
// timer); null when one has none, so the end is open.
export function stepsEnd(steps: readonly CheckedStep[]): number | null {
  let total = 0;
  let any = false;
  for (const s of steps) {
    if (s.stepType === "prep") continue;
    if (s.durationSec === null) return null;
    total += s.durationSec;
    any = true;
  }
  return any ? total : null;
}

// Plain-English warnings, in step order; [] when it all holds up.
export function recipeStepWarnings(recipe: CheckedRecipe, kind: MethodKind): string[] {
  const warnings: string[] = [];
  const steps = recipe.steps;

  // Water: scale weights that only rise, a sensible pace, reaching the recipe's water.
  if (kind !== "espresso") {
    let reached = 0;
    let last: number | null = null;
    steps.forEach((s, i) => {
      if (s.targetWaterGrams === null || !isWaterStep(s.stepType)) return;
      const n = i + 1;
      if (s.targetWaterGrams < reached) {
        warnings.push(`Step ${n} goes back to ${g(s.targetWaterGrams)} g after ${g(reached)} g: water targets are scale weights, so they only rise.`);
      } else if (s.durationSec !== null && s.durationSec > 0) {
        const added = s.targetWaterGrams - reached;
        const rate = added / s.durationSec;
        if (added > 0 && rate > POUR_RATE.max) warnings.push(`Step ${n} pours ${g(added)} g in ${s.durationSec} s (${g(rate)} g/s), faster than a kettle pours.`);
        else if (added > 0 && rate < POUR_RATE.min) warnings.push(`Step ${n} pours ${g(added)} g over ${s.durationSec} s (${g(rate)} g/s), slower than a steady pour.`);
      }
      reached = Math.max(reached, s.targetWaterGrams);
      last = s.targetWaterGrams;
    });
    if (recipe.targetWaterGrams !== null && last !== null && Math.abs(last - recipe.targetWaterGrams) > WATER_TOLERANCE_G) {
      warnings.push(`The steps pour to ${g(last)} g, but the recipe's water is ${g(recipe.targetWaterGrams)} g.`);
    }
  }

  // Time: the steps ending inside the finish (or shot) window.
  const end = stepsEnd(steps);
  const { expectedFinishMinSec: min, expectedFinishMaxSec: max } = recipe;
  if (end !== null && min !== null && max !== null) {
    const window = `${mmss(min)}–${mmss(max)}`;
    if (end > max) warnings.push(`The steps end at ${mmss(end)}, after the target finish (${window}).`);
    else if (end < min - EARLY_END_SEC) warnings.push(`The steps end at ${mmss(end)}, well before the target finish (${window}).`);
  }
  return warnings;
}

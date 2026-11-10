// A long cold brew batch (cold brew, Kyoto drip) as stock (docs/backlog.md
// item 14): how much concentrate it made, what's left, and each serving's
// share of it. The share decides a serving's caffeine, so the yield should be
// weighed after straining; without it, it's estimated and shown with "≈".
import type { RoastLevel } from '../api/types';
import { brewerRetention, estimateYield, ratioWater, ROAST_LEVELS, type BrewerRetentionInput } from './scale';

export interface BatchYield {
  grams: number;
  estimated: boolean;
}

export interface BatchLog {
  actualDoseGrams: number;
  actualWaterGrams: number | null;
  actualIceGrams: number | null;
  actualYieldGrams: number | null;
}

// The measured yield, else water − retention × dose, with the brewer's
// retention (typed, else learned from its measured brews), else the roast
// level's (the bean's, else the workspace's recipe roast level). null for a
// brew with no water (a shot isn't a batch).
export function batchYield(
  log: BatchLog,
  roast: { roastLevel: RoastLevel | null; recipeRoastLevel: RoastLevel },
  brewer: BrewerRetentionInput | null = null,
): BatchYield | null {
  if (log.actualYieldGrams !== null) return { grams: log.actualYieldGrams, estimated: false };
  if (log.actualWaterGrams === null) return null;
  const water = ratioWater(log.actualWaterGrams, log.actualIceGrams);
  const retention = brewerRetention(brewer)?.retention ?? ROAST_LEVELS[roast.roastLevel ?? roast.recipeRoastLevel].retention;
  return { grams: estimateYield(log.actualDoseGrams, water, retention), estimated: true };
}

// A serving's share of the batch: its concentrate over the larger of the
// yield and everything poured, so an under-estimated yield never makes the
// shares add up to more than the whole batch.
export function servingShare(concentrateGrams: number, yieldGrams: number, totalPouredGrams: number): number {
  const whole = Math.max(yieldGrams, totalPouredGrams);
  return whole > 0 ? concentrateGrams / whole : 0;
}

// What's left, never below zero.
export function stockLeft(yieldGrams: number, totalPouredGrams: number): number {
  return Math.max(0, yieldGrams - totalPouredGrams);
}

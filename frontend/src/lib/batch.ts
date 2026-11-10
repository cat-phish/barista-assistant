// A long cold brew batch (cold brew, Kyoto drip) as stock (docs/backlog.md
// item 14): how much concentrate it made, what's left, and each serving's
// share of it. The share decides a serving's caffeine, so the yield should be
// weighed after straining; without it, it's estimated and shown with "≈".
import type { BrewLog, RoastLevel } from '../api/types';
import { isLongStyle } from './coldBrew';
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

// What's in the jar: the batch's yield plus any water added to the whole
// batch (jarWaterGrams, docs/api/brew-servings.md §6c).
export function jarGrams(yieldGrams: number, jarWaterGrams: number | null): number {
  return yieldGrams + (jarWaterGrams ?? 0);
}

// The jar's own dilution, water per gram of concentrate (0 when kept as concentrate).
export function jarRatio(yieldGrams: number, jarWaterGrams: number | null): number {
  return yieldGrams > 0 && jarWaterGrams ? jarWaterGrams / yieldGrams : 0;
}

// A glass's strength as drunk, 1 : this: what was poured from a jar diluted
// 1 : jar, topped up with glassWater. null when it's all concentrate.
export function overallRatio(pouredGrams: number, glassWaterGrams: number | null, jar: number): number | null {
  if (!(pouredGrams > 0)) return null;
  const r = jar + ((glassWaterGrams ?? 0) * (1 + jar)) / pouredGrams;
  return r > 0 ? Math.round(r * 100) / 100 : null;
}

// A batch's stock for a list (the Journal badge, the Brew page's fridge
// card): the jar minus what's poured. The estimate uses the roast level
// unless a brewer's retention is given (no brewer lookup per card). null for
// a brew that isn't a batch, or is still steeping.
export interface BatchStock {
  leftGrams: number;
  estimated: boolean;
  finished: boolean;
}
export type BatchStockLog = BatchLog & Pick<BrewLog, 'style' | 'steeping' | 'servingCount' | 'pouredGrams' | 'jarWaterGrams' | 'batchFinishedAt'> & { bean: { roastLevel: RoastLevel | null } };
export function batchStock(log: BatchStockLog, recipeRoastLevel: RoastLevel, brewer: BrewerRetentionInput | null = null): BatchStock | null {
  if (log.steeping || !(isLongStyle(log.style?.brewsLike) || log.servingCount > 0)) return null;
  const y = batchYield(log, { roastLevel: log.bean.roastLevel, recipeRoastLevel }, brewer);
  if (!y) return null;
  return { leftGrams: stockLeft(jarGrams(y.grams, log.jarWaterGrams), log.pouredGrams), estimated: y.estimated, finished: log.batchFinishedAt !== null };
}

// "≈ 110 g left", "110 g left", or "Finished".
export function stockText(s: BatchStock): string {
  if (s.finished) return 'Finished';
  return `${s.estimated ? '≈ ' : ''}${Number(s.leftGrams.toFixed(1))} g left`;
}

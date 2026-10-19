// Turns an AI analysis into starting parameters for the next brew
// (docs/api_spec.md §8: deltas are relative to the *analyzed* brew).
import type { GrindDelta, Recipe, Suggestions } from '../api/types';

export const GRIND_LABELS: Record<GrindDelta, string> = {
  much_finer: 'Grind much finer',
  finer: 'Grind finer',
  no_change: 'Keep the grind',
  coarser: 'Grind coarser',
  much_coarser: 'Grind much coarser',
};

export interface StartingParameters {
  tempC: number | null; // analyzed brew's temp (or the recipe's) + suggested change
  grindBase: string | null; // the grind it was analyzed at; direction in grindAdvice
  grinder: { id: string; name: string } | null; // grinder of the analyzed brew
  grindAdvice: string;
  tempAdvice: string;
  reasoning: string;
  basedOn: { timestamp: string; isLatestBrew: boolean };
}

export function startingParameters(s: Suggestions, recipe: Recipe | null): StartingParameters | null {
  const analysis = s.latestAnalysis;
  const brew = s.analyzedBrew;
  if (!analysis || !brew) return null;

  const baseTemp = brew.actualTempC ?? recipe?.targetTempC ?? null;
  const delta = analysis.suggestedTempDelta;
  const tempC = baseTemp === null ? null : Math.min(100, Math.max(0, Math.round((baseTemp + delta) * 10) / 10));
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';

  return {
    tempC,
    // Whether "finer" means more or fewer clicks depends on the grinder, so
    // the setting itself is left for the person to adjust.
    grindBase: brew.actualGrindSetting ?? recipe?.targetGrindSetting ?? null,
    grinder: brew.grinder,
    grindAdvice: GRIND_LABELS[analysis.suggestedGrindDelta],
    tempAdvice: delta === 0 ? 'Keep the temperature' : `${sign}${Math.abs(delta)} °C`,
    reasoning: analysis.reasoning,
    basedOn: { timestamp: brew.timestamp, isLatestBrew: s.recentBrews[0]?.id === brew.id },
  };
}

// Does the suggestion's grind advice apply to the grinder being used now?
// ('' = no grinder chosen, which matches a brew without one.)
export function suggestionFitsGrinder(p: StartingParameters, grinderId: string): boolean {
  return (p.grinder?.id ?? '') === grinderId;
}

export type GrindSource = 'last' | 'suggestion' | 'none';

// What to pre-fill the grind setting with when starting a brew:
//   1. the last setting used with this grinder and recipe,
//   2. else the analyzed brew's setting, if that was on this grinder,
//   3. else nothing (recipes are grinder-neutral; their target is only a hint).
export function chooseGrind(opts: {
  lastSetting: string | null;
  suggestion: StartingParameters | null;
  grinderId: string;
}): { value: string; source: GrindSource } {
  if (opts.lastSetting) return { value: opts.lastSetting, source: 'last' };
  const s = opts.suggestion;
  if (s?.grindBase && suggestionFitsGrinder(s, opts.grinderId)) return { value: s.grindBase, source: 'suggestion' };
  return { value: '', source: 'none' };
}

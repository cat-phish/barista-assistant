// Turns an AI analysis into starting parameters for the next brew
// (docs/api/analysis.md §8: deltas are relative to the *analyzed* brew).
import type { GrindDelta, Recipe, Suggestions } from '../api/types';
import { formatGrind } from './format';

export const GRIND_LABELS: Record<GrindDelta, string> = {
  much_finer: 'Grind much finer',
  finer: 'Grind finer',
  no_change: 'Keep the grind',
  coarser: 'Grind coarser',
  much_coarser: 'Grind much coarser',
};

export const CONFIDENCE_LABELS = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const;

// A suggested grinder speed change as advice, or null for none.
export function rpmAdvice(delta: number | null): string | null {
  if (!delta) return null;
  return `${delta > 0 ? 'Raise' : 'Lower'} the grinder speed by ${Math.abs(delta)} RPM`;
}

export interface StartingParameters {
  tempC: number | null; // analyzed brew's temp (or the recipe's) + suggested change
  tempDeltaC: number; // the suggested change (show with formatTempChange)
  grindBase: number | null; // the grind it was analyzed at; direction in grindAdvice
  grinder: { id: string; name: string } | null; // grinder of the analyzed brew
  grindAdvice: string;
  reasoning: string;
  nextStep: string | null; // newer analyses: the one thing to do next
  confidence: 'low' | 'medium' | 'high' | null;
  rpmDelta: number | null; // variable-speed grinders only
  basedOn: { timestamp: string; isLatestBrew: boolean };
}

export function startingParameters(s: Suggestions, recipe: Recipe | null): StartingParameters | null {
  const analysis = s.latestAnalysis;
  const brew = s.analyzedBrew;
  if (!analysis || !brew) return null;

  const baseTemp = brew.actualTempC ?? recipe?.targetTempC ?? null;
  const delta = analysis.suggestedTempDelta;
  const tempC = baseTemp === null ? null : Math.min(100, Math.max(0, Math.round((baseTemp + delta) * 10) / 10));

  return {
    tempC,
    // Whether "finer" means more or fewer clicks depends on the grinder, so
    // the setting itself is left for the person to adjust.
    grindBase: brew.actualGrindSetting,
    grinder: brew.grinder,
    grindAdvice: GRIND_LABELS[analysis.suggestedGrindDelta],
    tempDeltaC: delta,
    reasoning: analysis.reasoning,
    nextStep: analysis.nextStep,
    confidence: analysis.confidence,
    rpmDelta: analysis.suggestedRpmDelta,
    basedOn: { timestamp: brew.timestamp, isLatestBrew: s.recentBrews[0]?.id === brew.id },
  };
}

// Does the suggestion's grind advice apply to the grinder being used now?
// ('' = no grinder chosen, which matches a brew without one.)
export function suggestionFitsGrinder(p: StartingParameters, grinderId: string): boolean {
  return (p.grinder?.id ?? '') === grinderId;
}

// 'repeat': taken from the brew being repeated (lib/repeatBrew.ts).
export type GrindSource = 'last' | 'suggestion' | 'recipe' | 'repeat' | 'none';

// What to pre-fill the grind setting with when starting a brew:
//   1. the last setting used with this grinder and recipe,
//   2. else the analyzed brew's setting, if that was on this grinder,
//   3. else the recipe's approximate starting point for this grinder,
//   4. else nothing.
// value is the text for the grind box.
export function chooseGrind(opts: {
  lastSetting: number | null;
  suggestion: StartingParameters | null;
  grinderId: string;
  recipe?: Pick<Recipe, 'grindSettings'> | null;
}): { value: string; source: GrindSource } {
  if (opts.lastSetting !== null) return { value: formatGrind(opts.lastSetting), source: 'last' };
  const s = opts.suggestion;
  if (s && s.grindBase !== null && suggestionFitsGrinder(s, opts.grinderId)) return { value: formatGrind(s.grindBase), source: 'suggestion' };
  const start = opts.grinderId ? opts.recipe?.grindSettings.find((g) => g.grinderId === opts.grinderId) : undefined;
  if (start) return { value: formatGrind(start.setting), source: 'recipe' };
  return { value: '', source: 'none' };
}

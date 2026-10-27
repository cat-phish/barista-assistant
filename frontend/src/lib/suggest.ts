// AI suggestions as the app shows them: an analysis's changes (AnalysisCard,
// docs/api/analysis.md §8), and "Suggest parameters"' starting values for the
// brew being set up (§8b).
import type { GrindDelta, ParameterSuggestion, Recipe, SuggestSource } from '../api/types';
import { formatGrind } from './format';
import type { ScaleField } from './scale';

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

// A suggested change in grams as advice: "Dose +0.5 g", or null for none.
export function gramsAdvice(label: string, delta: number | null): string | null {
  if (!delta) return null;
  return `${label} ${delta > 0 ? '+' : '−'}${Math.abs(delta)} g`;
}

// Which earlier brews "Suggest parameters" sends, as the dropdown says it.
export const SUGGEST_SOURCE_LABELS: Record<SuggestSource, string> = {
  bean: 'This bean',
  beanRecipe: 'This bean and recipe',
  beanBrewer: 'This bean and brewer',
  brewer: 'This brewer, any bean',
  recipe: 'This recipe, any bean',
};
// What a source needs chosen first to pick brews by.
export function sourceNeeds(source: SuggestSource): 'recipe' | 'brewer' | null {
  if (source === 'beanRecipe' || source === 'recipe') return 'recipe';
  if (source === 'beanBrewer' || source === 'brewer') return 'brewer';
  return null;
}

// A finished suggestion's values, for the brew being set up.
export interface StartingParameters {
  grinderId: string | null; // the grinder the setting is for
  grindSetting: number | null;
  grindRpm: number | null;
  tempC: number | null;
  ratio: number | null; // for the batch as it is; null: keep its ratio
  reasoning: string;
  nextStep: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  brewCount: number; // earlier brews it was based on
  source: SuggestSource;
}

export function startingParameters(s: ParameterSuggestion): StartingParameters | null {
  if (s.status !== 'done' || s.reasoning === null) return null;
  return {
    grinderId: s.grinderId,
    grindSetting: s.grindSetting,
    grindRpm: s.grindRpm,
    tempC: s.tempC,
    ratio: s.ratio,
    reasoning: s.reasoning,
    nextStep: s.nextStep,
    confidence: s.confidence,
    brewCount: s.brewCount ?? 0,
    source: s.source,
  };
}

// What a suggested ratio keeps as it is (docs/api/analysis.md §8b), the rest
// of the batch moving around it: espresso keeps the dose, which the basket
// fixes, so the shot weight moves. A filter batch keeps what was typed last;
// untouched, the recipe's water, so the cup stays about the same size and
// the dose moves.
export function heldForRatio(o: { espresso: boolean; scaled: boolean; lead: ScaleField }): ScaleField {
  if (o.espresso) return 'dose';
  if (!o.scaled && o.lead === 'dose') return 'water';
  return o.lead;
}

// Does the suggested setting apply to the grinder being used now?
// ('' = no grinder chosen: a suggestion without one has no setting anyway.)
export function suggestionFitsGrinder(p: StartingParameters, grinderId: string): boolean {
  return (p.grinderId ?? '') === grinderId;
}

// 'repeat': taken from the brew being repeated (lib/repeatBrew.ts).
export type GrindSource = 'last' | 'suggestion' | 'recipe' | 'repeat' | 'none';

// What to pre-fill the grind setting with when starting a brew:
//   1. the suggested setting, when it was asked for this grinder,
//   2. else the last setting used with this grinder and recipe,
//   3. else the recipe's approximate starting point for this grinder,
//   4. else nothing.
// value is the text for the grind box.
export function chooseGrind(opts: {
  lastSetting: number | null;
  suggestion: StartingParameters | null;
  grinderId: string;
  recipe?: Pick<Recipe, 'grindSettings'> | null;
}): { value: string; source: GrindSource } {
  const s = opts.suggestion;
  if (s && s.grindSetting !== null && opts.grinderId && suggestionFitsGrinder(s, opts.grinderId)) return { value: formatGrind(s.grindSetting), source: 'suggestion' };
  if (opts.lastSetting !== null) return { value: formatGrind(opts.lastSetting), source: 'last' };
  const start = opts.grinderId ? opts.recipe?.grindSettings.find((g) => g.grinderId === opts.grinderId) : undefined;
  if (start) return { value: formatGrind(start.setting), source: 'recipe' };
  return { value: '', source: 'none' };
}

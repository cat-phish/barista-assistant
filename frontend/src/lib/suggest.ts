// AI suggestions as the app shows them: an analysis's changes (AnalysisCard,
// docs/api/analysis.md §8), and "Suggest parameters"' starting values for the
// brew being set up (§8b).
import { SUGGEST_SOURCES, type AlternativeKind, type GrindDelta, type ParameterSuggestion, type Recipe, type SuggestedAlternative, type SuggestedRoute, type SuggestSource } from '../api/types';
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
// A bag is this exact bean; a bean is every bag of the coffee (roaster and
// name), whatever its roast date or batch.
export const SUGGEST_SOURCE_LABELS: Record<SuggestSource, string> = {
  bag: 'This bag',
  bagRecipe: 'This bag and recipe',
  bagBrewer: 'This bag and brewer',
  bean: 'This bean',
  beanRecipe: 'This bean and recipe',
  beanBrewer: 'This bean and brewer',
  brewer: 'This brewer, any bean',
  recipe: 'This recipe, any bean',
};
// What else it can suggest, as the checkboxes say it.
export const ALTERNATIVE_LABELS: Record<AlternativeKind, string> = { recipe: 'Another recipe', brewer: 'Another brewer', bean: 'Another bean' };
// What a source needs chosen first to pick brews by.
export function sourceNeeds(source: SuggestSource): 'recipe' | 'brewer' | null {
  if (source === 'bagRecipe' || source === 'beanRecipe' || source === 'recipe') return 'recipe';
  if (source === 'bagBrewer' || source === 'beanBrewer' || source === 'brewer') return 'brewer';
  return null;
}
// The source last picked on this device. It's kept as compareWith; an older
// suggestSource meant the exact bag by its bean* names, so it reads as bag*.
const OLD_SOURCES: Partial<Record<string, SuggestSource>> = { bean: 'bag', beanRecipe: 'bagRecipe', beanBrewer: 'bagBrewer', brewer: 'brewer', recipe: 'recipe' };
export function rememberedSource(compareWith: string | null, oldSuggestSource: string | null): SuggestSource | null {
  if (compareWith !== null) return SUGGEST_SOURCES.find((x) => x === compareWith) ?? null;
  return oldSuggestSource === null ? null : (OLD_SOURCES[oldSuggestSource] ?? null);
}

// One route's values (docs/api/analysis.md §8b).
export type RouteValues = Pick<SuggestedRoute, 'grindSetting' | 'grindRpm' | 'tempC' | 'ratio'>;

// A finished suggestion, for the brew being set up: its routes, and the
// first one's values as its own.
export interface StartingParameters extends RouteValues {
  id: string;
  grinderId: string | null; // the grinder the setting is for
  reasoning: string;
  nextStep: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  brewCount: number; // earlier brews it was based on
  source: SuggestSource;
  routes: SuggestedRoute[]; // at least one
  alternatives: SuggestedAlternative[];
}

export function startingParameters(s: ParameterSuggestion): StartingParameters | null {
  if (s.status !== 'done' || s.reasoning === null) return null;
  const values = { grindSetting: s.grindSetting, grindRpm: s.grindRpm, tempC: s.tempC, ratio: s.ratio };
  return {
    id: s.id,
    grinderId: s.grinderId,
    ...values,
    reasoning: s.reasoning,
    nextStep: s.nextStep,
    confidence: s.confidence,
    brewCount: s.brewCount ?? 0,
    source: s.source,
    // One from before routes: its values are the only route.
    routes: s.routes?.length ? s.routes : [{ label: 'Suggested', why: '', findings: [], ...values }],
    alternatives: s.alternatives ?? [],
  };
}

// The suggestion with one route's values in place of the first's.
export function withRoute(p: StartingParameters, route: number): StartingParameters {
  const r = p.routes[route];
  return r ? { ...p, grindSetting: r.grindSetting, grindRpm: r.grindRpm, tempC: r.tempC, ratio: r.ratio } : p;
}

// What each research finding is called, for "Follows …" on a route: the same
// keys as @barista/shared/research (lib/suggest.test.ts checks). A key not
// here (a newer worker's) is left out.
export const RESEARCH_TITLES: Record<string, string> = {
  leverOrder: 'Which lever to move',
  tasteNotTemp: 'Taste follows strength and extraction, not temperature',
  sourStrong: 'Sour can mean too strong',
  immersionRatio: 'In immersion, the ratio sets the cup',
  ownPattern: 'No universal ideal',
  kettleNotSlurry: "The kettle isn't the slurry",
  roastTemp: 'Roast sets the temperature band',
  finesFlow: 'Fines and agitation set the drawdown',
  bloom: 'Bloom size and length',
  espressoFinest: "Finer isn't always more extraction",
  coldBeansFiner: 'Frozen beans and dark roasts grind finer',
  alkalinity: 'Alkalinity matters more than hardness',
  degassing: 'Fresh beans and rest',
  naturalsWeightLoss: 'Naturals lose more weight',
  coldBloom: 'Cold or cool bloom',
  firstPours: 'First pours and pour count',
};
export function findingTitles(keys: readonly string[]): string[] {
  return keys.flatMap((k) => (RESEARCH_TITLES[k] ? [RESEARCH_TITLES[k]] : k.startsWith('own.') ? ['Your research'] : []));
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
export type GrindSource = 'last' | 'suggestion' | 'recipe' | 'repeat' | 'proposal' | 'none';

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

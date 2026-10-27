import { describe, expect, it } from 'vitest';
import { SUGGEST_SOURCES, type ParameterSuggestion, type Recipe } from '../api/types';
import { chooseGrind, gramsAdvice, heldForRatio, rpmAdvice, SUGGEST_SOURCE_LABELS, sourceNeeds, startingParameters, suggestionFitsGrinder } from './suggest';

const recipe = { targetTempC: 94, grindSettings: [{ grinderId: 'c40', grinderName: 'Comandante C40', setting: 19 }] } as unknown as Recipe;
const suggestion = (over: Partial<ParameterSuggestion> = {}): ParameterSuggestion => ({
  id: 's', beanId: 'bean', recipeId: 'r', brewerId: 'v60', grinderId: 'c40', source: 'beanRecipe', maxBrews: 5, requestedBy: 'u', note: null, brewCount: 3, batchDoseGrams: 15, batchWaterGrams: 250, batchIceGrams: null, batchYieldGrams: null, status: 'done', error: null,
  reasoning: 'The last cup was sour.', nextStep: 'Watch the drawdown.', confidence: 'medium', grindSetting: 22, grindRpm: null, tempC: 95, ratio: 16,
  model: 'm', promptVersion: 'v', hasRequest: false, createdAt: '', completedAt: '', ...over,
});

// The shared list, read as text: the frontend doesn't import @barista/shared.
const shared = Object.values(import.meta.glob('../../../shared/src/schema.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const sharedSources = JSON.parse((/SUGGEST_SOURCES = (\[[^\]]*\])/.exec(shared)?.[1] ?? '[]')) as string[];

describe('Suggest parameters sources (docs/api/analysis.md §8b)', () => {
  it("match the worker's, each with a label", () => {
    expect([...SUGGEST_SOURCES]).toEqual(sharedSources);
    expect(Object.keys(SUGGEST_SOURCE_LABELS)).toEqual(sharedSources);
  });
  it('say what has to be chosen first', () => {
    expect(SUGGEST_SOURCES.map(sourceNeeds)).toEqual([null, 'recipe', 'brewer', 'brewer', 'recipe']);
  });
});

describe('startingParameters', () => {
  it("is the suggestion's values once it's done", () => {
    expect(startingParameters(suggestion())).toMatchObject({ grinderId: 'c40', grindSetting: 22, tempC: 95, ratio: 16, nextStep: 'Watch the drawdown.', confidence: 'medium', brewCount: 3, source: 'beanRecipe' });
  });
  it('is nothing while pending or after it failed', () => {
    expect(startingParameters(suggestion({ status: 'pending', reasoning: null }))).toBeNull();
    expect(startingParameters(suggestion({ status: 'failed', reasoning: null }))).toBeNull();
  });
  it('fits only the grinder it was asked for', () => {
    const p = startingParameters(suggestion())!;
    expect(suggestionFitsGrinder(p, 'c40')).toBe(true);
    expect(suggestionFitsGrinder(p, 'ode')).toBe(false);
    expect(suggestionFitsGrinder(startingParameters(suggestion({ grinderId: null }))!, '')).toBe(true);
  });
});

describe('heldForRatio: a suggested ratio keeps the batch size', () => {
  it('espresso keeps the dose, whatever was typed', () => {
    expect(heldForRatio({ espresso: true, scaled: true, lead: 'yield' })).toBe('dose');
    expect(heldForRatio({ espresso: true, scaled: false, lead: 'dose' })).toBe('dose');
  });
  it("an untouched filter batch keeps the recipe's water, so the cup stays its size", () => {
    expect(heldForRatio({ espresso: false, scaled: false, lead: 'dose' })).toBe('water');
  });
  it('a filter batch keeps what was typed last: a dose, the water (or a drink size), a cup', () => {
    expect(heldForRatio({ espresso: false, scaled: true, lead: 'dose' })).toBe('dose');
    expect(heldForRatio({ espresso: false, scaled: true, lead: 'water' })).toBe('water');
    expect(heldForRatio({ espresso: false, scaled: true, lead: 'yieldOz' })).toBe('yieldOz');
  });
});

describe('analysis advice', () => {
  it('words a change in grams', () => {
    expect(gramsAdvice('Dose', 0.5)).toBe('Dose +0.5 g');
    expect(gramsAdvice('Shot weight', -3)).toBe('Shot weight −3 g');
    expect(gramsAdvice('Dose', null)).toBeNull();
  });
  it('words a speed change, and nothing for none', () => {
    expect(rpmAdvice(150)).toBe('Raise the grinder speed by 150 RPM');
    expect(rpmAdvice(-50)).toBe('Lower the grinder speed by 50 RPM');
    expect(rpmAdvice(0)).toBeNull();
    expect(rpmAdvice(null)).toBeNull();
  });
});

describe('chooseGrind', () => {
  const params = startingParameters(suggestion())!; // 22 on the C40
  it('a suggestion asked for this grinder comes first', () => {
    expect(chooseGrind({ lastSetting: 20, suggestion: params, grinderId: 'c40', recipe })).toEqual({ value: '22', source: 'suggestion' });
  });
  it("then the last setting, when the suggestion is for another grinder or has none", () => {
    expect(chooseGrind({ lastSetting: 20, suggestion: params, grinderId: 'ode' })).toEqual({ value: '20', source: 'last' });
    const none = startingParameters(suggestion({ grindSetting: null }))!;
    expect(chooseGrind({ lastSetting: 20, suggestion: none, grinderId: 'c40' })).toEqual({ value: '20', source: 'last' });
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: '' })).toEqual({ value: '', source: 'none' });
  });
  it("then the recipe's approximate starting point for this grinder, else nothing", () => {
    expect(chooseGrind({ lastSetting: null, suggestion: null, grinderId: 'c40', recipe })).toEqual({ value: '19', source: 'recipe' });
    expect(chooseGrind({ lastSetting: null, suggestion: null, grinderId: 'ode', recipe })).toEqual({ value: '', source: 'none' });
    expect(chooseGrind({ lastSetting: null, suggestion: null, grinderId: '', recipe })).toEqual({ value: '', source: 'none' });
  });
  it('keeps a setting of 0 and decimals', () => {
    expect(chooseGrind({ lastSetting: 0, suggestion: null, grinderId: 'c40' })).toEqual({ value: '0', source: 'last' });
    expect(chooseGrind({ lastSetting: 4.25, suggestion: null, grinderId: 'c40' }).value).toBe('4.25');
  });
});

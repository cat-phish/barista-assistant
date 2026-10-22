import { describe, expect, it } from 'vitest';
import type { BrewLog, Recipe, Suggestions } from '../api/types';
import { chooseGrind, startingParameters, suggestionFitsGrinder } from './suggest';

const brew = (over: Partial<BrewLog>): BrewLog => ({
  id: 'b1', workspaceId: 'w', userId: 'u', beanId: 'bean', recipeId: null, timestamp: '2026-10-18T08:00:00.000Z', utcOffsetMinutes: null,
  actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: null, actualTempC: 93, actualGrindSetting: '22 clicks', actualTimeSec: 125,
  rating: 2, tastingNotes: null, drinkRating: null, drinkTastingNotes: null, bean: { id: 'bean', roasterName: 'R', beanName: 'B' }, recipe: null, brewedBy: null,
  grinderId: 'c40', grinder: { id: 'c40', name: 'Comandante C40' }, brewerId: null, brewer: null, drinkId: null, drink: null, servingSize: null, servingUnit: null, marks: [], ...over,
});
const recipe = { targetTempC: 94, grindSettings: [{ grinderId: 'c40', grinderName: 'Comandante C40', setting: '19' }] } as unknown as Recipe;
const suggestions = (over: Partial<Suggestions> = {}): Suggestions => ({
  latestAnalysis: { id: 'a', brewLogId: 'b1', reasoning: 'Under-extracted.', suggestedGrindDelta: 'finer', suggestedTempDelta: 1, createdAt: '' },
  analyzedBrew: brew({}),
  recentBrews: [brew({})],
  ...over,
});

describe('startingParameters', () => {
  it('applies the temp change to the analyzed brew and keeps its grind as the base', () => {
    expect(startingParameters(suggestions(), recipe)).toMatchObject({
      tempC: 94, grindBase: '22 clicks', grindAdvice: 'Grind finer', tempAdvice: '+1 °C', reasoning: 'Under-extracted.',
      basedOn: { isLatestBrew: true },
    });
  });
  it("falls back to the recipe's temp when the analyzed brew has none; grind base stays the brew's own", () => {
    const s = suggestions({ analyzedBrew: brew({ actualTempC: null, actualGrindSetting: null }) });
    expect(startingParameters(s, recipe)).toMatchObject({ tempC: 95, grindBase: null });
  });
  it('rounds and clamps the temperature', () => {
    const s = suggestions({ latestAnalysis: { ...suggestions().latestAnalysis!, suggestedTempDelta: 8.5 }, analyzedBrew: brew({ actualTempC: 96.2 }) });
    expect(startingParameters(s, null)?.tempC).toBe(100);
    const down = suggestions({ latestAnalysis: { ...suggestions().latestAnalysis!, suggestedTempDelta: -1.5 } });
    expect(startingParameters(down, null)).toMatchObject({ tempC: 91.5, tempAdvice: '−1.5 °C' });
  });
  it('flags when newer brews exist than the analyzed one', () => {
    const s = suggestions({ recentBrews: [brew({ id: 'newer' }), brew({})] });
    expect(startingParameters(s, null)?.basedOn.isLatestBrew).toBe(false);
  });
  it('returns null without an analysis', () => {
    expect(startingParameters(suggestions({ latestAnalysis: null, analyzedBrew: null }), recipe)).toBeNull();
  });
});

describe('chooseGrind', () => {
  const params = startingParameters(suggestions(), recipe)!; // analyzed on c40 at "22 clicks"
  it('prefers the last setting for this grinder + recipe', () => {
    expect(chooseGrind({ lastSetting: '20', suggestion: params, grinderId: 'c40' })).toEqual({ value: '20', source: 'last' });
  });
  it("falls back to the suggestion's base only on the same grinder", () => {
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: 'c40' })).toEqual({ value: '22 clicks', source: 'suggestion' });
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: 'ode' })).toEqual({ value: '', source: 'none' });
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: '' })).toEqual({ value: '', source: 'none' });
  });
  it('a suggestion from a brew without a grinder fits "no grinder chosen"', () => {
    const noGrinder = startingParameters(suggestions({ analyzedBrew: brew({ grinderId: null, grinder: null }) }), null)!;
    expect(suggestionFitsGrinder(noGrinder, '')).toBe(true);
    expect(suggestionFitsGrinder(noGrinder, 'c40')).toBe(false);
  });
  it("then the recipe's approximate starting point for this grinder, else nothing", () => {
    expect(chooseGrind({ lastSetting: null, suggestion: null, grinderId: 'c40', recipe })).toEqual({ value: '19', source: 'recipe' });
    expect(chooseGrind({ lastSetting: null, suggestion: null, grinderId: 'ode', recipe })).toEqual({ value: '', source: 'none' });
    expect(chooseGrind({ lastSetting: null, suggestion: null, grinderId: '', recipe })).toEqual({ value: '', source: 'none' });
  });
  it('a real setting beats the recipe starting point', () => {
    expect(chooseGrind({ lastSetting: '21', suggestion: null, grinderId: 'c40', recipe })).toEqual({ value: '21', source: 'last' });
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: 'c40', recipe }).source).toBe('suggestion');
  });
});

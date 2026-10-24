import { describe, expect, it } from 'vitest';
import type { BrewLog, Recipe, Suggestions } from '../api/types';
import { chooseGrind, gramsAdvice, rpmAdvice, startingParameters, suggestionFitsGrinder } from './suggest';

const brew = (over: Partial<BrewLog>): BrewLog => ({
  id: 'b1', workspaceId: 'w', userId: 'u', beanId: 'bean', recipeId: null, timestamp: '2026-10-18T08:00:00.000Z', utcOffsetMinutes: null,
  actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: null, tdsPercent: null, actualTempC: 93, actualGrindSetting: 22, grindRpm: null, beanWeightInGrams: null, groundWeightOutGrams: null, steeping: false, steepTemp: null, dilutionRatio: null, dilutedWith: null, steepMinHours: null, steepMaxHours: null, expectedFinishMinSec: null, expectedFinishMaxSec: null, actualTimeSec: 125,
  rating: 2, tastingNotes: null, drinkRating: null, drinkTastingNotes: null, bean: { id: 'bean', roasterName: 'R', beanName: 'B', batchNumber: null }, recipe: null, brewedBy: null, analyzed: false, analysisDueAt: null, analysisError: null,
  grinderId: 'c40', grinder: { id: 'c40', name: 'Comandante C40' }, waterProfileId: null, waterProfile: null, brewerId: null, brewer: null, drinkId: null, drink: null, servingSize: null, servingUnit: null, marks: [], tools: [], problems: [], ...over,
});
const recipe = { targetTempC: 94, grindSettings: [{ grinderId: 'c40', grinderName: 'Comandante C40', setting: 19 }] } as unknown as Recipe;
const suggestions = (over: Partial<Suggestions> = {}): Suggestions => ({
  latestAnalysis: { id: 'a', brewLogId: 'b1', reasoning: 'Under-extracted.', suggestedGrindDelta: 'finer', suggestedTempDelta: 1, nextStep: null, confidence: null, suggestedRpmDelta: null, suggestedDoseDelta: null, suggestedYieldDelta: null, model: null, promptVersion: null, helpful: null, ratedAt: null, createdAt: '' },
  analyzedBrew: brew({}),
  recentBrews: [brew({})],
  ...over,
});

describe('startingParameters', () => {
  it('applies the temp change to the analyzed brew and keeps its grind as the base', () => {
    expect(startingParameters(suggestions(), recipe)).toMatchObject({
      tempC: 94, grindBase: 22, grindAdvice: 'Grind finer', tempDeltaC: 1, reasoning: 'Under-extracted.',
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
    expect(startingParameters(down, null)).toMatchObject({ tempC: 91.5, tempDeltaC: -1.5 });
  });
  it('flags when newer brews exist than the analyzed one', () => {
    const s = suggestions({ recentBrews: [brew({ id: 'newer' }), brew({})] });
    expect(startingParameters(s, null)?.basedOn.isLatestBrew).toBe(false);
  });
  it('returns null without an analysis', () => {
    expect(startingParameters(suggestions({ latestAnalysis: null, analyzedBrew: null }), recipe)).toBeNull();
  });
  it('passes on the next step, confidence and speed change', () => {
    const s = suggestions({ latestAnalysis: { ...suggestions().latestAnalysis!, nextStep: 'Grind 2 clicks finer.', confidence: 'medium', suggestedRpmDelta: -100 } });
    expect(startingParameters(s, null)).toMatchObject({ nextStep: 'Grind 2 clicks finer.', confidence: 'medium', rpmDelta: -100 });
  });
});

describe('espresso dose and shot weight', () => {
  const espresso = (doseDelta: number | null, yieldDelta: number | null, shot: Partial<BrewLog> = {}) =>
    startingParameters(
      suggestions({
        latestAnalysis: { ...suggestions().latestAnalysis!, suggestedDoseDelta: doseDelta, suggestedYieldDelta: yieldDelta },
        analyzedBrew: brew({ actualDoseGrams: 18, actualWaterGrams: null, actualYieldGrams: 36, ...shot }),
      }),
      null,
    );
  it('applies the changes to the analyzed shot', () => {
    expect(espresso(0.5, 4)?.shot).toEqual({ doseG: 18.5, yieldG: 40, doseDeltaG: 0.5, yieldDeltaG: 4 });
    expect(espresso(null, -3)?.shot).toEqual({ doseG: 18, yieldG: 33, doseDeltaG: null, yieldDeltaG: -3 });
  });
  it('has no shot change without one, and no weight when the shot was never weighed', () => {
    expect(espresso(null, null)?.shot).toBeNull();
    expect(espresso(1, 4, { actualYieldGrams: null })?.shot).toEqual({ doseG: 19, yieldG: null, doseDeltaG: 1, yieldDeltaG: 4 });
  });
  it('words a change in grams', () => {
    expect(gramsAdvice('Dose', 0.5)).toBe('Dose +0.5 g');
    expect(gramsAdvice('Shot weight', -3)).toBe('Shot weight −3 g');
    expect(gramsAdvice('Dose', null)).toBeNull();
  });
});

describe('rpmAdvice', () => {
  it('words a speed change, and nothing for none', () => {
    expect(rpmAdvice(150)).toBe('Raise the grinder speed by 150 RPM');
    expect(rpmAdvice(-50)).toBe('Lower the grinder speed by 50 RPM');
    expect(rpmAdvice(0)).toBeNull();
    expect(rpmAdvice(null)).toBeNull();
  });
});

describe('chooseGrind', () => {
  const params = startingParameters(suggestions(), recipe)!; // analyzed on c40 at 22
  it('prefers the last setting for this grinder + recipe', () => {
    expect(chooseGrind({ lastSetting: 20, suggestion: params, grinderId: 'c40' })).toEqual({ value: '20', source: 'last' });
  });
  it("falls back to the suggestion's base only on the same grinder", () => {
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: 'c40' })).toEqual({ value: '22', source: 'suggestion' });
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
  it('a setting of 0 still counts, and decimals keep their digits', () => {
    expect(chooseGrind({ lastSetting: 0, suggestion: params, grinderId: 'c40' })).toEqual({ value: '0', source: 'last' });
    expect(chooseGrind({ lastSetting: 4.25, suggestion: null, grinderId: 'c40' }).value).toBe('4.25');
  });
  it('a real setting beats the recipe starting point', () => {
    expect(chooseGrind({ lastSetting: 21, suggestion: null, grinderId: 'c40', recipe })).toEqual({ value: '21', source: 'last' });
    expect(chooseGrind({ lastSetting: null, suggestion: params, grinderId: 'c40', recipe }).source).toBe('suggestion');
  });
});

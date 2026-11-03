import { describe, expect, it } from 'vitest';
import type { ChatBrewProposal, ChatNewRecipeProposal, ChatRecipeChangeProposal } from '../api/chats';
import { proposalLines, proposalRoute } from './chatProposal';

const base = { title: 'T', why: 'W', state: 'open' as const };
const brew: ChatBrewProposal = { kind: 'brew', ...base, beanId: 'b', beanLabel: 'Onyx Guji', recipeId: 'r', recipeLabel: 'House V60', grinderId: 'g', grinderLabel: 'C40', grindSetting: 18.5, tempC: 94, ratio: 16.666 };

describe('proposalLines', () => {
  it('lists a brew\'s values, in the person\'s temperature unit', () => {
    expect(proposalLines(brew, 'c')).toEqual(['Bean: Onyx Guji', 'Recipe: House V60', 'Grind 18.5 on C40', 'Temperature 94 °C', 'Ratio 1:16.7']);
    expect(proposalLines({ ...brew, beanLabel: null, recipeLabel: null, grindSetting: null, ratio: null }, 'f')).toEqual(['Temperature 201 °F']);
  });
  it('lists only what a recipe change changes, a cleared value as none', () => {
    const p: ChatRecipeChangeProposal = { kind: 'recipeChange', ...base, recipeId: 'r', recipeLabel: 'House V60', changes: { targetWaterGrams: 240, targetIceGrams: null, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, steps: [{ stepType: 'bloom', label: null, durationSec: 45, targetWaterGrams: 45, targetTempC: null, pressureBar: null, flowRate: null }, { stepType: 'pour', label: 'Main', durationSec: null, targetWaterGrams: 240, targetTempC: null, pressureBar: null, flowRate: null }] } };
    expect(proposalLines(p, 'c')).toEqual(['Recipe: House V60', 'Water 240 g', 'Ice: none', 'Finish 2:45–3:15', 'Steps: Bloom 45 g 0:45, Main 240 g']);
  });
  it('says who picks the brewer of a new recipe', () => {
    const p: ChatNewRecipeProposal = { kind: 'newRecipe', ...base, brewerId: null, brewerLabel: null, recipe: { name: 'Iced', targetDoseGrams: 20 } };
    expect(proposalLines(p, 'c')).toEqual(['Brewer: you choose', 'Dose 20 g']);
  });
});

describe('proposalRoute', () => {
  it('opens the brew page or the recipe form', () => {
    expect(proposalRoute(brew)).toEqual({ name: 'brew', query: { proposal: '1' } });
    expect(proposalRoute({ kind: 'recipeChange', ...base, recipeId: 'r', recipeLabel: 'R', changes: {} })).toMatchObject({ name: 'recipe-edit', params: { id: 'r' } });
  });
});

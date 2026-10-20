import { describe, expect, it } from 'vitest';
import type { Drink, Recipe } from '../api/types';
import { decodeWhat, drinkChoices, encodeDrinks, encodeMethod, recipeChoices, validWhat, whatOptions } from './brewChoice';

const v60 = { id: 'm1', name: 'V60', kind: 'pour_over' } as const;
const espresso = { id: 'm2', name: 'Espresso', kind: 'espresso' } as const;
const recipe = (id: string, method: Recipe['method']) => ({ id, name: id, method }) as Recipe;
const recipes = [recipe('v60-a', v60), recipe('v60-b', v60), recipe('shot', espresso)];
const drink = (id: string, category: string | null, recipeIds: string[]): Drink => ({
  id, name: id, description: null, category, showOnPublicMenu: true, defaultRecipeId: recipeIds[0] ?? null, components: [],
  recipes: recipeIds.map((r) => ({ id: r, name: r, method: r === 'shot' ? espresso : v60 })),
});
const drinks = [drink('latte', 'Espresso milk drinks', ['shot']), drink('atlas', 'Specialty drinks', ['v60-a']), drink('plain', null, ['v60-b']), drink('orphan', 'Specialty drinks', [])];

describe('what are you making', () => {
  it('offers methods with recipes and categories with brewable drinks (uncategorised last)', () => {
    expect(whatOptions(recipes, drinks)).toEqual({
      methods: [{ id: 'm2', name: 'Espresso' }, { id: 'm1', name: 'V60' }],
      categories: ['Espresso milk drinks', 'Specialty drinks', null],
    });
  });

  it('a method shows only its recipes, and no drinks', () => {
    const what = decodeWhat(encodeMethod('m1'));
    expect(recipeChoices(what, recipes, null).map((r) => r.id)).toEqual(['v60-a', 'v60-b']);
    expect(drinkChoices(what, drinks)).toEqual([]);
  });

  it("a drink category shows its drinks, then the drink's recipes", () => {
    const what = decodeWhat(encodeDrinks('Specialty drinks'));
    expect(drinkChoices(what, drinks).map((d) => d.id)).toEqual(['atlas']); // not the one with no recipes
    expect(recipeChoices(what, recipes, drinks[1]!).map((r) => r.id)).toEqual(['v60-a']);
    expect(recipeChoices(what, recipes, null)).toEqual([]);
    expect(drinkChoices(decodeWhat(encodeDrinks(null)), drinks).map((d) => d.id)).toEqual(['plain']);
  });

  it('anything: all recipes and drinks', () => {
    expect(recipeChoices({ kind: 'any' }, recipes, null)).toHaveLength(3);
    expect(drinkChoices({ kind: 'any' }, drinks)).toHaveLength(3);
  });

  it('restores a saved choice only if it still exists', () => {
    const options = whatOptions(recipes, drinks);
    expect(validWhat('method:m2', options)).toBe('method:m2');
    expect(validWhat('method:gone', options)).toBe('any');
    expect(validWhat('drinks:', options)).toBe('drinks:');
    expect(validWhat('drinks:Teas', options)).toBe('any');
    expect(validWhat(null, options)).toBe('any');
  });
});

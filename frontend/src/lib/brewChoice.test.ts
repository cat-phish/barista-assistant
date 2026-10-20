import { describe, expect, it } from 'vitest';
import type { Drink, DrinkCategory, Recipe } from '../api/types';
import { decodeMethod, drinkOptions, encodeMethod, methodOptions, NO_RECIPE, pickRecipe, recipeOptions, validMethod } from './brewChoice';

const v60 = { id: 'm1', name: 'V60', kind: 'pour_over' } as const;
const espresso = { id: 'm2', name: 'Espresso', kind: 'espresso' } as const;
const recipe = (id: string, method: Recipe['method']) => ({ id, name: id, method }) as Recipe;
const recipes = [recipe('v60-a', v60), recipe('v60-b', v60), recipe('shot', espresso), recipe('ristretto', espresso)];
const milk: DrinkCategory = { id: 'c1', name: 'Espresso milk drinks', position: 1 };
const drink = (id: string, method: Drink['method'], defaultRecipeId: string | null, parent: Drink | null = null): Drink => ({
  id, name: id, description: null, method, defaultRecipeId, showOnPublicMenu: true, servingSize: null, servingUnit: null, variants: [], components: [],
  category: method === espresso ? { id: milk.id, name: milk.name } : null,
  parent: parent && { id: parent.id, name: parent.name },
});
const latte = drink('latte', espresso, 'ristretto');
const vanilla = drink('vanilla latte', espresso, null, latte);
const atlas = drink('atlas', v60, 'v60-b');
const drinks = [vanilla, atlas, latte];

describe('brew setup: method → drink → recipe', () => {
  it('offers methods that have recipes, by name', () => {
    expect(methodOptions(recipes)).toEqual([{ id: 'm2', name: 'Espresso' }, { id: 'm1', name: 'V60' }]);
  });

  it("a method shows only its drinks (variants nested) and its recipes", () => {
    const sections = drinkOptions('m2', drinks, [milk]);
    expect(sections.map((s) => [s.category?.name, s.drinks.map((d) => [d.drink.id, d.depth])])).toEqual([
      ['Espresso milk drinks', [['latte', 0], ['vanilla latte', 1]]],
    ]);
    expect(recipeOptions('m2', recipes).map((r) => r.id)).toEqual(['shot', 'ristretto']);
    expect(drinkOptions(null, drinks, [milk])).toEqual([]);
    expect(recipeOptions(null, recipes)).toEqual([]);
  });

  it("selects the drink's default, else keeps the current recipe, else the first", () => {
    const choices = recipeOptions('m2', recipes);
    expect(pickRecipe(choices, latte, 'shot')).toBe('ristretto');
    expect(pickRecipe(choices, vanilla, 'shot')).toBe('shot'); // no default of its own
    expect(pickRecipe(choices, null, 'v60-a')).toBe('shot'); // the current one is another method's
    expect(pickRecipe([], null, 'shot')).toBe('');
  });

  it('restores the last method if it still exists, else the first; old choices fall back', () => {
    const methods = methodOptions(recipes);
    expect(validMethod(encodeMethod('m1'), methods)).toBe('method:m1');
    expect(validMethod(encodeMethod('gone'), methods)).toBe('method:m2');
    expect(validMethod('drinks:Specialty drinks', methods)).toBe('method:m2');
    expect(validMethod(null, methods)).toBe('method:m2');
    expect(validMethod(NO_RECIPE, methods)).toBe(NO_RECIPE);
    expect(validMethod(null, [])).toBe(NO_RECIPE);
    expect(decodeMethod('method:m1')).toBe('m1');
    expect(decodeMethod(NO_RECIPE)).toBeNull();
  });
});

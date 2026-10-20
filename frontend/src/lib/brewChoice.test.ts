import { describe, expect, it } from 'vitest';
import type { Brewer, Drink, DrinkCategory, Recipe } from '../api/types';
import {
  brewable,
  categoryOptions,
  decodeCategory,
  decodeItem,
  encodeBrewer,
  encodeCategory,
  encodeDrink,
  itemOptions,
  itemValues,
  NO_RECIPE,
  pickRecipe,
  recipeOptions,
  validCategory,
  validItem,
} from './brewChoice';

const cat = (id: string, name: string, position: number): DrinkCategory => ({ id, name, position });
const pourOver = cat('c-po', 'Pour Over', 1);
const espressoCat = cat('c-es', 'Espresso', 2);
const milk = cat('c-milk', 'Espresso Milk Drinks', 3);
const special = cat('c-sp', 'Specialty Drinks', 4);
const categories = [special, milk, pourOver, espressoCat];

const brewer = (id: string, name: string, kind: Brewer['kind'], categoryId: string | null, retiredAt: string | null = null): Brewer => ({
  id, name, kind, categoryId, retiredAt, notes: null, menuName: null, description: null, showOnPublicMenu: false,
  preinfusion: 'none', flowControl: 'none', pressureControl: 'none',
});
const v60 = brewer('v60', 'V60', 'pour_over', pourOver.id);
const chemex = brewer('chemex', 'Chemex', 'pour_over', pourOver.id);
const delonghi = brewer('dl', 'Delonghi', 'espresso', espressoCat.id);
const aeropress = brewer('ap', 'Aeropress', 'immersion', null);
const oldMachine = brewer('old', 'Old machine', 'espresso', espressoCat.id, '2026-01-01T00:00:00.000Z');
const kettleOnly = brewer('kettle', 'Clever', 'immersion', special.id); // no recipes
const brewers = [v60, chemex, delonghi, aeropress, oldMachine, kettleOnly];

const ref = (b: Brewer) => ({ id: b.id, name: b.name, kind: b.kind });
const recipe = (id: string, b: Brewer) => ({ id, name: id, brewer: ref(b) }) as Recipe;
const recipes = [recipe('v60-std', v60), recipe('chemex-std', chemex), recipe('shot', delonghi), recipe('ristretto', delonghi), recipe('ap-std', aeropress), recipe('old-shot', oldMachine)];

const drink = (id: string, b: Brewer, category: DrinkCategory | null, defaultRecipeId: string | null, parent: Drink | null = null): Drink => ({
  id, name: id, description: null, brewer: ref(b), defaultRecipeId, showOnPublicMenu: true, servingSize: null, servingUnit: null,
  variants: [], ingredients: [], category: category && { id: category.id, name: category.name }, parent: parent && { id: parent.id, name: parent.name },
});
const latte = drink('Latte', delonghi, milk, 'ristretto');
const vanilla = drink('Vanilla Latte', delonghi, milk, null, latte);
const atlas = drink('The Atlas', v60, special, 'v60-std');
const retiredDrink = drink('Old cortado', oldMachine, milk, null);
const drinks = [vanilla, atlas, latte, retiredDrink];

const options = brewable(brewers, recipes, drinks);

describe('brew setup: category → brewer or drink → recipe', () => {
  it('only active brewers with recipes, and drinks on them, can be brewed', () => {
    expect(options.brewers.map((b) => b.id).sort()).toEqual(['ap', 'chemex', 'dl', 'v60']);
    expect(options.drinks.map((d) => d.id).sort()).toEqual(['Latte', 'The Atlas', 'Vanilla Latte']);
  });

  it('offers categories in their order that hold something, then Other', () => {
    expect(categoryOptions(options, categories)).toEqual([
      { id: 'c-po', name: 'Pour Over' },
      { id: 'c-es', name: 'Espresso' },
      { id: 'c-milk', name: 'Espresso Milk Drinks' },
      { id: 'c-sp', name: 'Specialty Drinks' },
      { id: null, name: 'Other' },
    ]);
  });

  it("a category lists its brewers by name and its drinks with variants nested", () => {
    const po = itemOptions(options, 'c-po');
    expect(po.brewers.map((b) => b.name)).toEqual(['Chemex', 'V60']);
    expect(po.drinks).toEqual([]);
    const milkItems = itemOptions(options, 'c-milk');
    expect(milkItems.drinks.map((d) => [d.drink.id, d.depth])).toEqual([['Latte', 0], ['Vanilla Latte', 1]]);
    expect(itemValues(milkItems)).toEqual(['drink:Latte', 'drink:Vanilla Latte']);
    expect(itemValues(itemOptions(options, null))).toEqual(['brewer:ap']);
  });

  it("a brewer's recipes, with the drink's default selected", () => {
    const choices = recipeOptions('dl', recipes);
    expect(choices.map((r) => r.id)).toEqual(['shot', 'ristretto']);
    expect(pickRecipe(choices, latte, 'shot')).toBe('ristretto');
    expect(pickRecipe(choices, vanilla, 'shot')).toBe('shot'); // no default of its own
    expect(pickRecipe(choices, null, 'v60-std')).toBe('shot'); // another brewer's recipe
    expect(recipeOptions(null, recipes)).toEqual([]);
  });

  it('restores the last choices if they still exist, else the first', () => {
    const cats = categoryOptions(options, categories);
    expect(validCategory(encodeCategory('c-milk'), cats)).toBe('cat:c-milk');
    expect(validCategory(encodeCategory(null), cats)).toBe('cat:');
    expect(validCategory('method:old', cats)).toBe('cat:c-po'); // a choice from before categories came first
    expect(validCategory(NO_RECIPE, cats)).toBe(NO_RECIPE);
    expect(validCategory(null, [])).toBe(NO_RECIPE);
    const values = itemValues(itemOptions(options, 'c-po'));
    expect(validItem(encodeBrewer('v60'), values)).toBe('brewer:v60');
    expect(validItem(encodeDrink('Latte'), values)).toBe('brewer:chemex');
    expect(validItem(null, [])).toBe('');
  });

  it('encodes and decodes choices', () => {
    expect(decodeCategory('cat:c-es')).toEqual({ categoryId: 'c-es' });
    expect(decodeCategory('cat:')).toEqual({ categoryId: null });
    expect(decodeCategory(NO_RECIPE)).toBeNull();
    expect(decodeItem('brewer:v60')).toEqual({ kind: 'brewer', id: 'v60' });
    expect(decodeItem('drink:Latte')).toEqual({ kind: 'drink', id: 'Latte' });
    expect(decodeItem('')).toBeNull();
  });
});

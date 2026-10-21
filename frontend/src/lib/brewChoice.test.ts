import { describe, expect, it } from 'vitest';
import type { Brewer, Drink, DrinkCategory, MethodKind, Recipe } from '../api/types';
import {
  brewable,
  brewerOptions,
  categoryOptions,
  decodeCategory,
  decodeItem,
  encodeCategory,
  encodeDrink,
  encodePlain,
  itemOptions,
  itemValues,
  NO_RECIPE,
  pickBrewer,
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

const brewer = (id: string, name: string, kind: MethodKind, categoryId: string | null, retiredAt: string | null = null): Brewer => ({
  id, name, kind, style: null, categoryId, retiredAt, notes: null, menuName: null, description: null, showOnPublicMenu: false,
  preinfusion: 'none', flowControl: 'none', pressureControl: 'none', createdAt: '2026-10-20T00:00:00.000Z',
});
const v60 = brewer('v60', 'V60', 'filter', pourOver.id);
const chemex = brewer('chemex', 'Chemex', 'filter', pourOver.id);
const delonghi = brewer('dl', 'Delonghi', 'espresso', espressoCat.id);
const linea = brewer('lm', 'Linea Mini', 'espresso', null); // uncategorised
const aeropress = brewer('ap', 'Aeropress', 'filter', null); // uncategorised
const oldMachine = brewer('old', 'Old machine', 'espresso', espressoCat.id, '2026-01-01T00:00:00.000Z');
const clever = brewer('clever', 'Clever', 'filter', special.id); // no recipes yet
const brewers = [v60, chemex, delonghi, linea, aeropress, oldMachine, clever];

const ref = (b: Brewer) => ({ id: b.id, name: b.name, kind: b.kind });
const recipe = (id: string, b: Brewer) => ({ id, name: id, brewer: ref(b) }) as Recipe;
const recipes = [
  recipe('v60-std', v60), recipe('chemex-std', chemex), recipe('shot', delonghi), recipe('ristretto', delonghi),
  recipe('lm-shot', linea), recipe('ap-std', aeropress), recipe('old-shot', oldMachine),
];

const drink = (id: string, kind: MethodKind, category: DrinkCategory | null, defaultRecipeId: string | null, parent: Drink | null = null): Drink => ({
  id, name: id, description: null, kind, defaultRecipeId, showOnPublicMenu: true, servingSize: null, servingUnit: null, instructions: null,
  createdAt: '2026-10-20T00:00:00.000Z', variants: [], ingredients: [],
  category: category && { id: category.id, name: category.name }, parent: parent && { id: parent.id, name: parent.name },
});
const latte = drink('Latte', 'espresso', milk, 'ristretto');
const vanilla = drink('Vanilla Latte', 'espresso', milk, null, latte);
const atlas = drink('The Atlas', 'filter', special, 'chemex-std');
const truffle = drink('Orange Truffle', 'espresso', special, null);
const coldBrew = drink('Cold brew tonic', 'filter', special, null);
const drinks = [vanilla, atlas, latte, truffle, coldBrew];

const options = brewable(brewers, drinks);

describe('brew setup: category → drink → brewer → recipe', () => {
  it('offers every active brewer, recipes or not; drinks need a brewer of their method', () => {
    expect(options.brewers.map((b) => b.id).sort()).toEqual(['ap', 'chemex', 'clever', 'dl', 'lm', 'v60']); // not the retired one
    expect(options.drinks.map((d) => d.id).sort()).toEqual(['Cold brew tonic', 'Latte', 'Orange Truffle', 'The Atlas', 'Vanilla Latte']);
    expect(brewable([oldMachine, v60], [latte, atlas]).drinks.map((d) => d.id)).toEqual(['The Atlas']); // no active espresso brewer
  });

  it('offers every category in its order, flagging empty ones, then Other', () => {
    expect(categoryOptions(options, [...categories, cat('c-new', 'Seasonal', 5)])).toEqual([
      { id: 'c-po', name: 'Pour Over', empty: false },
      { id: 'c-es', name: 'Espresso', empty: false },
      { id: 'c-milk', name: 'Espresso Milk Drinks', empty: false },
      { id: 'c-sp', name: 'Specialty Drinks', empty: false },
      { id: 'c-new', name: 'Seasonal', empty: true },
      { id: null, name: 'Other', empty: false },
    ]);
  });

  it("a category offers a plain brew per method of its brewers, then its drinks (variants nested)", () => {
    expect(itemValues(itemOptions(options, 'c-po'))).toEqual(['plain:filter']);
    expect(itemValues(itemOptions(options, 'c-es'))).toEqual(['plain:espresso']);
    expect(itemValues(itemOptions(options, null))).toEqual(['plain:filter', 'plain:espresso']); // Aeropress, Linea Mini
    expect(itemValues(itemOptions(options, 'c-sp'))[0]).toBe('plain:filter'); // the Clever, before the drinks
    const milkItems = itemOptions(options, 'c-milk');
    expect(milkItems.plains).toEqual([]);
    expect(milkItems.drinks.map((d) => [d.drink.id, d.depth])).toEqual([['Latte', 0], ['Vanilla Latte', 1]]);
  });

  it('a drink can be made on any brewer of its method, whatever its style; a plain brew on its category\'s own', () => {
    const names = (bs: Brewer[]) => bs.map((b) => b.name);
    // The Atlas: a V60, a Chemex, an AeroPress, or a Clever with no recipes yet (setup offers to add one).
    expect(names(brewerOptions(options, 'c-sp', { kind: 'drink', id: 'The Atlas' }, drinks))).toEqual(['Aeropress', 'Chemex', 'Clever', 'V60']);
    expect(names(brewerOptions(options, 'c-sp', { kind: 'plain', method: 'filter' }, drinks))).toEqual(['Clever']);
    expect(names(brewerOptions(options, 'c-sp', { kind: 'drink', id: 'Orange Truffle' }, drinks))).toEqual(['Delonghi', 'Linea Mini']);
    expect(names(brewerOptions(options, 'c-es', { kind: 'plain', method: 'espresso' }, drinks))).toEqual(['Delonghi']); // not the uncategorised Linea
    expect(names(brewerOptions(options, null, { kind: 'plain', method: 'espresso' }, drinks))).toEqual(['Linea Mini']);
    expect(brewerOptions(options, 'c-po', null, drinks)).toEqual([]);
  });

  it("picks the default recipe's brewer, else the last one used for the kind, else the current, else the first", () => {
    const espressos = brewerOptions(options, 'c-milk', { kind: 'drink', id: 'Latte' }, drinks);
    expect(pickBrewer(espressos, latte, recipes, 'lm', '')).toBe('dl'); // Latte's default is a Delonghi recipe
    expect(pickBrewer(espressos, vanilla, recipes, 'lm', '')).toBe('lm'); // no default: the last one used
    expect(pickBrewer(espressos, vanilla, recipes, 'gone', 'dl')).toBe('dl');
    expect(pickBrewer(espressos, vanilla, recipes, null, 'v60')).toBe('dl'); // first by name
    expect(pickBrewer([], vanilla, recipes, null, '')).toBe('');
  });

  it("a brewer's recipes, with the drink's default selected when it fits", () => {
    const choices = recipeOptions('dl', recipes);
    expect(choices.map((r) => r.id)).toEqual(['shot', 'ristretto']);
    expect(pickRecipe(choices, latte, 'shot')).toBe('ristretto');
    expect(pickRecipe(recipeOptions('lm', recipes), latte, '')).toBe('lm-shot'); // default is another machine's: first
    expect(pickRecipe(choices, vanilla, 'shot')).toBe('shot');
    expect(recipeOptions(null, recipes)).toEqual([]);
    expect(recipeOptions('clever', recipes)).toEqual([]); // setup shows "No recipes yet: Add one"
  });

  it('restores the last choices if they still exist, else the first', () => {
    const cats = categoryOptions(options, categories);
    expect(validCategory(encodeCategory('c-milk'), cats)).toBe('cat:c-milk');
    expect(validCategory(encodeCategory(null), cats)).toBe('cat:');
    expect(validCategory('method:old', cats)).toBe('cat:c-po');
    expect(validCategory(NO_RECIPE, cats)).toBe(NO_RECIPE);
    expect(validCategory(null, [])).toBe(NO_RECIPE);
    const values = itemValues(itemOptions(options, 'c-sp'));
    expect(validItem(encodeDrink('The Atlas'), values)).toBe('drink:The Atlas');
    expect(validItem('brewer:v60', values)).toBe(values[0]); // an old-style choice falls back
    expect(validItem(null, [])).toBe('');
  });

  it('encodes and decodes choices', () => {
    expect(decodeCategory('cat:c-es')).toEqual({ categoryId: 'c-es' });
    expect(decodeCategory('cat:')).toEqual({ categoryId: null });
    expect(decodeCategory(NO_RECIPE)).toBeNull();
    expect(decodeItem(encodePlain('filter'))).toEqual({ kind: 'plain', method: 'filter' });
    expect(decodeItem('drink:Latte')).toEqual({ kind: 'drink', id: 'Latte' });
    expect(decodeItem('brewer:v60')).toBeNull();
  });
});

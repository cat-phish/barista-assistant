import { describe, expect, it } from 'vitest';
import type { Brewer, Drink, DrinkCategory, MethodKind, Recipe } from '../api/types';
import {
  brewable,
  brewerOptions,
  decodeItem,
  decodeWhat,
  encodeCategory,
  encodeDrink,
  encodeMethod,
  encodePlain,
  itemOptions,
  itemValues,
  NO_RECIPE,
  pickBrewer,
  pickRecipe,
  recipeOptions,
  validItem,
  validWhat,
  whatOptions,
} from './brewChoice';

// Categories are for drinks only; brewers are grouped by method.
const cat = (id: string, name: string, position: number): DrinkCategory => ({ id, name, position });
const milk = cat('c-milk', 'Espresso Milk Drinks', 1);
const special = cat('c-sp', 'Specialty Drinks', 2);
const categories = [special, milk];

const brewer = (id: string, name: string, kind: MethodKind, archivedAt: string | null = null): Brewer => ({
  id, name, kind, archivedAt, notes: null,
  preinfusion: 'none', flowControl: 'none', pressureControl: 'none', createdAt: '2026-10-20T00:00:00.000Z',
});
const v60 = brewer('v60', 'V60', 'filter');
const chemex = brewer('chemex', 'Chemex', 'filter');
const aeropress = brewer('ap', 'Aeropress', 'filter');
const delonghi = brewer('dl', 'Delonghi', 'espresso');
const linea = brewer('lm', 'Linea Mini', 'espresso');
const oldMoka = brewer('old-moka', 'Old moka pot', 'stovetop', '2026-01-01T00:00:00.000Z'); // archived: no Stovetop
const clever = brewer('clever', 'Clever', 'filter'); // no recipes yet
const brewers = [v60, chemex, aeropress, delonghi, linea, oldMoka, clever];

const ref = (b: Brewer) => ({ id: b.id, name: b.name, kind: b.kind });
const recipe = (id: string, b: Brewer) => ({ id, name: id, brewer: ref(b) }) as Recipe;
const recipes = [recipe('v60-std', v60), recipe('chemex-std', chemex), recipe('shot', delonghi), recipe('ristretto', delonghi), recipe('lm-shot', linea), recipe('ap-std', aeropress)];

const drink = (id: string, kind: MethodKind, category: DrinkCategory | null, defaultRecipeId: string | null, parent: Drink | null = null): Drink => ({
  id, name: id, description: null, kind, defaultRecipeId, servingSize: null, servingUnit: null, instructions: null,
  createdAt: '2026-10-20T00:00:00.000Z', variants: [], ingredients: [],
  category: category && { id: category.id, name: category.name }, parent: parent && { id: parent.id, name: parent.name },
});
const latte = drink('Latte', 'espresso', milk, 'ristretto');
const vanilla = drink('Vanilla Latte', 'espresso', milk, null, latte);
const atlas = drink('The Atlas', 'filter', special, 'chemex-std');
const truffle = drink('Orange Truffle', 'espresso', special, null);
const tonic = drink('Espresso tonic', 'espresso', null, null); // uncategorised
const mokaLatte = drink('Moka latte', 'stovetop', milk, null); // no active stovetop brewer
const drinks = [vanilla, atlas, latte, truffle, tonic, mokaLatte];

const options = brewable(brewers, drinks);
const names = (bs: Brewer[]) => bs.map((b) => b.name);

describe('brew setup: method or drink category → (drink) → brewer → recipe', () => {
  it('offers every active brewer, recipes or not; drinks need a brewer of their method', () => {
    expect(options.brewers.map((b) => b.id).sort()).toEqual(['ap', 'chemex', 'clever', 'dl', 'lm', 'v60']); // not the archived one
    expect(options.drinks.map((d) => d.id)).not.toContain('Moka latte');
  });

  it('lists the methods that have brewers, then drink categories in order (empty flagged), then Other drinks', () => {
    expect(whatOptions(options, [...categories, cat('c-new', 'Seasonal', 3)])).toEqual([
      { value: 'method:filter', name: 'Filter', categoryId: null, empty: false },
      { value: 'method:espresso', name: 'Espresso', categoryId: null, empty: false },
      { value: 'cat:c-milk', name: 'Espresso Milk Drinks', categoryId: 'c-milk', empty: false },
      { value: 'cat:c-sp', name: 'Specialty Drinks', categoryId: 'c-sp', empty: false },
      { value: 'cat:c-new', name: 'Seasonal', categoryId: 'c-new', empty: true },
      { value: 'cat:', name: 'Other drinks', categoryId: null, empty: false },
    ]);
    // A stovetop brewer adds Stovetop, in method order.
    const withMoka = brewable([...brewers, brewer('moka', 'Bialetti', 'stovetop')], drinks);
    expect(whatOptions(withMoka, []).map((o) => o.name)).toEqual(['Filter', 'Espresso', 'Stovetop', 'Other drinks']);
  });

  it('a method is its plain brew; a category is its drinks, variants nested', () => {
    expect(itemValues(itemOptions(options, decodeWhat('method:filter')))).toEqual(['plain:filter']);
    const milkItems = itemOptions(options, decodeWhat('cat:c-milk'));
    expect(milkItems.plains).toEqual([]); // no "Just espresso" in a drink category
    expect(milkItems.drinks.map((d) => [d.drink.id, d.depth])).toEqual([['Latte', 0], ['Vanilla Latte', 1]]);
    expect(itemValues(itemOptions(options, decodeWhat('cat:')))).toEqual(['drink:Espresso tonic']);
    expect(itemOptions(options, decodeWhat(NO_RECIPE))).toEqual({ plains: [], drinks: [] });
  });

  it("a plain brew is made on any brewer of its method; a drink on any brewer of the drink's", () => {
    // Every active filter brewer, including the Clever with no recipes yet (setup offers to add one).
    expect(names(brewerOptions(options, { kind: 'plain', method: 'filter' }, drinks))).toEqual(['Aeropress', 'Chemex', 'Clever', 'V60']);
    expect(names(brewerOptions(options, { kind: 'plain', method: 'espresso' }, drinks))).toEqual(['Delonghi', 'Linea Mini']);
    expect(names(brewerOptions(options, { kind: 'drink', id: 'The Atlas' }, drinks))).toEqual(['Aeropress', 'Chemex', 'Clever', 'V60']);
    expect(names(brewerOptions(options, { kind: 'drink', id: 'Orange Truffle' }, drinks))).toEqual(['Delonghi', 'Linea Mini']);
    expect(brewerOptions(options, null, drinks)).toEqual([]);
  });

  it("picks the default recipe's brewer, else the last one used for the kind, else the current, else the first", () => {
    const espressos = brewerOptions(options, { kind: 'drink', id: 'Latte' }, drinks);
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

  it('restores the last choices if they are still offered, else the first', () => {
    const list = whatOptions(options, categories);
    expect(validWhat(encodeMethod('espresso'), list)).toBe('method:espresso');
    expect(validWhat(encodeCategory('c-milk'), list)).toBe('cat:c-milk');
    expect(validWhat(encodeCategory('c-deleted'), list)).toBe('method:filter'); // e.g. the old "Filter" category
    expect(validWhat(encodeMethod('stovetop'), list)).toBe('method:filter'); // no active stovetop brewer
    expect(validWhat(NO_RECIPE, list)).toBe(NO_RECIPE);
    expect(validWhat(null, [])).toBe(NO_RECIPE);
    const values = itemValues(itemOptions(options, decodeWhat('cat:c-sp')));
    expect(validItem(encodeDrink('The Atlas'), values)).toBe('drink:The Atlas');
    expect(validItem('plain:filter', values)).toBe(values[0]); // a plain brew isn't in a drink category
    expect(validItem(null, [])).toBe('');
  });

  it('encodes and decodes choices', () => {
    expect(decodeWhat('method:stovetop')).toEqual({ kind: 'method', method: 'stovetop' });
    expect(decodeWhat('method:vacuum')).toBeNull();
    expect(decodeWhat('cat:c-sp')).toEqual({ kind: 'category', categoryId: 'c-sp' });
    expect(decodeWhat('cat:')).toEqual({ kind: 'category', categoryId: null });
    expect(decodeWhat(NO_RECIPE)).toBeNull();
    expect(decodeItem(encodePlain('filter'))).toEqual({ kind: 'plain', method: 'filter' });
    expect(decodeItem('drink:Latte')).toEqual({ kind: 'drink', id: 'Latte' });
    expect(decodeItem('brewer:v60')).toBeNull();
  });
});

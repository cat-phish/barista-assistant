// Brew setup (docs/api/drink-categories.md §5d, brewer-methods.md §3e): "What
// are you making?" is one of the workspace's brewer methods (Filter, Espresso,
// a custom Siphon…) or a drink category. A method goes straight to its
// brewers, then a recipe (a plain brew); a category asks for one of its
// drinks, then a brewer of the drink's kind (any method that behaves like it),
// then a recipe, with the drink's default preselected when it fits. "none"
// logs a brew without a recipe. Choices are strings so they fit a <select> and
// localStorage: what "method:<method>" | "cat:<id>" ("cat:" = uncategorised
// drinks) | "none"; item "plain:<method>" | "drink:<id>". <method> is a
// methodId, or a brewer's kind when it has none.
import type { Brewer, BrewerMethod, Drink, DrinkCategory, MethodKind, Recipe } from '../api/types';
import { METHOD_KINDS, METHOD_ORDER } from './equipment';
import { nestDrinks, type NestedDrink } from './drinks';

export const NO_RECIPE = 'none';
// The method a brewer is grouped under: its methodId, else its kind.
export const methodKey = (b: Pick<Brewer, 'methodId' | 'kind'>) => b.methodId ?? b.kind;
export const encodeMethod = (method: string) => `method:${method}`;
export const encodeCategory = (id: string | null) => `cat:${id ?? ''}`;
export type WhatChoice = { kind: 'method'; method: string } | { kind: 'category'; categoryId: string | null };
export function decodeWhat(value: string): WhatChoice | null {
  if (value.startsWith('method:')) {
    const method = value.slice('method:'.length);
    return method ? { kind: 'method', method } : null;
  }
  if (value.startsWith('cat:')) return { kind: 'category', categoryId: value.slice('cat:'.length) || null };
  return null;
}
export const encodePlain = (method: string) => `plain:${method}`;
export const encodeDrink = (id: string) => `drink:${id}`;
export type BrewItem = { kind: 'plain'; method: string } | { kind: 'drink'; id: string };
export function decodeItem(value: string): BrewItem | null {
  if (value.startsWith('plain:')) return { kind: 'plain', method: value.slice('plain:'.length) };
  if (value.startsWith('drink:')) return { kind: 'drink', id: value.slice('drink:'.length) };
  return null;
}

// What can be brewed: active brewers (with or without recipes yet: brew setup
// offers to add one), and drinks whose brew method one of them has.
export interface Brewable {
  brewers: Brewer[];
  drinks: Drink[];
}
// Archived brewers and drinks aren't offered (variants of an archived drink
// move up a level).
export function brewable(brewers: Brewer[], drinks: Drink[]): Brewable {
  const usable = brewers.filter((b) => !b.archivedAt);
  const kinds = new Set(usable.map((b) => b.kind));
  return { brewers: usable, drinks: drinks.filter((d) => !d.archivedAt && kinds.has(d.kind)) };
}

export interface WhatOption {
  value: string; // encodeMethod / encodeCategory
  name: string;
  categoryId: string | null; // for a category; null for a method or "Other drinks"
  empty: boolean; // a category with nothing to brew yet (setup suggests adding a drink)
}
// The methods that have active brewers (the workspace's, in its order; a
// brewer without one goes under its kind's name), then every drink category
// in its order, then "Other drinks" when some drinks have none.
export function whatOptions(b: Brewable, categories: DrinkCategory[], methods: BrewerMethod[] = []): WhatOption[] {
  const keys = new Set(b.brewers.map(methodKey));
  const named = [...methods].sort((x, y) => x.position - y.position).filter((m) => keys.has(m.id)).map((m) => ({ key: m.id, name: m.name }));
  const byKind = METHOD_ORDER.filter((k) => keys.has(k)).map((k) => ({ key: k, name: METHOD_KINDS[k].label }));
  const used = new Set<string | null>(b.drinks.map((d) => d.category?.id ?? null));
  const ordered = [...categories].sort((x, y) => x.position - y.position);
  return [
    ...[...named, ...byKind].map((m) => ({ value: encodeMethod(m.key), name: m.name, categoryId: null, empty: false })),
    ...ordered.map((c) => ({ value: encodeCategory(c.id), name: c.name, categoryId: c.id, empty: !used.has(c.id) })),
    ...(used.has(null) ? [{ value: encodeCategory(null), name: 'Other drinks', categoryId: null, empty: false }] : []),
  ];
}

// The items to pick from: a method is its plain brew (no question to ask); a
// category is its drinks, variants nested.
export function itemOptions(b: Brewable, what: WhatChoice | null): { plains: string[]; drinks: NestedDrink[] } {
  if (!what) return { plains: [], drinks: [] };
  if (what.kind === 'method') return { plains: [what.method], drinks: [] };
  return { plains: [], drinks: nestDrinks(b.drinks.filter((d) => (d.category?.id ?? null) === what.categoryId)) };
}

// All item values, in display order (plain brews, then drinks).
export function itemValues(items: ReturnType<typeof itemOptions>): string[] {
  return [...items.plains.map(encodePlain), ...items.drinks.map((d) => encodeDrink(d.drink.id))];
}

// The brewers that can make the item, by name: every usable brewer of the
// plain brew's method, or of the drink's kind (whatever method they're under).
export function brewerOptions(b: Brewable, item: BrewItem | null, drinks: Drink[]): Brewer[] {
  let list: Brewer[] = [];
  if (item?.kind === 'plain') list = b.brewers.filter((x) => methodKey(x) === item.method);
  else if (item?.kind === 'drink') {
    const kind = drinks.find((d) => d.id === item.id)?.kind;
    list = kind ? b.brewers.filter((x) => x.kind === kind) : [];
  }
  return [...list].sort((x, y) => x.name.localeCompare(y.name));
}

// The kind (fields, timer) of a plain brew's method: its brewers' kind.
export function methodKind(b: Brewable, method: string): MethodKind | null {
  return b.brewers.find((x) => methodKey(x) === method)?.kind ?? null;
}

// The brewer to select: the drink's default recipe's brewer if offered, else
// the last one used for this kind, else the current one if it fits, else the
// first.
export function pickBrewer(options: Brewer[], drink: Drink | null, recipes: Recipe[], remembered: string | null, current: string): string {
  const offered = (id: string | null | undefined): id is string => !!id && options.some((b) => b.id === id);
  const fromDefault = recipes.find((r) => r.id === drink?.defaultRecipeId && !r.archivedAt)?.brewer.id;
  if (offered(fromDefault)) return fromDefault;
  if (offered(remembered)) return remembered;
  if (offered(current)) return current;
  return options[0]?.id ?? '';
}

// The brewer's recipes, archived ones left out (docs/api/recipes.md §5).
export function recipeOptions(brewerId: string | null, recipes: Recipe[]): Recipe[] {
  return brewerId ? recipes.filter((r) => r.brewer.id === brewerId && !r.archivedAt) : [];
}

// The recipe to select: the drink's default, else the last one used on this
// brewer, else the current one if it still fits, else the first.
export function pickRecipe(choices: Recipe[], drink: Drink | null, remembered: string | null, current: string): string {
  const fits = (id: string | null | undefined): id is string => !!id && choices.some((r) => r.id === id);
  if (fits(drink?.defaultRecipeId)) return drink.defaultRecipeId;
  if (fits(remembered)) return remembered;
  if (fits(current)) return current;
  return choices[0]?.id ?? '';
}

// A valid choice to restore (e.g. the last one), else the first option. An
// old or deleted category (or a method with no brewers now) falls back.
export function validWhat(value: string | null, options: WhatOption[]): string {
  if (value === NO_RECIPE) return value;
  if (value && options.some((o) => o.value === value)) return value;
  return options[0]?.value ?? NO_RECIPE;
}
export function validItem(value: string | null, values: string[]): string {
  return value && values.includes(value) ? value : (values[0] ?? '');
}

// What setup still needs before brewing, first thing first, or '' when it's
// ready. Start and Log stay disabled while there's something, and say it.
export interface SetupState {
  bean: boolean;
  emptyCategory: boolean; // a drink category with nothing in it
  noRecipes: boolean; // a brewer chosen that has no recipes
  sizeMissing: boolean; // a sized drink without a size
  batchInvalid: boolean; // the recipe's batch or shot doesn't make sense
  finishError: boolean; // rapid cold: the target finish
  steepError: boolean; // long cold styles: the steep window
}
export function setupMissing(s: SetupState): string {
  if (!s.bean) return 'Choose a bean.';
  if (s.emptyCategory) return 'Add a drink to this category first.';
  if (s.noRecipes) return 'Add a recipe for this brewer first.';
  if (s.sizeMissing) return 'Enter a size.';
  if (s.batchInvalid) return 'Enter positive amounts for the batch.';
  if (s.finishError) return 'Fix the target finish.';
  if (s.steepError) return 'Fix the steep window.';
  return '';
}

// Switching setup to a recipe or brewer the AI suggested (docs/api/analysis.md
// §8b): what, item, brewer and recipe to set, in that order. A drink being
// made stays when the brewer can make it, else it's a plain brew of the
// brewer's method. recipeId '' lets setup pick the brewer's recipe. null:
// it's gone or archived.
export interface SwitchPlan {
  what: string;
  item: string;
  brewerId: string;
  recipeId: string;
}
export function switchPlan(kind: 'recipe' | 'brewer', id: string, s: { brewers: Brewer[]; recipes: Recipe[]; drink: Drink | null }): SwitchPlan | null {
  const recipe = kind === 'recipe' ? s.recipes.find((r) => r.id === id && !r.archivedAt) : undefined;
  if (kind === 'recipe' && !recipe) return null;
  const brewer = s.brewers.find((b) => b.id === (recipe ? recipe.brewer.id : id) && !b.archivedAt);
  if (!brewer) return null;
  const keepDrink = s.drink && s.drink.kind === brewer.kind;
  return {
    what: keepDrink ? encodeCategory(s.drink!.category?.id ?? null) : encodeMethod(methodKey(brewer)),
    item: keepDrink ? encodeDrink(s.drink!.id) : encodePlain(methodKey(brewer)),
    brewerId: brewer.id,
    recipeId: recipe?.id ?? '',
  };
}

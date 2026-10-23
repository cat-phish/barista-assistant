// Brew setup (docs/api/drink-categories.md §5d, brewers.md §3): "What are you
// making?" is a brew method (Filter, Espresso…) or a drink category. A method
// goes straight to its brewers, then a recipe (a plain brew); a category asks
// for one of its drinks, then a brewer of the drink's method (any), then a
// recipe, with the drink's default preselected when it fits. "none" logs a
// brew without a recipe. Choices are strings so they fit a <select> and
// localStorage: what "method:<kind>" | "cat:<id>" ("cat:" = uncategorised
// drinks) | "none"; item "plain:<kind>" | "drink:<id>".
import type { Brewer, Drink, DrinkCategory, MethodKind, Recipe } from '../api/types';
import { METHOD_KINDS, METHOD_ORDER } from './equipment';
import { nestDrinks, type NestedDrink } from './drinks';

export const NO_RECIPE = 'none';
export const encodeMethod = (kind: MethodKind) => `method:${kind}`;
export const encodeCategory = (id: string | null) => `cat:${id ?? ''}`;
export type WhatChoice = { kind: 'method'; method: MethodKind } | { kind: 'category'; categoryId: string | null };
export function decodeWhat(value: string): WhatChoice | null {
  if (value.startsWith('method:')) {
    const method = value.slice('method:'.length) as MethodKind;
    return method in METHOD_KINDS ? { kind: 'method', method } : null;
  }
  if (value.startsWith('cat:')) return { kind: 'category', categoryId: value.slice('cat:'.length) || null };
  return null;
}
export const encodePlain = (kind: MethodKind) => `plain:${kind}`;
export const encodeDrink = (id: string) => `drink:${id}`;
export type BrewItem = { kind: 'plain'; method: MethodKind } | { kind: 'drink'; id: string };
export function decodeItem(value: string): BrewItem | null {
  if (value.startsWith('plain:')) return { kind: 'plain', method: value.slice('plain:'.length) as MethodKind };
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
// The methods that have active brewers (in method order), then every drink
// category in its order, then "Other drinks" when some drinks have none.
export function whatOptions(b: Brewable, categories: DrinkCategory[]): WhatOption[] {
  const methods = METHOD_ORDER.filter((k) => b.brewers.some((x) => x.kind === k));
  const used = new Set<string | null>(b.drinks.map((d) => d.category?.id ?? null));
  const ordered = [...categories].sort((x, y) => x.position - y.position);
  return [
    ...methods.map((k) => ({ value: encodeMethod(k), name: METHOD_KINDS[k].label, categoryId: null, empty: false })),
    ...ordered.map((c) => ({ value: encodeCategory(c.id), name: c.name, categoryId: c.id, empty: !used.has(c.id) })),
    ...(used.has(null) ? [{ value: encodeCategory(null), name: 'Other drinks', categoryId: null, empty: false }] : []),
  ];
}

// The items to pick from: a method is its plain brew (no question to ask); a
// category is its drinks, variants nested.
export function itemOptions(b: Brewable, what: WhatChoice | null): { plains: MethodKind[]; drinks: NestedDrink[] } {
  if (!what) return { plains: [], drinks: [] };
  if (what.kind === 'method') return { plains: [what.method], drinks: [] };
  return { plains: [], drinks: nestDrinks(b.drinks.filter((d) => (d.category?.id ?? null) === what.categoryId)) };
}

// All item values, in display order (plain brews, then drinks).
export function itemValues(items: ReturnType<typeof itemOptions>): string[] {
  return [...items.plains.map(encodePlain), ...items.drinks.map((d) => encodeDrink(d.drink.id))];
}

// The brewers that can make the item, by name: every usable brewer of the
// plain brew's method, or of the drink's.
export function brewerOptions(b: Brewable, item: BrewItem | null, drinks: Drink[]): Brewer[] {
  const kind = item?.kind === 'plain' ? item.method : item?.kind === 'drink' ? drinks.find((d) => d.id === item.id)?.kind : undefined;
  const list = kind ? b.brewers.filter((x) => x.kind === kind) : [];
  return [...list].sort((x, y) => x.name.localeCompare(y.name));
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

// The recipe to select: the drink's default, else the current one if it
// still fits, else the first.
export function pickRecipe(choices: Recipe[], drink: Drink | null, current: string): string {
  const fits = (id: string | null | undefined): id is string => !!id && choices.some((r) => r.id === id);
  if (fits(drink?.defaultRecipeId)) return drink.defaultRecipeId;
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

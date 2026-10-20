// Brew setup picks Category → Brewer or drink → Recipe (docs/features.md):
// a category ("Pour Over", "Espresso Milk Drinks"), then one of its brewers
// (V60, an espresso machine) or drinks (variants under their parent), then one
// of that brewer's recipes, with the drink's default preselected. "none" logs
// a brew without a recipe. Choices are strings so they fit a <select> and
// localStorage: category "cat:<id>" ("cat:" = uncategorised) | "none";
// item "brewer:<id>" | "drink:<id>".
import type { Brewer, Drink, DrinkCategory, Recipe } from '../api/types';
import { nestDrinks, type NestedDrink } from './drinks';

export const NO_RECIPE = 'none';
export const encodeCategory = (id: string | null) => `cat:${id ?? ''}`;
export function decodeCategory(value: string): { categoryId: string | null } | null {
  return value.startsWith('cat:') ? { categoryId: value.slice('cat:'.length) || null } : null;
}
export const encodeBrewer = (id: string) => `brewer:${id}`;
export const encodeDrink = (id: string) => `drink:${id}`;
export type BrewItem = { kind: 'brewer'; id: string } | { kind: 'drink'; id: string };
export function decodeItem(value: string): BrewItem | null {
  if (value.startsWith('brewer:')) return { kind: 'brewer', id: value.slice('brewer:'.length) };
  if (value.startsWith('drink:')) return { kind: 'drink', id: value.slice('drink:'.length) };
  return null;
}

// What can be brewed: active brewers with recipes, and drinks on them.
export interface Brewable {
  brewers: Brewer[];
  drinks: Drink[];
}
export function brewable(brewers: Brewer[], recipes: Recipe[], drinks: Drink[]): Brewable {
  const withRecipes = new Set(recipes.map((r) => r.brewer.id));
  const usable = brewers.filter((b) => !b.retiredAt && withRecipes.has(b.id));
  const ids = new Set(usable.map((b) => b.id));
  return { brewers: usable, drinks: drinks.filter((d) => ids.has(d.brewer.id)) };
}

// Categories in their order that hold something brewable, then "Other" for
// uncategorised brewers and drinks.
export function categoryOptions(b: Brewable, categories: DrinkCategory[]): Array<{ id: string | null; name: string }> {
  const used = new Set<string | null>([...b.brewers.map((x) => x.categoryId), ...b.drinks.map((d) => d.category?.id ?? null)]);
  const ordered = [...categories].sort((x, y) => x.position - y.position).filter((c) => used.has(c.id));
  return [...ordered.map((c) => ({ id: c.id, name: c.name })), ...(used.has(null) ? [{ id: null, name: 'Other' }] : [])];
}

// A category's brewers (by name) and drinks (variants nested).
export function itemOptions(b: Brewable, categoryId: string | null): { brewers: Brewer[]; drinks: NestedDrink[] } {
  return {
    brewers: b.brewers.filter((x) => x.categoryId === categoryId).sort((x, y) => x.name.localeCompare(y.name)),
    drinks: nestDrinks(b.drinks.filter((d) => (d.category?.id ?? null) === categoryId)),
  };
}

// All item values of a category, in display order (brewers, then drinks).
export function itemValues(items: ReturnType<typeof itemOptions>): string[] {
  return [...items.brewers.map((x) => encodeBrewer(x.id)), ...items.drinks.map((d) => encodeDrink(d.drink.id))];
}

export function recipeOptions(brewerId: string | null, recipes: Recipe[]): Recipe[] {
  return brewerId ? recipes.filter((r) => r.brewer.id === brewerId) : [];
}

// The recipe to select: the drink's default, else the current one if it
// still fits, else the first.
export function pickRecipe(choices: Recipe[], drink: Drink | null, current: string): string {
  const fits = (id: string | null | undefined): id is string => !!id && choices.some((r) => r.id === id);
  if (fits(drink?.defaultRecipeId)) return drink.defaultRecipeId;
  if (fits(current)) return current;
  return choices[0]?.id ?? '';
}

// A valid choice to restore (e.g. the last one), else the first option.
export function validCategory(value: string | null, options: Array<{ id: string | null }>): string {
  if (value === NO_RECIPE) return value;
  const decoded = value ? decodeCategory(value) : null;
  if (decoded && options.some((o) => o.id === decoded.categoryId)) return value!;
  return options[0] ? encodeCategory(options[0].id) : NO_RECIPE;
}
export function validItem(value: string | null, values: string[]): string {
  return value && values.includes(value) ? value : (values[0] ?? '');
}

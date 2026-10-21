// Brew setup is always Category → Drink → Brewer → Recipe (docs/features.md):
// a category ("Pour Over", "Specialty Drinks"); then one of its drinks, or
// "Just <kind>" for a plain brew of the category's brewers; then a brewer of
// that kind (any for a drink, the category's own for a plain brew); then one
// of that brewer's recipes, with the drink's default preselected when it fits.
// "none" logs a brew without a recipe. Choices are strings so they fit a
// <select> and localStorage: category "cat:<id>" ("cat:" = uncategorised) |
// "none"; item "plain:<kind>" | "drink:<id>".
import type { Brewer, Drink, DrinkCategory, MethodKind, Recipe } from '../api/types';
import { nestDrinks, type NestedDrink } from './drinks';

export const NO_RECIPE = 'none';
export const encodeCategory = (id: string | null) => `cat:${id ?? ''}`;
export function decodeCategory(value: string): { categoryId: string | null } | null {
  return value.startsWith('cat:') ? { categoryId: value.slice('cat:'.length) || null } : null;
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
export function brewable(brewers: Brewer[], drinks: Drink[]): Brewable {
  const usable = brewers.filter((b) => !b.retiredAt);
  const kinds = new Set(usable.map((b) => b.kind));
  return { brewers: usable, drinks: drinks.filter((d) => kinds.has(d.kind)) };
}

// Every category in its order (empty ones flagged, so setup can suggest
// adding a drink), then "Other" when there are uncategorised brewers or drinks.
export function categoryOptions(b: Brewable, categories: DrinkCategory[]): Array<{ id: string | null; name: string; empty: boolean }> {
  const used = new Set<string | null>([...b.brewers.map((x) => x.categoryId), ...b.drinks.map((d) => d.category?.id ?? null)]);
  const ordered = [...categories].sort((x, y) => x.position - y.position);
  return [
    ...ordered.map((c) => ({ id: c.id, name: c.name, empty: !used.has(c.id) })),
    ...(used.has(null) ? [{ id: null, name: 'Other', empty: false }] : []),
  ];
}

const KIND_ORDER: MethodKind[] = ['filter', 'espresso'];

// A category's plain brews (one per kind among its brewers, in kind order)
// and its drinks (variants nested).
export function itemOptions(b: Brewable, categoryId: string | null): { plains: MethodKind[]; drinks: NestedDrink[] } {
  const kinds = new Set(b.brewers.filter((x) => x.categoryId === categoryId).map((x) => x.kind));
  return {
    plains: KIND_ORDER.filter((k) => kinds.has(k)),
    drinks: nestDrinks(b.drinks.filter((d) => (d.category?.id ?? null) === categoryId)),
  };
}

// All item values of a category, in display order (plain brews, then drinks).
export function itemValues(items: ReturnType<typeof itemOptions>): string[] {
  return [...items.plains.map(encodePlain), ...items.drinks.map((d) => encodeDrink(d.drink.id))];
}

// The brewers that can make the item, by name: for a drink, every usable
// brewer of its kind; for a plain brew, the category's own of that kind.
export function brewerOptions(b: Brewable, categoryId: string | null, item: BrewItem | null, drinks: Drink[]): Brewer[] {
  let list: Brewer[] = [];
  if (item?.kind === 'plain') list = b.brewers.filter((x) => x.kind === item.method && x.categoryId === categoryId);
  if (item?.kind === 'drink') {
    const kind = drinks.find((d) => d.id === item.id)?.kind;
    list = b.brewers.filter((x) => x.kind === kind);
  }
  return [...list].sort((x, y) => x.name.localeCompare(y.name));
}

// The brewer to select: the drink's default recipe's brewer if offered, else
// the last one used for this kind, else the current one if it fits, else the
// first.
export function pickBrewer(options: Brewer[], drink: Drink | null, recipes: Recipe[], remembered: string | null, current: string): string {
  const offered = (id: string | null | undefined): id is string => !!id && options.some((b) => b.id === id);
  const fromDefault = recipes.find((r) => r.id === drink?.defaultRecipeId)?.brewer.id;
  if (offered(fromDefault)) return fromDefault;
  if (offered(remembered)) return remembered;
  if (offered(current)) return current;
  return options[0]?.id ?? '';
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

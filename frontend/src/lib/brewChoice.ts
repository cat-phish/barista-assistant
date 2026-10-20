// Brew setup picks Method → Drink → Recipe (docs/api_spec.md §5c): a brew
// method (only methods with recipes), then "just the method" or one of its
// drinks (in category sections, variants under their parent), then one of the
// method's recipes, with the drink's default preselected. "none" logs a brew
// without a recipe. Stored as a string so it fits a <select> and
// localStorage: "method:<id>" | "none".
import type { Drink, DrinkCategory, Recipe } from '../api/types';
import { drinkSections, type DrinkSection } from './drinks';

export const NO_RECIPE = 'none';
export const encodeMethod = (methodId: string) => `method:${methodId}`;
export function decodeMethod(value: string): string | null {
  return value.startsWith('method:') ? value.slice('method:'.length) : null;
}

// Methods that have recipes, by name.
export function methodOptions(recipes: Recipe[]): Array<{ id: string; name: string }> {
  const methods = new Map<string, string>();
  for (const r of recipes) methods.set(r.method.id, r.method.name);
  return [...methods].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function drinkOptions(methodId: string | null, drinks: Drink[], categories: DrinkCategory[]): DrinkSection[] {
  return methodId ? drinkSections(drinks.filter((d) => d.method.id === methodId), categories) : [];
}

export function recipeOptions(methodId: string | null, recipes: Recipe[]): Recipe[] {
  return methodId ? recipes.filter((r) => r.method.id === methodId) : [];
}

// The recipe to select: the drink's default, else the current one if it
// still fits, else the first.
export function pickRecipe(choices: Recipe[], drink: Drink | null, current: string): string {
  const fits = (id: string | null | undefined): id is string => !!id && choices.some((r) => r.id === id);
  if (fits(drink?.defaultRecipeId)) return drink.defaultRecipeId;
  if (fits(current)) return current;
  return choices[0]?.id ?? '';
}

// A valid choice to restore (e.g. the last one), else the first method.
export function validMethod(value: string | null, methods: Array<{ id: string }>): string {
  if (value === NO_RECIPE) return value;
  const id = value ? decodeMethod(value) : null;
  if (id && methods.some((m) => m.id === id)) return value!;
  return methods[0] ? encodeMethod(methods[0].id) : NO_RECIPE;
}

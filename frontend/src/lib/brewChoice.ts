// "What are you making?" at the top of brew setup: a brew method (then only
// its recipes) or a drink category (then its drinks, then the drink's
// recipes), or anything. Stored as a string so it fits a <select> and
// localStorage: "any" | "method:<id>" | "drinks:<category>" ("drinks:" =
// uncategorised).
import type { Drink, Recipe } from '../api/types';

export type BrewWhat = { kind: 'any' } | { kind: 'method'; methodId: string } | { kind: 'drinks'; category: string | null };

export function decodeWhat(value: string): BrewWhat {
  if (value.startsWith('method:')) return { kind: 'method', methodId: value.slice('method:'.length) };
  if (value.startsWith('drinks:')) return { kind: 'drinks', category: value.slice('drinks:'.length) || null };
  return { kind: 'any' };
}
export const encodeMethod = (methodId: string) => `method:${methodId}`;
export const encodeDrinks = (category: string | null) => `drinks:${category ?? ''}`;

// The picker's options: methods that have recipes, and drink categories that
// have brewable drinks (uncategorised last).
export function whatOptions(recipes: Recipe[], drinks: Drink[]): { methods: Array<{ id: string; name: string }>; categories: Array<string | null> } {
  const methods = new Map<string, string>();
  for (const r of recipes) methods.set(r.method.id, r.method.name);
  const categories = [...new Set(drinks.filter((d) => d.recipes.length > 0).map((d) => d.category))].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a.localeCompare(b),
  );
  return {
    methods: [...methods].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    categories,
  };
}

export function drinkChoices(what: BrewWhat, drinks: Drink[]): Drink[] {
  const brewable = drinks.filter((d) => d.recipes.length > 0);
  if (what.kind === 'drinks') return brewable.filter((d) => d.category === what.category);
  return what.kind === 'any' ? brewable : [];
}

export function recipeChoices(what: BrewWhat, recipes: Recipe[], drink: Drink | null): Recipe[] {
  if (drink) return recipes.filter((r) => drink.recipes.some((x) => x.id === r.id));
  if (what.kind === 'method') return recipes.filter((r) => r.method.id === what.methodId);
  return what.kind === 'any' ? recipes : [];
}

// A valid option to restore (e.g. the last choice), else "any".
export function validWhat(value: string | null, options: ReturnType<typeof whatOptions>): string {
  if (!value) return 'any';
  const what = decodeWhat(value);
  if (what.kind === 'method') return options.methods.some((m) => m.id === what.methodId) ? value : 'any';
  if (what.kind === 'drinks') return options.categories.includes(what.category) ? value : 'any';
  return 'any';
}

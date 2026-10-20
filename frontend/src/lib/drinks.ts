// Drinks and ingredients (docs/api_spec.md §5b–§5d): labels, summaries, and
// arranging drinks into category sections with variants under their parent.
import type { IngredientType, Drink, DrinkCategory, DrinkIngredient } from '../api/types';
import { formatAmount } from './servings';

export const INGREDIENT_TYPES: Record<IngredientType, string> = {
  milk: 'Milk',
  foam: 'Foam',
  syrup: 'Syrup',
  ice: 'Ice',
  water: 'Water',
  other: 'Other',
};

// "Orange cold foam · 40 g · spooned on top", with the amount scaled by
// `factor` for a bigger or smaller drink (lib/servings.ts).
export function ingredientLine(c: DrinkIngredient, factor = 1): string {
  return [c.name, formatAmount(c.amountValue, c.amountUnit, factor), c.note].filter(Boolean).join(' · ');
}

export interface NestedDrink {
  drink: Drink;
  depth: number; // 0 = top level, 1 = a variant, 2 = a variant's variant...
}

// Depth-first: each drink followed by its variants, by name at every level
// (Z–A when descending). A drink whose parent isn't in the list counts as top level.
export function nestDrinks(drinks: Drink[], descending = false): NestedDrink[] {
  const ids = new Set(drinks.map((d) => d.id));
  const byName = [...drinks].sort((a, b) => (descending ? -1 : 1) * a.name.localeCompare(b.name));
  const children = new Map<string | null, Drink[]>();
  for (const d of byName) {
    const parent = d.parent && ids.has(d.parent.id) ? d.parent.id : null;
    children.set(parent, [...(children.get(parent) ?? []), d]);
  }
  const out: NestedDrink[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const drink of children.get(parent) ?? []) {
      if (seen.has(drink.id)) continue; // a loop can't happen (the API refuses), but don't hang if it did
      seen.add(drink.id);
      out.push({ drink, depth });
      walk(drink.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface DrinkSection {
  category: DrinkCategory | null; // null = uncategorised, always last
  drinks: NestedDrink[];
}

// Sections in the categories' order; empty ones are left out. Variants nest
// under their parent within a section.
export function drinkSections(drinks: Drink[], categories: DrinkCategory[]): DrinkSection[] {
  const ordered = [...categories].sort((a, b) => a.position - b.position);
  return [...ordered, null]
    .map((category) => ({
      category,
      drinks: nestDrinks(drinks.filter((d) => (d.category?.id ?? null) === (category?.id ?? null))),
    }))
    .filter((s) => s.drinks.length > 0);
}

// A drink and all its variants, at any depth: what it can't become a variant of.
export function selfAndDescendants(drinks: Drink[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of drinks) {
      if (d.parent && out.has(d.parent.id) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}

// Drinks and components (docs/api_spec.md §5b, §5c): labels and the one-line
// summaries shown in lists and when brewing.
import type { ComponentType, Drink } from '../api/types';

export const COMPONENT_TYPES: Record<ComponentType, string> = {
  milk: 'Milk',
  foam: 'Foam',
  syrup: 'Syrup',
  ice: 'Ice',
  water: 'Water',
  other: 'Other',
};

// "Orange cold foam · 40 g · spooned on top"
export function componentLine(c: Drink['components'][number]): string {
  return [c.name, c.amount, c.note].filter(Boolean).join(' · ');
}

// "V60 Standard (default), V60 Big Batch"
export function recipesLine(d: Drink): string {
  return d.recipes.map((r) => (r.id === d.defaultRecipeId && d.recipes.length > 1 ? `${r.name} (default)` : r.name)).join(', ');
}

import { describe, expect, it } from 'vitest';
import type { Drink } from '../api/types';
import { componentLine, recipesLine } from './drinks';

const method = { id: 'm', name: 'V60', kind: 'pour_over' } as const;
const drink: Drink = {
  id: 'd', name: 'The Atlas', description: null, category: 'Specialty drinks', showOnPublicMenu: true, defaultRecipeId: 'b',
  recipes: [{ id: 'a', name: 'V60 A', method }, { id: 'b', name: 'V60 B', method }],
  components: [{ componentId: 'c', name: 'Orange cold foam', componentType: 'foam', amount: '40 g', note: 'spooned on top' }],
};

describe('drink summaries', () => {
  it('lists components with amount and note, and marks the default recipe', () => {
    expect(componentLine(drink.components[0]!)).toBe('Orange cold foam · 40 g · spooned on top');
    expect(componentLine({ ...drink.components[0]!, amount: null, note: null })).toBe('Orange cold foam');
    expect(recipesLine(drink)).toBe('V60 A, V60 B (default)');
    expect(recipesLine({ ...drink, recipes: [drink.recipes[0]!], defaultRecipeId: 'a' })).toBe('V60 A');
  });
});

import { describe, expect, it } from 'vitest';
import type { Drink, DrinkCategory } from '../api/types';
import { ingredientLine, drinkSections, nestDrinks, selfAndDescendants } from './drinks';

const brewer = { id: 'm', name: 'Espresso', kind: 'espresso' } as const;
const milk: DrinkCategory = { id: 'milk', name: 'Espresso milk drinks', position: 2 };
const special: DrinkCategory = { id: 'special', name: 'Specialty drinks', position: 1 };

function drink(id: string, name: string, parent: Drink | null = null, category: DrinkCategory | null = milk): Drink {
  return {
    id, name, description: null, brewer, showOnPublicMenu: true, defaultRecipeId: null, servingSize: null, servingUnit: null, variants: [], ingredients: [],
    category: category && { id: category.id, name: category.name },
    parent: parent && { id: parent.id, name: parent.name },
  };
}

const latte = drink('latte', 'Latte');
const vanilla = drink('vanilla', 'Vanilla Latte', latte);
const iced = drink('iced', 'Iced Vanilla Latte', vanilla);
const cortado = drink('cortado', 'Cortado');
const atlas = drink('atlas', 'The Atlas', null, special);
const plain = drink('plain', 'Affogato', null, null);
const all = [iced, atlas, vanilla, plain, latte, cortado];
const names = (rows: Array<{ drink: Drink; depth: number }>) => rows.map((r) => `${'-'.repeat(r.depth)}${r.drink.name}`);

describe('drink summaries', () => {
  it('lists ingredients with amount and note, scaled for the size made', () => {
    const c = { ingredientId: 'c', name: 'Orange cold foam', ingredientType: 'foam', amountValue: 40, amountUnit: 'g', note: 'spooned on top' } as const;
    expect(ingredientLine(c)).toBe('Orange cold foam · 40 g · spooned on top');
    expect(ingredientLine(c, 1.5)).toBe('Orange cold foam · 60 g · spooned on top');
    expect(ingredientLine({ ...c, amountValue: null, amountUnit: null, note: null })).toBe('Orange cold foam');
  });
});

describe('nesting variants', () => {
  it('puts variants under their parent, by name at each level', () => {
    expect(names(nestDrinks([iced, vanilla, latte, cortado]))).toEqual(['Cortado', 'Latte', '-Vanilla Latte', '--Iced Vanilla Latte']);
  });

  it('treats a drink whose parent is missing as top level', () => {
    expect(names(nestDrinks([iced, latte]))).toEqual(['Iced Vanilla Latte', 'Latte']);
  });

  it('groups into sections in category order, uncategorised last', () => {
    const sections = drinkSections(all, [milk, special, { id: 'empty', name: 'Empty', position: 3 }]);
    expect(sections.map((s) => [s.category?.name ?? null, names(s.drinks)])).toEqual([
      ['Specialty drinks', ['The Atlas']],
      ['Espresso milk drinks', ['Cortado', 'Latte', '-Vanilla Latte', '--Iced Vanilla Latte']],
      [null, ['Affogato']],
    ]);
  });

  it('finds a drink and its variants at any depth', () => {
    expect([...selfAndDescendants(all, 'latte')].sort()).toEqual(['iced', 'latte', 'vanilla']);
    expect([...selfAndDescendants(all, 'iced')]).toEqual(['iced']);
  });
});

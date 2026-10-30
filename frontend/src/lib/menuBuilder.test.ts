import { describe, expect, it } from 'vitest';
import type { Brewer, Drink, DrinkCategory, Menu, MenuItem } from '../api/types';
import { addOptions, addRequest, canMoveTo, duplicateSection, showsAs } from './menuBuilder';

const cat = (id: string, name: string, position: number): DrinkCategory => ({ id, name, position });
const milk = cat('milk', 'Milk drinks', 1);
const special = cat('special', 'Specials', 2);
const drink = (id: string, category: DrinkCategory | null, over: Partial<Drink> = {}): Drink => ({
  id, name: id, description: null, kind: 'espresso', defaultRecipeId: null, servingSize: null, servingUnit: null, instructions: null,
  archivedAt: null, createdAt: '2026-10-20T00:00:00.000Z', variants: [], ingredients: [],
  category: category && { id: category.id, name: category.name }, parent: null, ...over,
});
const brewer = (id: string, kind: Brewer['kind'], archivedAt: string | null = null, methodId: string | null = null) => ({ id, name: id, kind, archivedAt, methodId }) as Brewer;
const item = (id: string, over: Partial<MenuItem>): MenuItem => ({
  id, itemType: 'drink', drinkId: null, brewerId: null, name: null, description: null, price: null, available: true, source: null, beanFields: null, ...over,
});

const latte = drink('Latte', milk);
const vanilla = drink('Vanilla Latte', milk, { parent: { id: 'Latte', name: 'Latte' } });
const tonic = drink('Tonic', null);
const old = drink('Old', special, { archivedAt: '2026-10-22T00:00:00.000Z' });
const drinks = [vanilla, tonic, latte, old];
const brewers = [brewer('V60', 'filter'), brewer('Linea', 'espresso'), brewer('Moka', 'stovetop', '2026-10-22T00:00:00.000Z')];
const menu: Menu = {
  title: null,
  currency: null,
  sections: [
    { id: 's1', name: 'Espresso', description: null, position: 1, items: [item('i1', { drinkId: 'Latte' }), item('i2', { itemType: 'brewer', brewerId: 'Linea' })] },
    { id: 's2', name: 'Coffee', description: null, position: 2, items: [item('i3', { itemType: 'beans' }), item('i4', { drinkId: 'Tonic' })] },
  ],
};

describe('addOptions', () => {
  const o = addOptions(menu, 's1', drinks, [milk, special], brewers);

  it('groups active drinks by category in order, nested, with Other drinks last', () => {
    expect(o.drinks.map((g) => g.name)).toEqual(['Milk drinks', 'Other drinks']); // Specials only has an archived drink
    expect(o.drinks[0]!.options.map((x) => [x.name, x.depth])).toEqual([['Latte', 0], ['Vanilla Latte', 1]]);
  });

  it('marks what is in this section and names the other sections', () => {
    expect(o.drinks[0]!.options[0]).toMatchObject({ here: true, elsewhere: [] });
    expect(o.drinks[1]!.options[0]).toMatchObject({ name: 'Tonic', here: false, elsewhere: ['Coffee'] });
    expect(o.beans).toEqual({ here: false, elsewhere: 'Coffee' });
  });

  it('offers active brewers by method', () => {
    expect(o.brewers.map((g) => [g.name, g.options.map((x) => x.name)])).toEqual([['Filter', ['V60']], ['Espresso', ['Linea']]]);
  });

  it("groups plain brews under the workspace's methods, custom ones too", () => {
    const methods = [
      { id: 'm-f', name: 'Filter', position: 1, hidden: false, builtin: 'filter' as const, behaviour: 'filter' as const },
      { id: 'm-s', name: 'Siphon', position: 2, hidden: false, builtin: null, behaviour: 'filter' as const },
    ];
    const withSiphon = [brewer('V60', 'filter', null, 'm-f'), brewer('TCA', 'filter', null, 'm-s')];
    const groups = addOptions(menu, 's1', drinks, [milk, special], withSiphon, methods).brewers;
    expect(groups.map((g) => [g.name, g.options.map((x) => x.name)])).toEqual([['Filter', ['V60']], ['Siphon', ['TCA']]]);
    const source = { name: 'TCA', description: null, kind: 'filter' as const, method: 'Siphon', archived: false };
    expect(showsAs(item('s', { itemType: 'brewer', source }))).toBe('Siphon, plain brew · shows its own name, no description');
  });

  it('builds the batch in picker order, skipping what is already here and a beans block placed elsewhere', () => {
    const picked = new Set(['Linea', 'V60', 'Tonic', 'Vanilla Latte', 'Latte']);
    expect(addRequest(o, picked, true)).toEqual([
      { itemType: 'drink', drinkId: 'Vanilla Latte' },
      { itemType: 'drink', drinkId: 'Tonic' },
      { itemType: 'brewer', brewerId: 'V60' },
    ]);
    const empty = addOptions({ title: null, currency: null, sections: [{ ...menu.sections[0]!, items: [] }] }, 's1', [], [], []);
    expect(addRequest(empty, new Set(), true)).toEqual([{ itemType: 'beans' }]);
  });
});

describe('canMoveTo', () => {
  it('refuses a move that would put the same drink twice in a section', () => {
    const twice: Menu = { ...menu, sections: [menu.sections[0]!, { ...menu.sections[1]!, items: [...menu.sections[1]!.items, item('i5', { drinkId: 'Latte' })] }] };
    expect(canMoveTo(twice, 'i5', 's1')).toBe(false);
    expect(canMoveTo(twice, 'i4', 's1')).toBe(true);
    expect(canMoveTo(twice, 'i3', 's1')).toBe(true); // the beans block has no source
    expect(canMoveTo(twice, 'i1', 's1')).toBe(true); // within its own section
  });
});

describe('showsAs', () => {
  it('says what an item shows on the menu', () => {
    const source = { name: 'Latte', description: 'Double shot', kind: 'espresso' as const, method: 'Espresso', archived: false };
    expect(showsAs(item('a', { source }))).toBe('Espresso drink · shows its own name, its own description');
    expect(showsAs(item('b', { source, name: 'House latte', description: 'Oat milk' }))).toBe(
      'Espresso drink · shows as “House latte” (its own name: Latte), its menu description',
    );
  });
});

describe('duplicateSection', () => {
  it('names the section a drag left with a drink twice', () => {
    expect(duplicateSection(menu.sections)).toBeNull();
    const dragged = [{ ...menu.sections[0]!, items: [...menu.sections[0]!.items, item('i9', { drinkId: 'Latte' })] }];
    expect(duplicateSection(dragged)).toBe('Espresso');
  });
});

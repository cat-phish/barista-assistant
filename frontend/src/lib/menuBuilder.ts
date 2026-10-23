// The menu builder's add picker and drag rules (docs/api/menu.md §7b).
// Unit-tested in menuBuilder.test.ts.
import type { NewMenuItem } from '../api/menu';
import type { Brewer, Drink, DrinkCategory, Menu, MenuItem, MethodKind, BrewerMethod } from '../api/types';
import { nestDrinks } from './drinks';
import { METHOD_KINDS, METHOD_ORDER } from './equipment';

export interface AddOption {
  id: string; // the drink or brewer
  name: string;
  depth: number; // variants nest under their parent
  here: boolean; // already in this section (shown ticked, can't be added again)
  elsewhere: string[]; // the other sections it's in
}
export interface AddGroup {
  key: string; // a category id, 'other', or a method
  name: string;
  options: AddOption[];
}
export interface AddOptions {
  drinks: AddGroup[]; // by drink category in order, then "Other drinks"
  brewers: AddGroup[]; // plain brews, by method
  beans: { here: boolean; elsewhere: string | null }; // the menu's one beans block
}

const sourceOf = (i: MenuItem) => i.drinkId ?? i.brewerId;

// What can be added to a section: active drinks and brewers, grouped, with
// what's already on the menu marked.
export function addOptions(menu: Menu, sectionId: string, drinks: Drink[], categories: DrinkCategory[], brewers: Brewer[], methods: BrewerMethod[] = []): AddOptions {
  const where = new Map<string, string[]>(); // source id -> section names
  for (const s of menu.sections) for (const i of s.items) {
    const id = sourceOf(i);
    if (id) where.set(id, [...(where.get(id) ?? []), s.id]);
  }
  const sectionName = new Map(menu.sections.map((s) => [s.id, s.name]));
  const option = (id: string, name: string, depth = 0): AddOption => {
    const ids = where.get(id) ?? [];
    return { id, name, depth, here: ids.includes(sectionId), elsewhere: ids.filter((x) => x !== sectionId).map((x) => sectionName.get(x) ?? '') };
  };

  const active = drinks.filter((d) => !d.archivedAt);
  const ordered = [...categories].sort((a, b) => a.position - b.position);
  const drinkGroup = (key: string, name: string, list: Drink[]): AddGroup => ({
    key,
    name,
    options: nestDrinks(list).map(({ drink, depth }) => option(drink.id, drink.name, depth)),
  });
  const drinkGroups = [
    ...ordered.map((c) => drinkGroup(c.id, c.name, active.filter((d) => d.category?.id === c.id))),
    drinkGroup('other', 'Other drinks', active.filter((d) => !d.category)),
  ].filter((g) => g.options.length > 0);

  // Plain brews by the workspace's methods in order (docs/api/brewer-methods.md
  // §3e); a brewer without one goes under its kind's name.
  const usable = brewers.filter((b) => !b.archivedAt);
  const groups = [
    ...[...methods].sort((x, y) => x.position - y.position).map((m) => ({ key: m.id, name: m.name })),
    ...METHOD_ORDER.map((kind: MethodKind) => ({ key: kind as string, name: METHOD_KINDS[kind].label })),
  ];
  const brewerGroups = groups
    .map((g) => ({
      ...g,
      options: usable
        .filter((b) => (b.methodId ?? b.kind) === g.key)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => option(b.id, b.name)),
    }))
    .filter((g) => g.options.length > 0);

  const beansIn = menu.sections.find((s) => s.items.some((i) => i.itemType === 'beans'));
  return {
    drinks: drinkGroups,
    brewers: brewerGroups,
    beans: { here: beansIn?.id === sectionId, elsewhere: beansIn && beansIn.id !== sectionId ? beansIn.name : null },
  };
}

// The batch to send, in the picker's order: drinks, then plain brews, then
// the beans block.
export function addRequest(options: AddOptions, picked: ReadonlySet<string>, beans: boolean): NewMenuItem[] {
  const take = (groups: AddGroup[]) => groups.flatMap((g) => g.options.filter((o) => !o.here && picked.has(o.id)).map((o) => o.id));
  return [
    ...take(options.drinks).map((drinkId) => ({ itemType: 'drink' as const, drinkId })),
    ...take(options.brewers).map((brewerId) => ({ itemType: 'brewer' as const, brewerId })),
    ...(beans && !options.beans.here && !options.beans.elsewhere ? [{ itemType: 'beans' as const }] : []),
  ];
}

// Moving an item into a section is refused if that drink or brewer is
// already there (the API refuses it too).
export function canMoveTo(menu: Menu, itemId: string, sectionId: string): boolean {
  const item = menu.sections.flatMap((s) => s.items).find((i) => i.id === itemId);
  const target = menu.sections.find((s) => s.id === sectionId);
  if (!item || !target) return false;
  const id = sourceOf(item);
  return !id || !target.items.some((i) => i.id !== item.id && sourceOf(i) === id);
}

// "Shows as House latte (its own name: Latte)", or what it shows by default.
export function showsAs(i: MenuItem): string {
  if (i.itemType === 'beans') return 'Lists your active beans that have "Show on the public menu" on';
  if (!i.source) return 'Its drink or brewer is gone';
  const what = i.itemType === 'drink' ? `${i.source.method} drink` : `${i.source.method}, plain brew`;
  const name = i.name && i.name !== i.source.name ? `shows as “${i.name}” (its own name: ${i.source.name})` : 'shows its own name';
  const description = i.description ? 'its menu description' : i.source.description ? 'its own description' : 'no description';
  return `${what} · ${name}, ${description}`;
}

// After a drag: the first section that now has a drink or brewer twice, if any.
export function duplicateSection(sections: Array<{ name: string; items: MenuItem[] }>): string | null {
  for (const s of sections) {
    const ids = s.items.flatMap((i) => (sourceOf(i) ? [sourceOf(i)] : []));
    if (new Set(ids).size !== ids.length) return s.name;
  }
  return null;
}

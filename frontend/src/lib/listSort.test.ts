import { describe, expect, it } from 'vitest';
import { formatAdded } from './format';
import { addedColumn, ariaSort, enumColumn, isSortKey, nameColumn, sortArrow, sortBy, sortColumnOptions, sortsByName, toggleHeader, type SortColumns } from './listSort';

interface Item {
  name: string;
  createdAt: string;
  kind: 'pour_over' | 'immersion' | 'espresso' | null;
  burr: string | null;
}
const item = (name: string, createdAt: string, kind: Item['kind'], burr: string | null = null): Item => ({ name, createdAt, kind, burr });
const items = [
  item('b latte', '2026-10-20T10:00:00.000Z', 'espresso', 'flat'),
  item('Atlas', '2026-10-21T10:00:00.000Z', 'pour_over'),
  item('cortado', '2026-10-19T10:00:00.000Z', null, 'conical'),
  item('Drip', '2026-10-18T10:00:00.000Z', 'immersion', 'conical'),
];
const columns: SortColumns<Item> = {
  name: nameColumn(),
  kind: enumColumn('Type', ['pour_over', 'immersion', 'espresso'] as const, (x) => x.kind),
  burr: { label: 'Burrs', value: (x) => x.burr },
  added: addedColumn(),
};
const names = (key: string) => sortBy(items, key, columns).map((i) => i.name);

describe('list sorting', () => {
  it('sorts by date added either way, and by name ignoring case', () => {
    expect(names('added_desc')).toEqual(['Atlas', 'b latte', 'cortado', 'Drip']);
    expect(names('added_asc')).toEqual(['Drip', 'cortado', 'b latte', 'Atlas']);
    expect(names('name_asc')).toEqual(['Atlas', 'b latte', 'cortado', 'Drip']);
    expect(names('name_desc')).toEqual(['Drip', 'cortado', 'b latte', 'Atlas']);
    expect(items[0]?.name).toBe('b latte'); // the input isn't reordered
  });

  it('sorts a fixed set in its own order, with unset values last either way', () => {
    expect(names('kind_asc')).toEqual(['Atlas', 'Drip', 'b latte', 'cortado']);
    expect(names('kind_desc')).toEqual(['b latte', 'Drip', 'Atlas', 'cortado']);
    expect(names('burr_asc')).toEqual(['cortado', 'Drip', 'b latte', 'Atlas']); // ties by name
    expect(names('burr_desc')).toEqual(['b latte', 'cortado', 'Drip', 'Atlas']);
  });

  it('falls back to name order for an unknown column', () => {
    expect(names('price_asc')).toEqual(['Atlas', 'b latte', 'cortado', 'Drip']);
  });

  it('builds the Sort by and Order dropdowns, with each direction worded for its column', () => {
    expect(sortColumnOptions(columns).map((o) => `${o.value}=${o.label}: ${o.asc} / ${o.desc}`)).toEqual([
      'name=Name: Ascending (A–Z) / Descending (Z–A)',
      'kind=Type: Ascending (A–Z) / Descending (Z–A)',
      'burr=Burrs: Ascending (A–Z) / Descending (Z–A)',
      'added=Added: Ascending (oldest first) / Descending (newest first)',
    ]);
  });

  it('headers sort on the first click and flip on the next', () => {
    expect(toggleHeader('added_desc', 'name', columns)).toBe('name_asc');
    expect(toggleHeader('name_asc', 'name', columns)).toBe('name_desc');
    expect(toggleHeader('name_desc', 'name', columns)).toBe('name_asc');
    expect(toggleHeader('name_asc', 'added', columns)).toBe('added_desc');
    expect(toggleHeader('added_desc', 'added', columns)).toBe('added_asc');
    expect(toggleHeader('added_desc', 'kind', columns)).toBe('kind_asc');
    expect(ariaSort('name_desc', 'name')).toBe('descending');
    expect(ariaSort('name_desc', 'added')).toBe('none');
    expect(sortArrow('kind_asc', 'kind')).toBe('▲');
    expect(sortArrow('kind_asc', 'name')).toBe('');
    expect(sortsByName('name_desc')).toBe(true);
    expect(sortsByName('added_desc')).toBe(false);
  });

  it("only restores keys for this view's columns", () => {
    expect(isSortKey('name_asc', columns)).toBe(true);
    expect(isSortKey('burr_desc', columns)).toBe(true);
    expect(isSortKey('category_asc', columns)).toBe(false); // another view's column
    expect(isSortKey('name_sideways', columns)).toBe(false);
    expect(isSortKey(null, columns)).toBe(false);
  });

  it('shows the year only outside the current one', () => {
    const now = new Date('2026-10-21T12:00:00');
    expect(formatAdded('2026-10-19T12:00:00', now)).not.toMatch(/2026/);
    expect(formatAdded('2025-03-02T12:00:00', now)).toMatch(/2025/);
  });
});

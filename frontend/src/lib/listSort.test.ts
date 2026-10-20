import { describe, expect, it } from 'vitest';
import { formatAdded } from './format';
import { ariaSort, isSortKey, sortItems, toggleHeader } from './listSort';

const items = [
  { name: 'b latte', createdAt: '2026-10-20T10:00:00.000Z' },
  { name: 'Atlas', createdAt: '2026-10-21T10:00:00.000Z' },
  { name: 'cortado', createdAt: '2026-10-19T10:00:00.000Z' },
];
const names = (key: Parameters<typeof sortItems>[1]) => sortItems(items, key).map((i) => i.name);

describe('list sorting', () => {
  it('sorts by date added either way, and by name ignoring case', () => {
    expect(names('added_desc')).toEqual(['Atlas', 'b latte', 'cortado']);
    expect(names('added_asc')).toEqual(['cortado', 'b latte', 'Atlas']);
    expect(names('name_asc')).toEqual(['Atlas', 'b latte', 'cortado']);
    expect(names('name_desc')).toEqual(['cortado', 'b latte', 'Atlas']);
    expect(items[0]?.name).toBe('b latte'); // the input isn't reordered
  });

  it('breaks date ties by name', () => {
    const tied = [{ name: 'Zed', createdAt: 'x' }, { name: 'Alpha', createdAt: 'x' }];
    expect(sortItems(tied, 'added_asc').map((i) => i.name)).toEqual(['Alpha', 'Zed']);
  });

  it('headers sort on the first click and flip on the next', () => {
    expect(toggleHeader('added_desc', 'name')).toBe('name_asc');
    expect(toggleHeader('name_asc', 'name')).toBe('name_desc');
    expect(toggleHeader('name_desc', 'name')).toBe('name_asc');
    expect(toggleHeader('name_asc', 'added')).toBe('added_desc');
    expect(toggleHeader('added_desc', 'added')).toBe('added_asc');
    expect(ariaSort('name_desc', 'name')).toBe('descending');
    expect(ariaSort('name_desc', 'added')).toBe('none');
    expect(ariaSort('added_asc', 'added')).toBe('ascending');
  });

  it('only accepts known keys when restoring', () => {
    expect(isSortKey('name_asc')).toBe(true);
    expect(isSortKey('price')).toBe(false);
    expect(isSortKey(null)).toBe(false);
  });

  it('shows the year only outside the current one', () => {
    const now = new Date('2026-10-21T12:00:00');
    expect(formatAdded('2026-10-19T12:00:00', now)).not.toMatch(/2026/);
    expect(formatAdded('2025-03-02T12:00:00', now)).toMatch(/2025/);
  });
});

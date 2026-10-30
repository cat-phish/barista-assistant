import { describe, expect, it } from 'vitest';
import { reorderVisible } from './reorder';

const items = [
  { id: 'archived-first', archived: true },
  { id: 'a', archived: false },
  { id: 'archived-middle', archived: true },
  { id: 'b', archived: false },
  { id: 'c', archived: false },
  { id: 'archived-last', archived: true },
];
const visible = items.filter((item) => !item.archived);
const ids = (list: typeof items) => list.map((item) => item.id);

describe('reorderVisible', () => {
  it('keeps hidden archived entries in their slots, moving forwards and backwards', () => {
    const moved = reorderVisible(items, visible, 0, 2);
    expect(ids(moved)).toEqual(['archived-first', 'b', 'archived-middle', 'c', 'a', 'archived-last']);
    expect(reorderVisible(moved, moved.filter((item) => !item.archived), 2, 0)).toEqual(items);
    expect(ids(items)).toEqual(['archived-first', 'a', 'archived-middle', 'b', 'c', 'archived-last']);
    expect(new Set(ids(moved))).toEqual(new Set(ids(items)));
  });

  it('allows archived entries to move when shown', () => {
    expect(ids(reorderVisible(items, items, 0, 5))).toEqual(['a', 'archived-middle', 'b', 'c', 'archived-last', 'archived-first']);
  });

  it('supports lists with every entry visible, including brew problems', () => {
    expect(ids(reorderVisible(visible, visible, 2, 0))).toEqual(['c', 'a', 'b']);
  });

  it.each([[0, 0], [-1, 1], [0, -1], [0, 3], [3, 0], [0.5, 1], [0, NaN]])('ignores unchanged or invalid moves (%s → %s)', (from, to) => {
    expect(reorderVisible(items, visible, from, to)).toEqual(items);
  });

  it('leaves empty, single-item and fully hidden lists alone', () => {
    expect(reorderVisible([], [], 0, 1)).toEqual([]);
    expect(reorderVisible(items, [], 0, 1)).toEqual(items);
    expect(reorderVisible(items.slice(0, 1), items.slice(0, 1), 0, 1)).toEqual(items.slice(0, 1));
  });
});

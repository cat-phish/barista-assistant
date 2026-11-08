import { describe, expect, it } from 'vitest';
import { defaultChoice, normalizeChoice, sameChoice, shownColumns, useTableColumns, type TableColumn } from './tableColumns';
import { parseKeyedWidths } from './columnWidths';
import { addedColumn, nameColumn, type SortColumns } from './listSort';

const columns: TableColumn[] = [
  { id: 'name', label: 'Name', track: '2fr' },
  { id: 'a', label: 'A', track: '1fr' },
  { id: 'b', label: 'B', track: '1fr', phone: false },
  { id: 'c', label: 'C', track: '1fr', wide: false },
  { id: 'added', label: 'Added', track: '5rem', end: true },
];
const ids = (cols: TableColumn[]) => cols.map((c) => c.id);

describe('table columns', () => {
  it('starts from each layout’s defaults', () => {
    expect(defaultChoice(columns, 'wide')).toEqual({ order: ['a', 'b', 'c', 'added'], hidden: ['c'] });
    expect(defaultChoice(columns, 'phone')).toEqual({ order: ['a', 'b', 'c', 'added'], hidden: ['b', 'c'] });
  });

  it('always shows the name first', () => {
    expect(ids(shownColumns(columns, { order: ['added', 'a', 'b', 'c'], hidden: ['a', 'b', 'c', 'added'] }))).toEqual(['name']);
    expect(ids(shownColumns(columns, { order: ['added', 'a', 'b', 'c'], hidden: ['b'] }))).toEqual(['name', 'added', 'a', 'c']);
  });

  it('drops a column the workspace hides, whatever the choice', () => {
    expect(ids(shownColumns(columns, defaultChoice(columns, 'wide'), (id) => id !== 'a'))).toEqual(['name', 'b', 'added']);
  });

  it('fits a saved choice to the table', () => {
    // An unknown column goes; a new one comes in after the one it follows, as its default.
    expect(normalizeChoice({ order: ['added', 'gone', 'a'], hidden: ['a', 'gone'] }, columns, 'wide')).toEqual({ order: ['added', 'a', 'b', 'c'], hidden: ['a', 'c'] });
    expect(normalizeChoice({ order: ['b', 'a', 'a'], hidden: [] }, columns, 'phone')).toEqual({ order: ['b', 'c', 'added', 'a'], hidden: ['c'] });
    expect(normalizeChoice('nonsense', columns, 'wide')).toEqual(defaultChoice(columns, 'wide'));
    expect(normalizeChoice({ order: 'a' }, columns, 'wide')).toEqual(defaultChoice(columns, 'wide'));
  });

  it('compares choices regardless of the hidden list’s order', () => {
    expect(sameChoice({ order: ['a', 'b'], hidden: ['b', 'a'] }, { order: ['a', 'b'], hidden: ['a', 'b'] })).toBe(true);
    expect(sameChoice({ order: ['b', 'a'], hidden: [] }, { order: ['a', 'b'], hidden: [] })).toBe(false);
  });
});

describe('column widths by id', () => {
  const all = ['name', 'a', 'added'];
  it('reads widths saved by id', () => {
    expect(parseKeyedWidths('{"a":200,"gone":90,"added":"x"}', all)).toEqual({ a: 200 });
  });
  it('reads widths saved by position against the default order', () => {
    expect(parseKeyedWidths('[300,null,120]', all)).toEqual({ name: 300, added: 120 });
    expect(parseKeyedWidths('[300,null]', all)).toEqual({});
    expect(parseKeyedWidths('not json', all)).toEqual({});
  });
});

// Every column sorts: a table column without a sort column doesn't compile.
// Checked by the type check (npm run build); never run (it needs a component).
export function everyColumnSorts(): void {
  interface Item {
    name: string;
    createdAt: string;
    size: number;
  }
  const sorts = { name: nameColumn(), added: addedColumn() } satisfies SortColumns<Item>;
  const workspace = () => 'ws';
  useTableColumns({ key: 't', workspace, sortColumns: sorts, columns: [{ id: 'name', label: 'Name', track: '1fr' }, { id: 'added', label: 'Added', track: '1fr' }] });
  const table: TableColumn<keyof typeof sorts>[] = [{ id: 'name', label: 'Name', track: '1fr' }];
  useTableColumns({ key: 't', workspace, sortColumns: { ...sorts, size: { label: 'Size', value: (i: Item) => i.size } }, columns: table });
  // A column with no sort column.
  // @ts-expect-error 'size' is missing from sortColumns
  useTableColumns({ key: 't', workspace, sortColumns: sorts, columns: [{ id: 'name', label: 'Name', track: '1fr' }, { id: 'size', label: 'Size', track: '1fr' }] });
  // Ids widened to string (a `: TableColumn[]` annotation) can't be checked, so they don't compile either.
  const widened: TableColumn[] = [{ id: 'name', label: 'Name', track: '1fr' }];
  // @ts-expect-error the column ids must be literal
  useTableColumns({ key: 't', workspace, sortColumns: sorts, columns: widened });
}

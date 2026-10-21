// Sorting and remembering list views (Recipes, Drinks, Brewers, Grinders).
// A sort is a column and a direction, written "<column>_<asc|desc>" so it fits
// a <select> and localStorage. The column headers and the Sort dropdown share
// one key.
export type SortDir = 'asc' | 'desc';
export type SortKey<C extends string = string> = `${C}_${SortDir}`;

// A sortable column: how to read its value (null = not set, always last) and
// how its directions read in the dropdown.
export interface SortColumn<T> {
  label: string; // "Name", "Type"
  value: (item: T) => string | number | null;
  asc?: string; // dropdown wording, default "<label> A–Z"
  desc?: string;
  firstDir?: SortDir; // a header's first click (dates: newest first)
}
export type SortColumns<T, C extends string = string> = Record<C, SortColumn<T>>;

interface Named {
  name: string;
}
interface Dated extends Named {
  createdAt: string;
}

export const nameColumn = <T extends Named>(): SortColumn<T> => ({ label: 'Name', value: (x) => x.name, asc: 'Name A–Z', desc: 'Name Z–A' });
export const addedColumn = <T extends Dated>(): SortColumn<T> => ({
  label: 'Added',
  value: (x) => x.createdAt,
  asc: 'Oldest first',
  desc: 'Newest first',
  firstDir: 'desc',
});
// A column of a fixed set of values, sorted in that order (not alphabetically):
// filter → espresso.
export function enumColumn<T, V extends string>(label: string, order: readonly V[], value: (item: T) => V | null): SortColumn<T> {
  return { label, value: (x) => { const v = value(x); return v === null ? null : order.indexOf(v); } };
}

export function parseSortKey(key: string): { column: string; dir: SortDir } | null {
  const m = /^(.+)_(asc|desc)$/.exec(key);
  return m ? { column: m[1]!, dir: m[2] as SortDir } : null;
}

export function sortBy<T extends Named>(items: readonly T[], key: string, columns: SortColumns<T>): T[] {
  const parsed = parseSortKey(key);
  const column = parsed ? columns[parsed.column] : undefined;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (!parsed || !column) return [...items].sort(byName);
  const sign = parsed.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = column.value(a);
    const vb = column.value(b);
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1; // not set: last either way
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
    return sign * c || byName(a, b);
  });
}

// The dropdown's entries, e.g. "Name A–Z", "Type Z–A", "Newest first".
export function sortOptions<T>(columns: SortColumns<T>): Array<{ value: string; label: string }> {
  return Object.entries(columns).flatMap(([id, c]) => {
    const dirs: SortDir[] = c.firstDir === 'desc' ? ['desc', 'asc'] : ['asc', 'desc'];
    return dirs.map((d) => ({ value: `${id}_${d}`, label: (d === 'asc' ? c.asc : c.desc) ?? `${c.label} ${d === 'asc' ? 'A–Z' : 'Z–A'}` }));
  });
}

export function isSortKey<T>(value: unknown, columns: SortColumns<T>): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parseSortKey(value);
  return !!parsed && parsed.column in columns;
}

// Clicking a column header: the first click sorts it (A–Z, or newest first
// for dates), clicking again flips it.
export function toggleHeader<T>(current: string, column: string, columns: SortColumns<T>): string {
  const parsed = parseSortKey(current);
  const first = columns[column]?.firstDir ?? 'asc';
  if (parsed?.column !== column) return `${column}_${first}`;
  return `${column}_${parsed.dir === 'asc' ? 'desc' : 'asc'}`;
}

export function ariaSort(current: string, column: string): 'ascending' | 'descending' | 'none' {
  const parsed = parseSortKey(current);
  if (parsed?.column !== column) return 'none';
  return parsed.dir === 'asc' ? 'ascending' : 'descending';
}
// The ▲ / ▼ shown next to a sorted header.
export function sortArrow(current: string, column: string): string {
  const state = ariaSort(current, column);
  return state === 'ascending' ? '▲' : state === 'descending' ? '▼' : '';
}
// A header button's label: "Name, sorted ascending, click to reverse".
export function sortLabel(current: string, column: string, label: string): string {
  const state = ariaSort(current, column);
  return `${label}, ${state === 'none' ? 'click to sort' : `sorted ${state}, click to reverse`}`;
}

export const sortsByName = (key: string) => parseSortKey(key)?.column === 'name';

// A per-workspace view preference in localStorage (filter, sort). Storage can
// be unavailable (private mode): then it just isn't remembered.
export function recallView(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function rememberView(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering is fine.
  }
}

// Sorting and remembering list views (Recipes, Drinks): by date added or by
// name, each way. The column headers and the sort dropdown share one key.
export type SortKey = 'added_desc' | 'added_asc' | 'name_asc' | 'name_desc';
export const SORT_LABELS: Record<SortKey, string> = {
  added_desc: 'Newest first',
  added_asc: 'Oldest first',
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
};
export const isSortKey = (v: unknown): v is SortKey => typeof v === 'string' && v in SORT_LABELS;

export function sortItems<T extends { name: string; createdAt: string }>(items: readonly T[], key: SortKey): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const byAdded = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt) || byName(a, b);
  const compare = {
    added_desc: (a: T, b: T) => byAdded(b, a),
    added_asc: byAdded,
    name_asc: byName,
    name_desc: (a: T, b: T) => byName(b, a),
  }[key];
  return [...items].sort(compare);
}

export const sortsByName = (key: SortKey) => key === 'name_asc' || key === 'name_desc';

// Clicking a column header: the first click sorts it (names A–Z, dates newest
// first), clicking again flips it.
export function toggleHeader(current: SortKey, column: 'name' | 'added'): SortKey {
  if (column === 'name') return current === 'name_asc' ? 'name_desc' : 'name_asc';
  return current === 'added_desc' ? 'added_asc' : 'added_desc';
}

// aria-sort for a column header.
export function ariaSort(current: SortKey, column: 'name' | 'added'): 'ascending' | 'descending' | 'none' {
  if (!current.startsWith(column)) return 'none';
  return current.endsWith('asc') ? 'ascending' : 'descending';
}

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

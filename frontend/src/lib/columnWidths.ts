// Resizable list-table columns (Beans, Recipes, Grinders, …). A table's
// columns are one CSS grid (`--cols` on .data-table); a column the person
// drags gets a pixel width, the rest keep their default track. Widths are
// remembered per list on the device, like the sort (recallView), by column,
// for the columns tableColumns.ts shows.
import { computed, reactive, ref, watch } from 'vue';
import { forgetView, recallView, rememberView } from './listSort';

export const MIN_COLUMN_PX = 40;
export const MAX_COLUMN_PX = 800;

export const clampWidth = (px: number): number => Math.round(Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, px)));

// Widths for the shown columns, in order: null = the default track.
export type ColumnWidths = Array<number | null>;

export const isResized = (widths: ColumnWidths): boolean => widths.some((w) => w !== null);

// The grid template. A resized column may give up space when the window is
// too narrow (minmax from the floor up to its width); once any column is
// resized, the flexible ones keep the floor too, so they can't vanish.
export function colsTemplate(tracks: readonly string[], widths: ColumnWidths): string {
  if (!isResized(widths)) return tracks.join(' ');
  const floor = `${MIN_COLUMN_PX}px`;
  return tracks
    .map((track, i) => {
      const w = widths[i];
      if (w !== null && w !== undefined) return `minmax(${floor}, ${w}px)`;
      return track.replace(/^minmax\(0,/, `minmax(${floor},`);
    })
    .join(' ');
}

// What the resize handles (ColumnResizers) work on: the shown columns by position.
export interface ColumnWidthsState {
  readonly widths: ColumnWidths;
  setWidth(index: number, px: number, persist?: boolean): void;
  save(): void;
}

// Widths saved by column id, so a column keeps its width when columns are
// hidden or moved (tableColumns.ts). Widths saved by position before that
// are read against the table's default order.
export type KeyedWidths = Record<string, number>;
export function parseKeyedWidths(raw: string | null, ids: readonly string[]): KeyedWidths {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const out: KeyedWidths = {};
  const keep = (id: string, w: unknown) => {
    if (ids.includes(id) && typeof w === 'number' && Number.isFinite(w)) out[id] = clampWidth(w);
  };
  if (Array.isArray(parsed)) {
    if (parsed.length === ids.length) parsed.forEach((w: unknown, i) => keep(ids[i]!, w));
  } else if (parsed && typeof parsed === 'object') {
    for (const [id, w] of Object.entries(parsed)) keep(id, w);
  }
  return out;
}

// `columns`: every column, `shown`: the ones on screen in order. The
// resize handles work on the shown columns' positions.
export function useKeyedColumnWidths(key: () => string, columns: ReadonlyArray<{ id: string; track: string }>, shown: () => ReadonlyArray<{ id: string; track: string }>) {
  const ids = columns.map((c) => c.id);
  const saved = ref<KeyedWidths>({});
  watch(key, (k) => (saved.value = parseKeyedWidths(recallView(k), ids)), { immediate: true });
  const widths = computed<ColumnWidths>(() => shown().map((c) => saved.value[c.id] ?? null));

  function save(): void {
    if (Object.keys(saved.value).length) rememberView(key(), JSON.stringify(saved.value));
    else forgetView(key());
  }
  return reactive({
    widths,
    template: computed(() => colsTemplate(shown().map((c) => c.track), widths.value)),
    // Only the shown columns count: a hidden one's width waits for it.
    resized: computed(() => isResized(widths.value)),
    setWidth(index: number, px: number, persist = true): void {
      const c = shown()[index];
      if (!c) return;
      saved.value = { ...saved.value, [c.id]: clampWidth(px) };
      if (persist) save();
    },
    save,
    reset(): void {
      saved.value = {};
      save();
    },
  });
}

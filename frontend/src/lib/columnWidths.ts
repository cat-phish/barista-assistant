// Resizable list-table columns (Beans, Recipes, Grinders, …). A table's
// columns are one CSS grid (`--cols` on .data-table); a column the person
// drags gets a pixel width, the rest keep their default track. Widths are
// remembered per list on the device, like the sort (recallView).
import { computed, reactive, ref, watch } from 'vue';
import { forgetView, recallView, rememberView } from './listSort';

export const MIN_COLUMN_PX = 40;
export const MAX_COLUMN_PX = 800;

export const clampWidth = (px: number): number => Math.round(Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, px)));

// Saved widths: one entry per column, null = default. Anything that doesn't
// fit the table (a column added or removed since) is dropped.
export type ColumnWidths = Array<number | null>;

export function parseWidths(raw: string | null, count: number): ColumnWidths {
  const none: ColumnWidths = Array.from({ length: count }, () => null);
  if (!raw) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return none;
  }
  if (!Array.isArray(parsed) || parsed.length !== count) return none;
  return parsed.map((w: unknown) => (typeof w === 'number' && Number.isFinite(w) ? clampWidth(w) : null));
}

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

// One table's widths. `key` is its localStorage key (it can change with the
// workspace); `tracks` its default columns, one entry per column.
export function useColumnWidths(key: () => string, tracks: readonly string[]) {
  const widths = ref<ColumnWidths>(parseWidths(null, tracks.length));
  watch(key, (k) => (widths.value = parseWidths(recallView(k), tracks.length)), { immediate: true });

  function save(): void {
    if (isResized(widths.value)) rememberView(key(), JSON.stringify(widths.value));
    else forgetView(key());
  }
  return reactive({
    widths,
    template: computed(() => colsTemplate(tracks, widths.value)),
    resized: computed(() => isResized(widths.value)),
    // While dragging, save = false: the width shows at once and is
    // remembered when the drag ends (save()).
    setWidth(index: number, px: number, persist = true): void {
      if (index < 0 || index >= tracks.length) return;
      const next = [...widths.value];
      next[index] = clampWidth(px);
      widths.value = next;
      if (persist) save();
    },
    save,
    reset(): void {
      widths.value = parseWidths(null, tracks.length);
      save();
    },
  });
}
export type ColumnWidthsState = ReturnType<typeof useColumnWidths>;

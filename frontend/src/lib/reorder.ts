// Reorder the visible slots only; archived items hidden from the list stay
// in place. Both reorder endpoints require every ID (docs/api/prep-tools.md
// §3d and docs/api/brew-problems.md §6b).
export function reorderVisible<T extends { id: string }>(items: readonly T[], visible: readonly T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= visible.length || to >= visible.length) return [...items];
  const ordered = [...visible];
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved!);
  const ids = new Set(visible.map((item) => item.id));
  let index = 0;
  return items.map((item) => ids.has(item.id) ? ordered[index++]! : item);
}

export interface DragUpdate {
  item: HTMLElement;
  from: HTMLElement;
  oldIndex?: number;
  newIndex?: number;
}
// With custom-update, Sortable's DOM move stays in place. Put the row back
// (as vue-draggable-plus does without custom-update) so the rows on screen
// only ever come from state, even when the move is refused.
export function undoDragMove({ item, from, oldIndex }: DragUpdate): void {
  if (oldIndex === undefined) return;
  item.remove();
  from.insertBefore(item, from.children[oldIndex] ?? null);
}

export function releaseReorderFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) active.blur();
}

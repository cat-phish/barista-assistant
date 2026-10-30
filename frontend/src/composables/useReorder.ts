// Drag and ↑/↓ reordering for a list (prep items, brew problems): moves
// the visible rows in `items` straight away, saves, and puts the old order
// back if the save is refused. Announces the move and keeps focus on the
// moved row's handle, in the template's ref="reorder-list"
// (docs/api/prep-tools.md §3d, docs/api/brew-problems.md §6b).
import { nextTick, ref, useTemplateRef, type Ref } from 'vue';
import { type DragUpdate, reorderVisible, undoDragMove } from '../lib/reorder';

export function useReorder<T extends { id: string; name: string }>(options: {
  items: Ref<T[]>; // the whole order, hidden rows too
  visible: () => readonly T[]; // the rows on screen, in order
  disabled: () => boolean;
  save: (next: T[]) => Promise<boolean>; // false when refused
}) {
  const { items, visible, disabled, save } = options;
  const list = useTemplateRef<{ $el: HTMLElement }>('reorder-list'); // the VueDraggable
  const announcement = ref('');

  async function reorder(from: number, to: number): Promise<void> {
    if (disabled()) return;
    const previous = items.value;
    const moved = visible()[from];
    const next = reorderVisible(previous, visible(), from, to);
    if (!moved || next.every((item, i) => item.id === previous[i]?.id)) return;
    items.value = next;
    if (await save(next)) announcement.value = `${moved.name} moved to position ${to + 1} of ${visible().length}`;
    else items.value = previous;
    await nextTick();
    list.value?.$el.querySelector<HTMLElement>(`[data-reorder-id="${moved.id}"] .reorder-handle`)?.focus();
  }
  function onDragUpdate(event: DragUpdate): void {
    undoDragMove(event);
    if (event.oldIndex !== undefined && event.newIndex !== undefined) void reorder(event.oldIndex, event.newIndex);
  }
  function move(index: number, by: -1 | 1): void {
    void reorder(index, index + by);
  }
  return { announcement, onDragUpdate, move };
}

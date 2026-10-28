import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useReorder } from './useReorder';

const rows = () => [
  { id: 'a', name: 'Rinse', archived: false },
  { id: 'x', name: 'Old', archived: true },
  { id: 'b', name: 'Preheat', archived: false },
  { id: 'c', name: 'Tare', archived: false },
];
const ids = (list: Array<{ id: string }>) => list.map((item) => item.id);
// What Sortable hands over after a drop: the row is already moved on screen.
function dragged(oldIndex: number, newIndex: number) {
  const item = { remove: vi.fn() } as unknown as HTMLElement;
  const from = { children: [] as unknown as HTMLCollection, insertBefore: vi.fn() } as unknown as HTMLElement;
  return { item, from, oldIndex, newIndex };
}

function setup(save: (next: ReturnType<typeof rows>) => Promise<boolean>, disabled = false) {
  const items = ref(rows());
  const reorder = useReorder({ items, visible: () => items.value.filter((t) => !t.archived), disabled: () => disabled, save });
  return { items, ...reorder };
}

describe('useReorder', () => {
  it('moves the visible rows, keeps hidden ones in place and announces the move', async () => {
    const save = vi.fn(async (_next: ReturnType<typeof rows>) => true);
    const { items, move, announcement } = setup(save);
    move(0, 1);
    expect(ids(items.value)).toEqual(['b', 'x', 'a', 'c']);
    await vi.waitFor(() => expect(announcement.value).toBe('Rinse moved to position 2 of 3'));
    expect(ids(save.mock.calls[0]![0])).toEqual(['b', 'x', 'a', 'c']);
  });

  it('puts the saved order back when a drop is refused, and undoes the DOM move', async () => {
    let refuse!: (ok: boolean) => void;
    const { items, onDragUpdate, announcement } = setup(() => new Promise((resolve) => { refuse = resolve; }));
    const event = dragged(2, 0);
    onDragUpdate(event);
    expect(event.item.remove).toHaveBeenCalled();
    expect(event.from.insertBefore).toHaveBeenCalledWith(event.item, null);
    expect(ids(items.value)).toEqual(['c', 'x', 'a', 'b']);
    refuse(false);
    await vi.waitFor(() => expect(ids(items.value)).toEqual(ids(rows())));
    expect(announcement.value).toBe('');
  });

  it('ignores moves while disabled or off the end, still undoing the drag', () => {
    const save = vi.fn(async () => true);
    const { items, onDragUpdate, move } = setup(save, true);
    const event = dragged(0, 2);
    onDragUpdate(event);
    expect(event.item.remove).toHaveBeenCalled();
    const open = setup(save);
    open.move(0, -1);
    open.move(2, 1);
    move(0, 1);
    expect(save).not.toHaveBeenCalled();
    expect(ids(items.value)).toEqual(ids(rows()));
    expect(ids(open.items.value)).toEqual(ids(rows()));
  });
});

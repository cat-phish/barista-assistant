// A list page's select mode, for exporting some of its items
// (components/ListDataBar.vue). Reactive, so templates read it directly.
import { reactive } from 'vue';

export interface Selection {
  selecting: boolean;
  ids: Set<string>;
  has(id: string): boolean;
  toggle(id: string): void;
  setAll(ids: readonly string[]): void;
  start(): void;
  stop(): void;
}

export function useSelection(): Selection {
  return reactive({
    selecting: false as boolean,
    ids: new Set<string>(),
    has(id: string) {
      return this.ids.has(id);
    },
    toggle(id: string) {
      if (this.ids.has(id)) this.ids.delete(id);
      else this.ids.add(id);
    },
    setAll(ids: readonly string[]) {
      this.ids = new Set(ids);
    },
    start() {
      this.ids = new Set();
      this.selecting = true;
    },
    stop() {
      this.selecting = false;
      this.ids = new Set();
    },
  }) as Selection;
}

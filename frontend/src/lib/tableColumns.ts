// Which columns a list table shows, and in what order (backlog "Hide and
// reorder table columns"). Chosen in the Columns dialog (ColumnsDialog.vue)
// and remembered per list and workspace on the device, like the sort and the
// widths. Wide screens and phones keep separate choices: on a phone a row is
// the name (and the end column) on one line and the other columns joined by
// "·" underneath, so it starts from a shorter set.
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { forgetView, recallView, rememberView, type SortColumn, type SortColumns } from './listSort';
import { useKeyedColumnWidths } from './columnWidths';

export interface TableColumn<C extends string = string> {
  id: C;
  label: string; // in the dialog and the resize handle's name
  header?: string; // the header's text when it isn't the label ("❄")
  title?: string; // the header's tooltip and spoken name ("Date added")
  class?: string; // on the header and cells ("center")
  track: string; // the default grid track on a wide screen
  end?: boolean; // on a phone, beside the name on the first line
  wide?: boolean; // default on wide screens (default true)
  phone?: boolean; // default on phones (default: as on wide screens)
  wideOnly?: boolean; // never on a phone, nor in its dialog (Beans' ❄: it's beside the name there)
}
export type ColumnLayout = 'wide' | 'phone';
// Every column but the name, in order, and the ones switched off.
export interface ColumnChoice {
  order: string[];
  hidden: string[];
}
export const PHONE_QUERY = '(max-width: 560px)';

const onByDefault = (c: TableColumn, layout: ColumnLayout): boolean =>
  layout === 'wide' ? c.wide !== false : (c.phone ?? c.wide !== false);

// The first column is the name: always shown, always first.
export function defaultChoice(columns: readonly TableColumn[], layout: ColumnLayout): ColumnChoice {
  const rest = columns.slice(1);
  return { order: rest.map((c) => c.id), hidden: rest.filter((c) => !onByDefault(c, layout)).map((c) => c.id) };
}

// A saved choice, made to fit the table: unknown ids drop out, and a column
// added since goes in at its default place and default visibility.
export function normalizeChoice(saved: unknown, columns: readonly TableColumn[], layout: ColumnLayout): ColumnChoice {
  const fallback = defaultChoice(columns, layout);
  if (!saved || typeof saved !== 'object') return fallback;
  const { order, hidden } = saved as Partial<Record<keyof ColumnChoice, unknown>>;
  if (!Array.isArray(order) || !Array.isArray(hidden)) return fallback;
  const ids = new Set(fallback.order);
  const kept = [...new Set(order.filter((id): id is string => typeof id === 'string' && ids.has(id)))];
  const known = new Set(kept);
  const next = [...kept];
  fallback.order.forEach((id, i) => {
    if (known.has(id)) return;
    // After the column it followed by default, or first.
    const before = fallback.order.slice(0, i).reverse().find((b) => next.includes(b));
    next.splice(before ? next.indexOf(before) + 1 : 0, 0, id);
  });
  const savedHidden = new Set(hidden.filter((id): id is string => typeof id === 'string'));
  const newHidden = fallback.hidden.filter((id) => !known.has(id));
  return { order: next, hidden: next.filter((id) => (known.has(id) ? savedHidden.has(id) : newHidden.includes(id))) };
}

export const sameChoice = (a: ColumnChoice, b: ColumnChoice): boolean =>
  a.order.join() === b.order.join() && [...a.hidden].sort().join() === [...b.hidden].sort().join();

// The columns on screen, name first. `available` drops a column whose field
// the workspace hides (Settings → Fields), whatever the choice says.
export function shownColumns(columns: readonly TableColumn[], choice: ColumnChoice, available: (id: string) => boolean = () => true): TableColumn[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const hidden = new Set(choice.hidden);
  const rest = choice.order.filter((id) => !hidden.has(id) && available(id)).map((id) => byId.get(id)!);
  return [columns[0]!, ...rest];
}

// Whether the window is phone-width, kept up to date.
export function usePhoneLayout() {
  const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;
  const phone = ref(media?.matches ?? false);
  const update = (e: MediaQueryListEvent) => (phone.value = e.matches);
  media?.addEventListener('change', update);
  onBeforeUnmount(() => media?.removeEventListener('change', update));
  return phone;
}

// Every column sorts, from its header and the Sort by dropdown: `sortColumns`
// (the list's SortColumns) needs an entry for each column id, or the view
// doesn't compile. For that the ids must stay literal: declare the table as
// `TableColumn<keyof typeof columns>[]` and the sort columns with
// `satisfies SortColumns<Item>` (not a `: SortColumns<Item>` annotation, which
// widens the keys to string and lands here as `never`). It can have more
// (Beans sorts by date purchased, which isn't a column).
export type SortColumnsFor<C extends string> = string extends C
  ? never
  : Readonly<Record<C, SortColumn<never>> & Record<string, SortColumn<never>>>;

// One table's columns. `key` is its localStorage key prefix (`beans`), the
// workspace the suffix; widths live under `<key>.columns.<ws>`, the choice
// under `<key>.columnChoice.<ws>`.
export function useTableColumns<C extends string>(options: {
  key: string;
  workspace: () => string;
  columns: readonly TableColumn<C>[];
  sortColumns: SortColumnsFor<C>;
  available?: (id: string) => boolean;
}) {
  const columns: readonly TableColumn[] = options.columns;
  const sortColumns = options.sortColumns as unknown as SortColumns<never>;
  const available = options.available ?? (() => true);
  const phone = usePhoneLayout();
  const layout = computed<ColumnLayout>(() => (phone.value ? 'phone' : 'wide'));
  const choiceKey = () => `${options.key}.columnChoice.${options.workspace()}`;
  const choices = ref<Record<ColumnLayout, ColumnChoice>>({ wide: defaultChoice(columns, 'wide'), phone: defaultChoice(columns, 'phone') });

  watch(
    choiceKey,
    (k) => {
      let saved: Partial<Record<ColumnLayout, unknown>> = {};
      try {
        const parsed: unknown = JSON.parse(recallView(k) ?? '{}');
        if (parsed && typeof parsed === 'object') saved = parsed as Partial<Record<ColumnLayout, unknown>>;
      } catch {
        // Unreadable: the defaults.
      }
      choices.value = { wide: normalizeChoice(saved.wide, columns, 'wide'), phone: normalizeChoice(saved.phone, columns, 'phone') };
    },
    { immediate: true },
  );

  function save(): void {
    const toSave: Partial<Record<ColumnLayout, ColumnChoice>> = {};
    for (const l of ['wide', 'phone'] as const) if (!sameChoice(choices.value[l], defaultChoice(columns, l))) toSave[l] = choices.value[l];
    if (Object.keys(toSave).length) rememberView(choiceKey(), JSON.stringify(toSave));
    else forgetView(choiceKey());
  }
  const choice = computed(() => choices.value[layout.value]);
  function setChoice(next: ColumnChoice): void {
    choices.value = { ...choices.value, [layout.value]: next };
    save();
  }

  // What can show here: the workspace's fields, and wide-only columns off phones.
  const fits = (id: string) => available(id) && !(phone.value && columns.find((c) => c.id === id)?.wideOnly);
  const shown = computed(() => shownColumns(columns, choice.value, fits));
  const widths = useKeyedColumnWidths(() => `${options.key}.columns.${options.workspace()}`, columns, () => shown.value);

  return reactive({
    layout,
    shown,
    widths,
    // For the header's sort buttons (TableHead): the direction a first click sorts.
    sortColumns,
    // The dialog's rows: every column but the name that the workspace shows.
    entries: computed(() =>
      choice.value.order
        .filter((id) => fits(id))
        .map((id) => {
          const c = columns.find((col) => col.id === id)!;
          return { id, name: c.label, on: !choice.value.hidden.includes(id), end: c.end === true };
        }),
    ),
    nameLabel: columns[0]!.label,
    customized: computed(() => !sameChoice(choice.value, defaultChoice(columns, layout.value))),
    // The end column (a date or rating): right-aligned on a wide screen
    // wherever it's moved, beside the name on a phone.
    isEnd(c: TableColumn): boolean {
      return c.end === true;
    },
    setOn(id: string, on: boolean): void {
      const hidden = choice.value.hidden.filter((h) => h !== id);
      setChoice({ order: choice.value.order, hidden: on ? hidden : [...hidden, id] });
    },
    // `ids`: the dialog's order (columns the workspace hides keep their place).
    setOrder(ids: readonly string[]): void {
      const listed = new Set(ids);
      const queue = [...ids];
      setChoice({ order: choice.value.order.map((id) => (listed.has(id) ? queue.shift()! : id)), hidden: choice.value.hidden });
    },
    reset(): void {
      setChoice(defaultChoice(columns, layout.value));
    },
  });
}
export type TableColumnsState = ReturnType<typeof useTableColumns>;

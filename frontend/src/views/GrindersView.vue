<script setup lang="ts">
// Grinder management (docs/api/grinders.md §3b), one tab of Bar setup, as a
// table: filter by hand/electric (or Archived), sort by any column; a row
// expands to its details and actions. Archive keeps history; delete only works
// for grinders no brew used.
import { computed, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { grindersApi } from '../api/grinders';
import type { Grinder } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import SetupTabs from '../components/SetupTabs.vue';
import ListControls from '../components/ListControls.vue';
import ListDataBar from '../components/ListDataBar.vue';
import TableHead from '../components/TableHead.vue';
import ColumnsDialog from '../components/ColumnsDialog.vue';
import { useTableColumns, type TableColumn } from '../lib/tableColumns';
import { useSelection } from '../composables/useSelection';
import { adjustmentLabel, burrLabel, grinderSummary, powerLabel } from '../lib/equipment';
import { formatAdded } from '../lib/format';
import {
  addedColumn,
  enumColumn,
  isSortKey,
  nameColumn,
  recallView,
  rememberView,
  sortBy,
  sortColumnOptions,
  type SortColumns,
} from '../lib/listSort';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const grinders = ref<Grinder[]>([]);
const loading = ref(true);
const error = ref('');

// View choices, remembered per workspace.
const viewKey = (what: string) => `grinders.${what}.${workspaces.current?.id ?? ''}`;
const ALL = 'all';
const NOT_SET = 'none';
const columns = {
  name: nameColumn(),
  power: enumColumn('Power', ['manual', 'electric'] as const, (g) => g.power),
  burrs: { label: 'Burrs', value: (g) => burrLabel(g) },
  adjustment: enumColumn('Adjustment', ['stepped', 'stepless'] as const, (g) => g.adjustment),
  added: addedColumn(),
} satisfies SortColumns<Grinder>;
const sortChoices = sortColumnOptions(columns);

// Table columns: shown, hidden and moved in the Columns dialog, resizable
// from the header (ColumnResizers). Each is also a sort column.
const TABLE: TableColumn<keyof typeof columns>[] = [
  { id: 'name', label: 'Name', track: 'minmax(0, 2fr)' },
  { id: 'power', label: 'Power', track: 'minmax(0, 0.9fr)' },
  { id: 'burrs', label: 'Burrs', track: 'minmax(0, 1.2fr)' },
  { id: 'adjustment', label: 'Adjustment', track: 'minmax(0, 1.3fr)' },
  { id: 'added', label: 'Added', title: 'Date added', track: '5.5rem', end: true },
];
const table = useTableColumns({ sortColumns: columns, key: 'grinders', workspace: () => workspaces.current?.id ?? '', columns: TABLE });
const choosingColumns = ref(false);
const cell = (g: Grinder, id: string): string => {
  if (id === 'power') return powerLabel(g) ?? '–';
  if (id === 'burrs') return burrLabel(g) ?? '–';
  if (id === 'adjustment') return adjustmentLabel(g) ?? '–';
  return formatAdded(g.createdAt);
};
const filter = ref(ALL);
const showArchived = ref(false);
const archivedCount = computed(() => grinders.value.filter((g) => g.archivedAt).length);
const sort = ref('name_asc');
watch(filter, (v) => rememberView(viewKey('filter'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));
const filterOptions = computed(() => {
  const active = grinders.value.filter((g) => !g.archivedAt);
  return [
    { value: ALL, label: 'All grinders' },
    { value: 'manual', label: 'Hand grinders' },
    { value: 'electric', label: 'Electric' },
    ...(active.some((g) => g.power === null) ? [{ value: NOT_SET, label: 'Not set' }] : []),
  ];
});
const filterName = computed(() => filterOptions.value.find((o) => o.value === filter.value)?.label ?? '');
const shown = computed(() => {
  const f = filter.value;
  const list = grinders.value.filter(
    (g) => (!g.archivedAt || showArchived.value) && (f === ALL || (f === NOT_SET ? g.power === null : g.power === f)),
  );
  return sortBy(list, sort.value, columns);
});
// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    grinders.value = (await grindersApi.list(ws)).grinders;
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  const savedSort = recallView(viewKey('sort'));
  if (isSortKey(savedSort, columns)) sort.value = savedSort;
  await load();
  const savedFilter = recallView(viewKey('filter'));
  if (savedFilter && filterOptions.value.some((o) => o.value === savedFilter)) filter.value = savedFilter;
});

function replace(updated: Grinder): void {
  grinders.value = grinders.value.map((g) => (g.id === updated.id ? updated : g));
}

const busyId = ref<string | null>(null);
async function setArchived(g: Grinder, value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = g.id;
  error.value = '';
  try {
    replace((await grindersApi.update(ws, g.id, { archived: value })).grinder);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Select mode for exporting some items (components/ExportBar.vue).
const selection = useSelection();
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'grinder-new' }">Add grinder</RouterLink>
    </div>
    <SetupTabs />
    <p class="muted intro">Brews record which grinder you used, so grind settings stay meaningful.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading grinders…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="grinders.length === 0" class="card empty"><p>No grinders yet.</p></div>
      <template v-else>
        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="grinders" filter-label="Show" :filter-options="filterOptions" v-model:show-archived="showArchived" :archived-count="archivedCount" />
        <ListDataBar list="grinders" noun="grinders" :selection="selection" :visible-ids="shown.map((x) => x.id)" @imported="load()">
          <template v-if="shown.length">
            <button v-if="table.widths.resized" class="btn-link widths-reset" type="button" @click="table.widths.reset()">Reset widths</button>
            <button class="btn-link" type="button" @click="choosingColumns = true">Columns…</button>
          </template>
        </ListDataBar>
        <p v-if="showArchived" class="muted small">Archived grinders are hidden when brewing; past brews still show them.</p>
        <ColumnsDialog :open="choosingColumns" :state="table" noun="grinder" @close="choosingColumns = false" />
        <p v-if="shown.length === 0" class="card empty">No {{ filterName.toLowerCase() }} yet.</p>
        <div v-else class="data-table" :style="{ '--cols': table.widths.template }">
          <TableHead v-model:sort="sort" :state="table" />
          <div v-for="g in shown" :key="g.id" class="data-item" :class="{ open: openId === g.id }">
            <button class="data-row" type="button" :aria-expanded="selection.selecting ? undefined : openId === g.id" :aria-pressed="selection.selecting ? selection.has(g.id) : undefined" @click="selection.selecting ? selection.toggle(g.id) : toggle(g.id)">
              <span class="data-td primary"><span v-if="selection.selecting" class="tick" aria-hidden="true">{{ selection.has(g.id) ? '☑' : '☐' }}</span>{{ g.name }}<span v-if="g.archivedAt" class="muted"> (archived)</span></span>
              <span v-for="c in table.shown.slice(1)" :key="c.id" class="data-td" :class="{ end: table.isEnd(c) }">{{ cell(g, c.id) }}</span>
            </button>
            <div v-if="openId === g.id" class="data-details">
              <p class="muted">{{ grinderSummary(g) || 'No details yet: edit to add the range, burrs and power.' }}</p>
              <p v-if="g.notes" class="muted">{{ g.notes }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <RouterLink class="btn-link" :to="{ name: 'grinder-edit', params: { id: g.id } }">Edit</RouterLink>
                <template v-if="g.archivedAt">
                  <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setArchived(g, false)">Restore</button>
                </template>
                <template v-else>
                  <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setArchived(g, true)">Archive</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
</style>

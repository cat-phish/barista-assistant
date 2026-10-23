<script setup lang="ts">
// Grinder management (docs/api/grinders.md §3b), one tab of Bar setup, as a
// table: filter by hand/electric (or Retired), sort by any column; a row
// expands to its details and actions. Retire keeps history; delete only works
// for grinders no brew used.
import { computed, onMounted, ref, watch } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { grindersApi } from '../api/grinders';
import type { Grinder } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SetupTabs from '../components/SetupTabs.vue';
import ListControls from '../components/ListControls.vue';
import { adjustmentLabel, burrLabel, grinderSummary, powerLabel } from '../lib/equipment';
import { formatAdded } from '../lib/format';
import {
  addedColumn,
  enumColumn,
  isSortKey,
  nameColumn,
  recallView,
  rememberView,
  sortArrow,
  sortBy,
  sortLabel,
  sortColumnOptions,
  toggleHeader,
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
const columns: SortColumns<Grinder> = {
  name: nameColumn(),
  power: enumColumn('Power', ['manual', 'electric'] as const, (g) => g.power),
  burrs: { label: 'Burrs', value: (g) => burrLabel(g) },
  adjustment: enumColumn('Adjustment', ['stepped', 'stepless'] as const, (g) => g.adjustment),
  added: addedColumn(),
};
const sortChoices = sortColumnOptions(columns);
const filter = ref(ALL);
const showRetired = ref(false);
const retiredCount = computed(() => grinders.value.filter((g) => g.retiredAt).length);
const sort = ref('name_asc');
watch(filter, (v) => rememberView(viewKey('filter'), v));
watch(sort, (v) => rememberView(viewKey('sort'), v));
const filterOptions = computed(() => {
  const active = grinders.value.filter((g) => !g.retiredAt);
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
    (g) => (!g.retiredAt || showRetired.value) && (f === ALL || (f === NOT_SET ? g.power === null : g.power === f)),
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
    if (retiredCount.value === 0) showRetired.value = false;
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
async function setRetired(g: Grinder, value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = g.id;
  error.value = '';
  try {
    replace((await grindersApi.update(ws, g.id, { retired: value })).grinder);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Delete: confirm; if brews used it, the server says how many and we offer Retire.
const pending = ref<Grinder | null>(null);
const usedCount = ref<number | null>(null);
const deleting = ref(false);
const dialogError = ref('');
function askDelete(g: Grinder): void {
  pending.value = g;
  usedCount.value = null;
  dialogError.value = '';
}
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const g = pending.value;
  if (!ws || !g) return;
  deleting.value = true;
  dialogError.value = '';
  try {
    await grindersApi.remove(ws, g.id);
    pending.value = null;
    await load();
  } catch (err) {
    const count = err instanceof ApiError && err.status === 409 ? err.body?.brewLogCount : undefined;
    if (typeof count === 'number') usedCount.value = count;
    else dialogError.value = errorMessage(err);
  } finally {
    deleting.value = false;
  }
}
async function retireInstead(): Promise<void> {
  const g = pending.value;
  pending.value = null;
  if (g) await setRetired(g, true);
}
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
        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-columns="sortChoices" id-prefix="grinders" filter-label="Show" :filter-options="filterOptions" v-model:show-retired="showRetired" :retired-count="retiredCount" />
        <p v-if="showRetired" class="muted small">Retired grinders are hidden when brewing; past brews still show them.</p>
        <p v-if="shown.length === 0" class="card empty">No {{ filterName.toLowerCase() }} yet.</p>
        <div v-else class="data-table" style="--cols: minmax(0, 2fr) minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 1.3fr) 5.5rem">
          <div class="data-row data-head">
            <button v-for="c in ['name', 'power', 'burrs', 'adjustment']" :key="c" class="data-th" type="button" :aria-label="sortLabel(sort, c, columns[c]!.label)" @click="sort = toggleHeader(sort, c, columns)">
              {{ columns[c]!.label }} <span aria-hidden="true">{{ sortArrow(sort, c) }}</span>
            </button>
            <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
              Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
            </button>
          </div>
          <div v-for="g in shown" :key="g.id" class="data-item" :class="{ open: openId === g.id }">
            <button class="data-row" type="button" :aria-expanded="openId === g.id" @click="toggle(g.id)">
              <span class="data-td primary">{{ g.name }}<span v-if="g.retiredAt" class="muted"> (retired)</span></span>
              <span class="data-td">{{ powerLabel(g) ?? '–' }}</span>
              <span class="data-td">{{ burrLabel(g) ?? '–' }}</span>
              <span class="data-td">{{ adjustmentLabel(g) ?? '–' }}</span>
              <span class="data-td end">{{ formatAdded(g.createdAt) }}</span>
            </button>
            <div v-if="openId === g.id" class="data-details">
              <p class="muted">{{ grinderSummary(g) || 'No details yet: edit to add the range, burrs and power.' }}</p>
              <p v-if="g.notes" class="muted">{{ g.notes }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <template v-if="g.retiredAt">
                  <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setRetired(g, false)">Restore</button>
                </template>
                <template v-else>
                  <RouterLink class="btn-link" :to="{ name: 'grinder-edit', params: { id: g.id } }">Edit</RouterLink>
                  <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setRetired(g, true)">Retire</button>
                </template>
                <button class="btn-link danger" type="button" @click="askDelete(g)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" :title="usedCount === null ? 'Delete this grinder?' : 'This grinder has brew history'" @cancel="pending = null">
    <p v-if="usedCount === null">{{ pending?.name }} will be removed.</p>
    <p v-else>
      {{ usedCount }} brew{{ usedCount === 1 ? ' was' : 's were' }} made with {{ pending?.name }}, so it can't be deleted.
      Retire it instead: it's hidden when brewing, and past brews keep showing it.
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button v-if="usedCount === null" class="btn btn-danger" type="button" :disabled="deleting" @click="confirmDelete">Delete</button>
      <button v-else class="btn btn-primary" type="button" @click="retireInstead">Retire instead</button>
      <button class="btn btn-secondary" type="button" :disabled="deleting" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
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

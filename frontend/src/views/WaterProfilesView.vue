<script setup lang="ts">
// Water profiles (docs/api/water-profiles.md §3c), one tab of Bar setup, like
// grinders: sort by any column, Show archived; a row expands to its
// figures and actions. The "Default for new brews" picker above the list sets
// the one profile new brews start on. Archive keeps history; delete only works
// for profiles no brew used.
import { computed, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import type { WaterProfile } from '../api/types';
import { waterProfilesApi } from '../api/waterProfiles';
import AppHeader from '../components/AppHeader.vue';
import ListControls from '../components/ListControls.vue';
import ListDataBar from '../components/ListDataBar.vue';
import { useSelection } from '../composables/useSelection';
import SetupTabs from '../components/SetupTabs.vue';
import { formatAdded } from '../lib/format';
import {
  addedColumn,
  isSortKey,
  nameColumn,
  recallView,
  rememberView,
  sortArrow,
  sortBy,
  sortColumnOptions,
  sortLabel,
  toggleHeader,
  type SortColumn,
  type SortColumns,
} from '../lib/listSort';
import { waterSummary } from '../lib/water';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const profiles = ref<WaterProfile[]>([]);
const loading = ref(true);
const error = ref('');

// View choices, remembered per workspace.
const viewKey = (what: string) => `water.${what}.${workspaces.current?.id ?? ''}`;
const figureColumn = (label: string, value: (p: WaterProfile) => number | null): SortColumn<WaterProfile> => ({
  label, value, asc: 'Lowest first', desc: 'Highest first',
});
const columns: SortColumns<WaterProfile> = {
  name: nameColumn(),
  tds: figureColumn('TDS', (p) => p.tdsPpm),
  gh: figureColumn('GH', (p) => p.generalHardnessPpm),
  kh: figureColumn('KH', (p) => p.alkalinityPpm),
  added: addedColumn(),
};
const sortChoices = sortColumnOptions(columns);
const showArchived = ref(false);
const sort = ref('name_asc');
watch(sort, (v) => rememberView(viewKey('sort'), v));

const active = computed(() => profiles.value.filter((p) => !p.archivedAt));
const archivedCount = computed(() => profiles.value.length - active.value.length);
const shown = computed(() => sortBy(showArchived.value ? profiles.value : active.value, sort.value, columns));
const figure = (n: number | null) => (n === null ? '–' : String(n));

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    profiles.value = (await waterProfilesApi.list(ws)).waterProfiles;
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
});

const busyId = ref<string | null>(null);
// The default for new brews, picked from the active profiles ('' = none).
const defaultId = computed(() => active.value.find((p) => p.isDefault)?.id ?? '');
const savingDefault = ref(false);
async function setDefault(id: string): Promise<void> {
  const ws = workspaces.current?.id;
  const current = active.value.find((p) => p.isDefault);
  if (!ws || id === (current?.id ?? '')) return;
  savingDefault.value = true;
  error.value = '';
  try {
    // Making one the default clears the others; "None" clears the current one.
    if (id) await waterProfilesApi.update(ws, id, { isDefault: true });
    else if (current) await waterProfilesApi.update(ws, current.id, { isDefault: false });
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    savingDefault.value = false;
  }
}

async function change(p: WaterProfile, input: { archived: boolean }): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = p.id;
  error.value = '';
  try {
    await waterProfilesApi.update(ws, p.id, input);
    await load(); // a new default clears the old one
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
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'water-profile-new' }">Add water</RouterLink>
    </div>
    <SetupTabs />
    <p class="muted intro">Brews record the water you used. Minerals change extraction, so the AI takes them into account.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading water profiles…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="profiles.length === 0" class="card empty">
        <p>No water profiles yet. Add the water you brew with (tap, a bottled water, or a recipe like Third Wave Water) to record it with each brew.</p>
      </div>
      <template v-else>
        <div class="card default-picker">
          <div class="field">
            <label for="water-default">Default for new brews</label>
            <select v-if="workspaces.canEdit" id="water-default" :value="defaultId" :disabled="savingDefault || active.length === 0" @change="setDefault(($event.target as HTMLSelectElement).value)">
              <option value="">None</option>
              <option v-for="p in sortBy(active, 'name_asc', columns)" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <p v-else id="water-default">{{ active.find((p) => p.isDefault)?.name ?? 'None' }}</p>
            <span class="hint">The brew form starts on this water; you can still pick another for each brew.</span>
          </div>
        </div>
        <ListControls v-model:sort="sort" :sort-columns="sortChoices" id-prefix="water" v-model:show-archived="showArchived" :archived-count="archivedCount" />
        <ListDataBar list="water_profiles" noun="water profiles" :selection="selection" :visible-ids="shown.map((x) => x.id)" @imported="load()" />
        <p v-if="showArchived" class="muted small">Archived water is hidden when brewing; past brews still show it.</p>
        <p v-if="shown.length === 0" class="card empty">No active water profiles.</p>
        <div v-else class="data-table" style="--cols: minmax(0, 2fr) repeat(3, minmax(0, 0.7fr)) 5.5rem">
          <div class="data-row data-head">
            <button v-for="c in ['name', 'tds', 'gh', 'kh']" :key="c" class="data-th" type="button" :aria-label="sortLabel(sort, c, columns[c]!.label)" @click="sort = toggleHeader(sort, c, columns)">
              {{ columns[c]!.label }} <span aria-hidden="true">{{ sortArrow(sort, c) }}</span>
            </button>
            <button class="data-th end" type="button" :aria-label="sortLabel(sort, 'added', 'Date added')" @click="sort = toggleHeader(sort, 'added', columns)">
              Added <span aria-hidden="true">{{ sortArrow(sort, 'added') }}</span>
            </button>
          </div>
          <div v-for="p in shown" :key="p.id" class="data-item" :class="{ open: openId === p.id }">
            <button class="data-row" type="button" :aria-expanded="selection.selecting ? undefined : openId === p.id" :aria-pressed="selection.selecting ? selection.has(p.id) : undefined" @click="selection.selecting ? selection.toggle(p.id) : toggle(p.id)">
              <span class="data-td primary"><span v-if="selection.selecting" class="tick" aria-hidden="true">{{ selection.has(p.id) ? '☑' : '☐' }}</span>{{ p.name }}<span v-if="p.archivedAt" class="muted"> (archived)</span> <span v-if="p.isDefault" class="badge">Default</span></span>
              <span class="data-td">{{ figure(p.tdsPpm) }}</span>
              <span class="data-td">{{ figure(p.generalHardnessPpm) }}</span>
              <span class="data-td">{{ figure(p.alkalinityPpm) }}</span>
              <span class="data-td end">{{ formatAdded(p.createdAt) }}</span>
            </button>
            <div v-if="openId === p.id" class="data-details">
              <p class="muted">{{ waterSummary(p) ? `${waterSummary(p)} (mg/L)` : 'No figures yet: edit to add TDS, hardness and minerals.' }}</p>
              <p v-if="p.notes" class="muted">{{ p.notes }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <RouterLink class="btn-link" :to="{ name: 'water-profile-edit', params: { id: p.id } }">Edit</RouterLink>
                <template v-if="p.archivedAt">
                  <button class="btn-link" type="button" :disabled="busyId === p.id" @click="change(p, { archived: false })">Restore</button>
                </template>
                <template v-else>
                  <button class="btn-link" type="button" :disabled="busyId === p.id" @click="change(p, { archived: true })">Archive</button>
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
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
.default-picker .field {
  max-width: 24rem;
}
</style>

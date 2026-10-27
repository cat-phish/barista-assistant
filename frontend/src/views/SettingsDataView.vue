<script setup lang="ts">
// Settings → Data (docs/api/backup.md §2b): download the workspace as a
// backup file (owners), or restore one into a new workspace.
import { computed, ref } from 'vue';
import { backupApi, LISTS, type ListName } from '../api/backup';
import { errorMessage } from '../api/client';
import AiRequestsChoice from '../components/AiRequestsChoice.vue';
import ImportLists from '../components/ImportLists.vue';
import RestoreBackup from '../components/RestoreBackup.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { backupFileName, backupSummary, exportFileName, hasAiSuggestions, LIST_LABELS, saveBlob, saveJson } from '../lib/backup';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const isOwner = computed(() => workspaces.current?.role === 'owner');

const downloading = ref(false);
const downloadError = ref('');
const downloaded = ref<string | null>(null); // what the last download held
// Backups and exports with AI suggestions ask first whether to include what
// each was sent (docs/api/backup.md §2b); then this runs with the answer.
const choosing = ref<((aiRequests: boolean) => Promise<void>) | null>(null);
function choose(aiRequests: boolean): void {
  const next = choosing.value;
  choosing.value = null;
  void next?.(aiRequests);
}

async function download(aiRequests: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  downloading.value = true;
  downloadError.value = '';
  try {
    const file = await backupApi.download(ws, aiRequests);
    saveJson(backupFileName(file), file);
    downloaded.value = backupSummary(file);
  } catch (err) {
    downloadError.value = errorMessage(err);
  } finally {
    downloading.value = false;
  }
}

// Export lists (docs/api/backup.md §2b, "By list"): every item of the
// ticked lists, with what they need.
const exportLists = ref<ListName[]>([]);
const exporting = ref(false);
const exportError = ref('');
function startExport(): void {
  if (hasAiSuggestions(exportLists.value)) choosing.value = exportChosen;
  else void exportChosen(false);
}
async function exportChosen(aiRequests: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !exportLists.value.length) return;
  exporting.value = true;
  exportError.value = '';
  try {
    const lists = LISTS.filter((l) => exportLists.value.includes(l)); // in the usual order
    const file = await backupApi.exportLists(ws, lists, undefined, aiRequests);
    saveJson(exportFileName(file, lists), file);
  } catch (err) {
    exportError.value = errorMessage(err);
  } finally {
    exporting.value = false;
  }
}

// For spreadsheets (docs/api/backup.md §2b, "CSV"): the journal or the beans.
const csvBusy = ref<'brew_logs' | 'beans' | null>(null);
const csvError = ref('');
async function downloadCsv(list: 'brew_logs' | 'beans'): Promise<void> {
  const ws = workspaces.current;
  if (!ws) return;
  csvBusy.value = list;
  csvError.value = '';
  try {
    const name = list === 'beans' ? 'beans' : 'journal';
    saveBlob(`${ws.slug}-${name}-${new Date().toISOString().slice(0, 10)}.csv`, await backupApi.csv(ws.id, list));
  } catch (err) {
    csvError.value = errorMessage(err);
  } finally {
    csvBusy.value = null;
  }
}
</script>

<template>
  <SettingsLayout title="Data">
    <section class="card stack" aria-labelledby="data-backup">
      <h2 id="data-backup">Back up</h2>
      <p class="muted small">
        Everything in {{ workspaces.current?.name }} as one file: beans, equipment, recipes, drinks, the menu, and every brew with its timer marks,
        prep, problems and AI suggestions. Keep it somewhere safe, or restore it on another server.
      </p>
      <template v-if="isOwner">
        <button class="btn btn-primary" type="button" :disabled="downloading" @click="choosing = download">{{ downloading ? 'Preparing…' : 'Download backup' }}</button>
        <p v-if="downloaded !== null" class="muted small" aria-live="polite">Saved: {{ downloaded || 'an empty workspace' }}.</p>
        <p v-if="downloadError" class="form-error" role="alert">{{ downloadError }}</p>
      </template>
      <p v-else class="muted small">Only owners can download a backup: it holds everyone's brews.</p>
    </section>

    <AiRequestsChoice :open="choosing !== null" @choose="choose" @cancel="choosing = null" />

    <section class="card stack" aria-labelledby="data-export">
      <h2 id="data-export">Export lists</h2>
      <p class="muted small">
        Some lists as a file, to share with another bar or bring into another workspace. What their items need comes along: a recipe's brewer and
        grinders, a drink's recipe and ingredients, a brew's bean. Each list page can also export the items you pick ("Select to export…")
        and import into that list ("Import…").
      </p>
      <template v-if="isOwner">
        <div class="list-grid">
          <label v-for="l in LISTS" :key="l" class="checkbox">
            <input v-model="exportLists" type="checkbox" :value="l" />
            {{ LIST_LABELS[l] }}
          </label>
        </div>
        <button class="btn btn-primary" type="button" :disabled="exporting || !exportLists.length" @click="startExport">
          {{ exporting ? 'Preparing…' : 'Download export' }}
        </button>
        <p v-if="exportError" class="form-error" role="alert">{{ exportError }}</p>
      </template>
      <p v-else class="muted small">Only owners can export.</p>
    </section>

    <section class="card stack" aria-labelledby="data-csv">
      <h2 id="data-csv">Spreadsheet (CSV)</h2>
      <p class="muted small">
        The journal (one row per brew: bean, recipe, grinder and water by name, dose, yield, TDS and extraction, time, prep, problems, ratings
        and notes) or the beans, to open in Excel, Numbers or Google Sheets. For reading, not for importing back.
      </p>
      <div v-if="isOwner" class="csv-buttons">
        <button class="btn btn-secondary" type="button" :disabled="!!csvBusy" @click="downloadCsv('brew_logs')">{{ csvBusy === 'brew_logs' ? 'Preparing…' : 'Journal CSV' }}</button>
        <button class="btn btn-secondary" type="button" :disabled="!!csvBusy" @click="downloadCsv('beans')">{{ csvBusy === 'beans' ? 'Preparing…' : 'Beans CSV' }}</button>
      </div>
      <p v-else class="muted small">Only owners can download these.</p>
      <p v-if="csvError" class="form-error" role="alert">{{ csvError }}</p>
    </section>

    <section class="card stack" aria-labelledby="data-import">
      <h2 id="data-import">Import into {{ workspaces.current?.name }}</h2>
      <p class="muted small">
        Lists from an export (or a backup) are added here, several at once. Anything already here with the same name is used instead of a
        second one, unless you choose to add copies; the preview shows which.
      </p>
      <ImportLists v-if="isOwner" />
      <p v-else class="muted small">Only owners can import.</p>
    </section>

    <section class="card stack" aria-labelledby="data-restore">
      <h2 id="data-restore">Restore</h2>
      <p class="muted small">A backup always becomes a new workspace; {{ workspaces.current?.name }} isn't changed.</p>
      <RestoreBackup />
    </section>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.csv-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: var(--space-1) var(--space-3);
}
</style>

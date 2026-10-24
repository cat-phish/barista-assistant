<script setup lang="ts">
// Import lists into the current workspace (docs/api/backup.md §2b, "By
// list"): pick an export or backup file, see what would be added and what's
// already here, choose lists and what to do with duplicates, import.
// With `only` (a list page's Import…), just that list: no list choice, and a
// file without it is refused.
import { computed, ref } from 'vue';
import { backupApi, type BackupFile, type Duplicates, type ImportSummary, type ListName } from '../api/backup';
import { errorMessage } from '../api/client';
import { detailsText, LIST_LABELS, missingListError, readBackup, tableLabel } from '../lib/backup';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ only?: ListName }>();
const emit = defineEmits<{ (e: 'imported', summary: ImportSummary): void }>();
const workspaces = useWorkspaceStore();
const inputId = `import-file-${props.only ?? 'lists'}`;

const file = ref<BackupFile | null>(null);
const fileError = ref('');
const offered = ref<ListName[]>([]); // what the file has
const lists = ref<ListName[]>([]); // what to import
const duplicates = ref<Duplicates>('existing');
const preview = ref<ImportSummary | null>(null);
const previewing = ref(false);
const importing = ref(false);
const done = ref<ImportSummary | null>(null);
const error = ref('');

async function pick(event: Event): Promise<void> {
  const chosen = (event.target as HTMLInputElement).files?.[0];
  file.value = null;
  preview.value = null;
  done.value = null;
  fileError.value = '';
  error.value = '';
  if (!chosen) return;
  const read = readBackup(await chosen.text());
  if (!read.ok) {
    fileError.value = read.error;
    return;
  }
  if (props.only) {
    const missing = missingListError(read.file, props.only);
    if (missing) {
      fileError.value = missing;
      return;
    }
    file.value = read.file;
    offered.value = [props.only];
    lists.value = [props.only];
    await refresh([props.only]);
    return;
  }
  file.value = read.file;
  const first = await refresh(undefined);
  if (first) {
    offered.value = [...first.lists];
    lists.value = [...first.lists];
  }
}

// The preview follows the lists and the duplicates choice.
async function refresh(chosen: ListName[] | undefined): Promise<ImportSummary | null> {
  const ws = workspaces.current?.id;
  if (!ws || !file.value) return null;
  previewing.value = true;
  error.value = '';
  try {
    preview.value = await backupApi.previewImport(ws, file.value, duplicates.value, chosen);
  } catch (err) {
    preview.value = null;
    error.value = errorMessage(err);
  } finally {
    previewing.value = false;
  }
  return preview.value;
}
function toggle(list: ListName, on: boolean): void {
  lists.value = offered.value.filter((l) => (l === list ? on : lists.value.includes(l)));
  if (lists.value.length) void refresh(lists.value);
  else preview.value = null;
}
function setDuplicates(value: Duplicates): void {
  duplicates.value = value;
  if (lists.value.length) void refresh(lists.value);
}

const nothingNew = computed(() => !!preview.value && preview.value.tables.every((t) => t.added.length === 0));
const canImport = computed(() => !!file.value && lists.value.length > 0 && !!preview.value && !nothingNew.value && !importing.value && !previewing.value);

async function runImport(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !file.value || !canImport.value) return;
  importing.value = true;
  error.value = '';
  try {
    done.value = await backupApi.importLists(ws, file.value, duplicates.value, lists.value);
    emit('imported', done.value);
    preview.value = null;
  } catch (err) {
    error.value = `Couldn't import it: ${errorMessage(err)}`;
  } finally {
    importing.value = false;
  }
}

const shown = (s: ImportSummary) => s.tables.filter((t) => t.added.length || t.matched.length);
const addedCount = (s: ImportSummary) => s.tables.reduce((n, t) => n + t.added.length, 0);
</script>

<template>
  <div class="stack">
    <div class="field">
      <label :for="inputId">Export or backup file</label>
      <input :id="inputId" type="file" accept="application/json,.json" @change="pick" />
      <span v-if="fileError" class="field-error" role="alert">{{ fileError }}</span>
    </div>

    <p v-if="done" class="done" role="status">
      Imported: {{ addedCount(done) }} new item{{ addedCount(done) === 1 ? '' : 's' }}<template v-if="detailsText(done.details)"> ({{ detailsText(done.details) }})</template>.
    </p>

    <template v-else-if="file && offered.length">
      <fieldset v-if="!only" class="lists">
        <legend>Lists to import</legend>
        <label v-for="l in offered" :key="l" class="checkbox">
          <input type="checkbox" :checked="lists.includes(l)" :disabled="previewing || importing" @change="toggle(l, ($event.target as HTMLInputElement).checked)" />
          {{ LIST_LABELS[l] }}
        </label>
        <span class="hint">What they need (a recipe's brewer and grinders, a drink's ingredients…) comes along.</span>
      </fieldset>
      <fieldset class="lists">
        <legend>Already here with the same name</legend>
        <label class="checkbox">
          <input type="radio" name="duplicates" :checked="duplicates === 'existing'" @change="setDuplicates('existing')" />
          Use the one here
        </label>
        <label class="checkbox">
          <input type="radio" name="duplicates" :checked="duplicates === 'copy'" @change="setDuplicates('copy')" />
          Add as a copy ("House V60 (2)")
        </label>
        <span class="hint">Brews already in the journal are never added twice.</span>
      </fieldset>

      <p v-if="previewing" class="muted" aria-live="polite">Checking the file…</p>
      <div v-else-if="preview" class="preview">
        <table>
          <thead>
            <tr><th scope="col">List</th><th scope="col">New</th><th scope="col">Already here</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in shown(preview)" :key="t.table">
              <th scope="row">{{ tableLabel(t.table) }}</th>
              <td>{{ t.added.join(', ') || '–' }}</td>
              <td>{{ t.matched.map((m) => (m.name === m.existing ? m.name : `${m.name} → ${m.existing}`)).join(', ') || '–' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="detailsText(preview.details)" class="muted small">Along with: {{ detailsText(preview.details) }}.</p>
        <p v-if="nothingNew" class="muted small">Everything in it is here already.</p>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="button" :disabled="!canImport" @click="runImport">{{ importing ? 'Importing…' : 'Import' }}</button>
    </template>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="file && !previewing" class="muted">This file has no lists to import.</p>
  </div>
</template>

<style scoped>
.lists {
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.lists legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.preview {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  text-align: left;
  vertical-align: top;
  padding: var(--space-1) var(--space-2) var(--space-1) 0;
  border-bottom: 1px solid var(--border);
}
p {
  margin: 0;
}
.done {
  font-weight: 600;
}
</style>

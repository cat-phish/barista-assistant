<script setup lang="ts">
// A list page's export and import (docs/api/backup.md §2b, "By list";
// "Where it is in the app"): "Select to export…" ticks some rows (the page
// shows ticks while selecting) and exports those with what they need;
// "Import…" brings this list in from an export or backup file. Exporting
// whole lists, CSV and backups are on Settings → Data. Owners only.
import { computed, ref, watch } from 'vue';
import { backupApi, type ListName } from '../api/backup';
import { errorMessage } from '../api/client';
import type { Selection } from '../composables/useSelection';
import { COMES_ALONG, exportFileName, LIST_LABELS, saveJson } from '../lib/backup';
import { useWorkspaceStore } from '../stores/workspace';
import ImportLists from './ImportLists.vue';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const props = defineProps<{
  list: ListName;
  selection?: Selection; // left out: import only (Settings → Lists)
  visibleIds?: string[]; // for "Select all shown"
  noun?: string; // "recipes"
}>();
const emit = defineEmits<{ (e: 'imported'): void }>();
const workspaces = useWorkspaceStore();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const busy = ref(false);
const error = ref('');
const count = computed(() => props.selection?.ids.size ?? 0);

async function exportSelected(ids: string[]): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  error.value = '';
  try {
    const file = await backupApi.exportLists(ws, [props.list], { [props.list]: ids });
    saveJson(exportFileName(file, [props.list]), file);
    props.selection?.stop();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

// Import…: in a dialog, so the list stays put behind it.
const importing = ref(false);
const importKey = ref(0); // a fresh import form each time it opens
const dialog = ref<HTMLDialogElement | null>(null);
watch(
  importing,
  (open) => {
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
  },
  { flush: 'post' },
);
function openImport(): void {
  importKey.value += 1;
  importing.value = true;
}
</script>

<template>
  <div v-if="isOwner" class="list-data-bar" role="group" :aria-label="`Export or import ${noun ?? 'items'}`">
    <template v-if="!selection?.selecting">
      <button v-if="selection" class="btn-link" type="button" :disabled="busy" @click="selection.start()">Select to export…</button>
      <button class="btn-link" type="button" @click="openImport">Import…</button>
    </template>
    <template v-else>
      <span class="muted small" aria-live="polite">{{ count }} selected · tap rows to pick</span>
      <button v-if="visibleIds?.length" class="btn-link" type="button" @click="selection.setAll(visibleIds)">Select all shown</button>
      <button class="btn btn-primary" type="button" :disabled="busy || !count" @click="exportSelected([...selection.ids])">Export selected</button>
      <button class="btn-link" type="button" @click="selection.stop()">Cancel</button>
    </template>
    <span v-if="error" class="form-error" role="alert">{{ error }}</span>

    <dialog ref="dialog" class="import-dialog" :aria-label="`Import ${LIST_LABELS[list].toLowerCase()}`" @cancel.prevent="importing = false">
      <h2>Import {{ LIST_LABELS[list].toLowerCase() }}</h2>
      <p class="muted small">
        From an export or a backup file.<template v-if="COMES_ALONG[list]"> {{ capitalize(COMES_ALONG[list]!) }} comes along too.</template>
        Anything already here with the same name is used instead of a second one, unless you choose to add copies. To import several lists at
        once, use Settings → Data.
      </p>
      <ImportLists v-if="importing" :key="importKey" :only="list" @imported="emit('imported')" />
      <div class="actions">
        <button class="btn btn-secondary" type="button" @click="importing = false">Close</button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.list-data-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1) var(--space-3);
}
.import-dialog {
  width: min(640px, calc(100vw - 2 * var(--space-3)));
  max-height: calc(100vh - 2 * var(--space-4));
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: var(--text);
  text-align: left;
}
.import-dialog::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.import-dialog h2 {
  font-size: 1.2rem;
  margin: 0 0 var(--space-2);
}
.import-dialog > p {
  margin: 0 0 var(--space-3);
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}
</style>

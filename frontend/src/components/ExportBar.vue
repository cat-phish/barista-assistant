<script setup lang="ts">
// Export on a list page (docs/api/backup.md §2b, "By list"): the whole list,
// or "Select…" to tick some rows (the page shows ticks while selecting) and
// export those. What the items need comes along. Owners only.
import { computed, ref } from 'vue';
import { backupApi, type ListName } from '../api/backup';
import { errorMessage } from '../api/client';
import type { Selection } from '../composables/useSelection';
import { exportFileName, saveJson } from '../lib/backup';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{
  list: ListName;
  selection?: Selection; // left out: whole list only (Settings → Lists)
  visibleIds?: string[]; // for "Select all shown"
  noun?: string; // "recipes"
}>();
const workspaces = useWorkspaceStore();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const busy = ref(false);
const error = ref('');
const count = computed(() => props.selection?.ids.size ?? 0);

async function run(ids?: string[]): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  error.value = '';
  try {
    const file = await backupApi.exportLists(ws, [props.list], ids ? { [props.list]: ids } : undefined);
    saveJson(exportFileName(file, [props.list]), file);
    props.selection?.stop();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="isOwner" class="export-bar" role="group" :aria-label="`Export ${noun ?? 'items'}`">
    <template v-if="!selection?.selecting">
      <button class="btn-link" type="button" :disabled="busy" @click="run()">Export all</button>
      <button v-if="selection" class="btn-link" type="button" :disabled="busy" @click="selection.start()">Select to export…</button>
    </template>
    <template v-else>
      <span class="muted small" aria-live="polite">{{ count }} selected · tap rows to pick</span>
      <button v-if="visibleIds?.length" class="btn-link" type="button" @click="selection.setAll(visibleIds)">Select all shown</button>
      <button class="btn btn-primary" type="button" :disabled="busy || !count" @click="run([...selection.ids])">Export selected</button>
      <button class="btn-link" type="button" @click="selection.stop()">Cancel</button>
    </template>
    <span v-if="error" class="form-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.export-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1) var(--space-3);
}
</style>

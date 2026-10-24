<script setup lang="ts">
// Settings → Data (docs/api/backup.md §2b): download the workspace as a
// backup file (owners), or restore one into a new workspace.
import { computed, ref } from 'vue';
import { backupApi } from '../api/backup';
import { errorMessage } from '../api/client';
import RestoreBackup from '../components/RestoreBackup.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { backupFileName, backupSummary, saveJson } from '../lib/backup';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const isOwner = computed(() => workspaces.current?.role === 'owner');

const downloading = ref(false);
const downloadError = ref('');
const downloaded = ref<string | null>(null); // what the last download held
async function download(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  downloading.value = true;
  downloadError.value = '';
  try {
    const file = await backupApi.download(ws);
    saveJson(backupFileName(file), file);
    downloaded.value = backupSummary(file);
  } catch (err) {
    downloadError.value = errorMessage(err);
  } finally {
    downloading.value = false;
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
        <button class="btn btn-primary" type="button" :disabled="downloading" @click="download">{{ downloading ? 'Preparing…' : 'Download backup' }}</button>
        <p v-if="downloaded !== null" class="muted small" aria-live="polite">Saved: {{ downloaded || 'an empty workspace' }}.</p>
        <p v-if="downloadError" class="form-error" role="alert">{{ downloadError }}</p>
      </template>
      <p v-else class="muted small">Only owners can download a backup: it holds everyone's brews.</p>
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
</style>

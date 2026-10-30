<script setup lang="ts">
// Restore a backup into a new workspace (docs/api/backup.md §2b): pick the
// file, see what's in it, name the new workspace, restore. Used on
// Settings → Data and on the workspaces page (a new server has no workspace
// to open Settings from). Nothing existing is changed.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backupApi, type BackupFile } from '../api/backup';
import { ApiError, errorMessage } from '../api/client';
import { backupSummary, isZip, readBackup, readBackupZip } from '../lib/backup';
import { formatWhen } from '../lib/format';
import { SLUG_PATTERN } from '../lib/slug';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const router = useRouter();

const file = ref<BackupFile | null>(null);
const zip = ref<File | null>(null); // a .zip backup, restored as it is (with its photos)
const fileError = ref('');
const name = ref('');
const slug = ref('');
const restoring = ref(false);
const error = ref('');

async function pick(event: Event): Promise<void> {
  const chosen = (event.target as HTMLInputElement).files?.[0];
  file.value = null;
  zip.value = null;
  fileError.value = '';
  error.value = '';
  if (!chosen) return;
  const zipped = isZip(chosen.name);
  const read = zipped ? readBackupZip(new Uint8Array(await chosen.arrayBuffer())) : readBackup(await chosen.text());
  if (!read.ok) {
    fileError.value = read.error;
    return;
  }
  file.value = read.file;
  if (zipped) zip.value = chosen;
  name.value = read.file.workspace.name;
  // The original address, unless one of your workspaces already has it.
  const taken = workspaces.workspaces.some((w) => w.slug === read.file.workspace.slug);
  slug.value = taken ? `${read.file.workspace.slug}-restored`.slice(0, 64) : read.file.workspace.slug;
}

const slugInvalid = computed(() => slug.value.length > 0 && !SLUG_PATTERN.test(slug.value));
const canRestore = computed(() => !!file.value && name.value.trim().length > 0 && SLUG_PATTERN.test(slug.value) && !restoring.value);

async function restore(): Promise<void> {
  if (!file.value || !canRestore.value) return;
  restoring.value = true;
  error.value = '';
  try {
    const { workspaceId } = zip.value
      ? await backupApi.restoreZip(name.value.trim(), slug.value, zip.value)
      : await backupApi.restore(name.value.trim(), slug.value, file.value);
    await workspaces.load();
    workspaces.select(workspaceId);
    await router.push({ name: 'home' });
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 409 && err.message === 'Slug already taken'
        ? 'That web address is taken. Try another.'
        : `Couldn't restore it: ${errorMessage(err)}`;
  } finally {
    restoring.value = false;
  }
}
</script>

<template>
  <form class="stack" novalidate @submit.prevent="restore">
    <div class="field">
      <label for="restore-file">Backup file</label>
      <input id="restore-file" type="file" accept="application/json,.json,application/zip,.zip" @change="pick" />
      <span v-if="fileError" class="field-error" role="alert">{{ fileError }}</span>
    </div>
    <template v-if="file">
      <p class="summary">
        <strong>{{ file.workspace.name }}</strong>, backed up {{ formatWhen(file.exportedAt) }}<br />
        <span class="muted small">{{ backupSummary(file) || 'No beans, recipes or brews yet' }}</span>
      </p>
      <div class="field">
        <label for="restore-name">New workspace name<span class="req" aria-hidden="true">*</span></label>
        <input id="restore-name" v-model="name" aria-required="true" type="text" maxlength="255" />
      </div>
      <div class="field">
        <label for="restore-slug">Web address<span class="req" aria-hidden="true">*</span></label>
        <input
          id="restore-slug"
          v-model.trim="slug"
          aria-required="true"
          type="text"
          inputmode="url"
          autocapitalize="none"
          spellcheck="false"
          maxlength="64"
          :aria-invalid="slugInvalid"
          aria-describedby="restore-slug-hint"
        />
        <span id="restore-slug-hint" class="hint" :class="{ invalid: slugInvalid }">
          3–64 lowercase letters, digits or hyphens. The public menu starts off.
        </span>
      </div>
      <p class="muted small">
        It becomes a new workspace that you own, with every brew in it under your name. Members aren't part of a backup: invite them again.
      </p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="!canRestore">{{ restoring ? 'Restoring…' : 'Restore as a new workspace' }}</button>
    </template>
  </form>
</template>

<style scoped>
.summary {
  margin: 0;
}
</style>

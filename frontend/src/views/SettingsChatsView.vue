<script setup lang="ts">
// Settings → AI chats (docs/api/chat.md §12): how much of your chat history
// to keep, never past the server's limits, and purging it.
import { computed, onMounted, ref } from 'vue';
import { chatsApi, chatSettingsApi, type ChatLimits, type ChatSettings } from '../api/chats';
import { errorMessage } from '../api/client';
import ChatLimitsFields from '../components/ChatLimitsFields.vue';
import ChatPurgeCard from '../components/ChatPurgeCard.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { saveBlob } from '../lib/backup';
import { formatBytes } from '../lib/chatSize';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const moving = ref(false);
const moved = ref('');
const moveError = ref('');

async function exportChats(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  moving.value = true;
  moved.value = '';
  moveError.value = '';
  try {
    saveBlob(`chats-${new Date().toISOString().slice(0, 10)}.zip`, await chatsApi.exportZip(ws));
  } catch (err) {
    moveError.value = errorMessage(err);
  } finally {
    moving.value = false;
  }
}

async function importChats(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const ws = workspaces.current?.id;
  if (!file || !ws) return;
  moving.value = true;
  moved.value = '';
  moveError.value = '';
  try {
    const { imported, skipped } = await chatsApi.importZip(ws, file);
    moved.value = `${imported} imported${skipped ? `, ${skipped} you already had` : ''}.`;
    await load();
  } catch (err) {
    moveError.value = errorMessage(err);
  } finally {
    moving.value = false;
  }
}

const data = ref<ChatSettings | null>(null);
const draft = ref<ChatLimits | null>(null);
const error = ref('');
const saving = ref(false);
const saved = ref(false);

async function load(): Promise<void> {
  try {
    data.value = await chatSettingsApi.get();
    draft.value = data.value.own;
    periodDraft.value = data.value.own.periodMaxBrews === null ? '' : String(data.value.own.periodMaxBrews);
  } catch (err) {
    error.value = errorMessage(err);
  }
}
onMounted(load);

const serverLine = computed(() => {
  if (!data.value) return '';
  const { maxBytes, maxDays } = data.value.server;
  const size = maxBytes === null ? 'no size limit' : `at most ${formatBytes(maxBytes)}`;
  return `This server allows ${size}, ${maxDays === null ? 'kept for any time' : `kept for up to ${maxDays} days`}.`;
});

// Your own cap on a live period's brews (docs/api/chat.md §12, "Periods"):
// empty = the workspace's.
const periodDraft = ref('');
const periodSaving = ref(false);
const periodSaved = ref(false);
const periodInvalid = computed(() => {
  if (periodDraft.value === '') return false;
  const n = Number(periodDraft.value);
  return !Number.isInteger(n) || n < 10 || n > 300;
});
async function savePeriod(): Promise<void> {
  if (!data.value || periodInvalid.value) return;
  periodSaving.value = true;
  periodSaved.value = false;
  error.value = '';
  try {
    const { maxBytes, maxDays } = data.value.own;
    data.value = await chatSettingsApi.save({ maxBytes, maxDays, periodMaxBrews: periodDraft.value === '' ? null : Number(periodDraft.value) });
    periodSaved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    periodSaving.value = false;
  }
}

async function save(): Promise<void> {
  if (!draft.value) return;
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    data.value = await chatSettingsApi.save(draft.value);
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="AI chats">
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-if="data">
      <section class="card stack">
        <h2>What to keep</h2>
        <p class="muted">Your chats take {{ formatBytes(data.usedBytes) }}, messages and photos together, across your workspaces. Past a limit, your oldest chats are deleted. {{ serverLine }}</p>
        <ChatLimitsFields id-prefix="own" :limits="data.own" no-limit-text="Only the server's limit applies." @change="draft = $event; saved = false" />
        <div><button class="btn btn-primary" type="button" :disabled="saving || !draft" @click="save">Save</button></div>
        <p v-if="saved" class="muted" aria-live="polite">Saved.</p>
      </section>
      <section class="card stack">
        <h2>Live periods</h2>
        <p class="muted">A live period, attached from the Brews filters in a chat, sends its newest brews in detail up to the workspace's number. A lower one here sends fewer, so each reply costs less.</p>
        <div class="field">
          <label for="own-period-max">Brews in detail, at most</label>
          <input id="own-period-max" v-model="periodDraft" type="number" inputmode="numeric" min="10" max="300" placeholder="The workspace's" :aria-invalid="periodInvalid" @input="periodSaved = false" />
          <p v-if="periodInvalid" class="form-error small">A whole number from 10 to 300, or empty for the workspace's.</p>
        </div>
        <div><button class="btn btn-primary" type="button" :disabled="periodSaving || periodInvalid" @click="savePeriod">Save</button></div>
        <p v-if="periodSaved" class="muted" aria-live="polite">Saved.</p>
      </section>
      <section v-if="workspaces.current" class="card stack">
        <h2>Export and import</h2>
        <p class="muted">Your chats in {{ workspaces.current.name }}, with their photos, as one file to keep or to bring into another workspace. Only your own chats are in it. Workspace backups leave chats out.</p>
        <div class="moves">
          <button class="btn btn-secondary" type="button" :disabled="moving" @click="exportChats">Export</button>
          <label class="btn btn-secondary" :class="{ disabled: moving }">
            Import
            <input type="file" accept=".zip,application/zip" class="visually-hidden" :disabled="moving" @change="importChats" />
          </label>
        </div>
        <p v-if="moved" class="muted" aria-live="polite">{{ moved }}</p>
        <p v-if="moveError" class="form-error" role="alert">{{ moveError }}</p>
      </section>
      <ChatPurgeCard title="Purge your chats" text="Deletes all your chats and their photos, in every workspace." warning="Every chat and photo of yours is deleted for good, in all your workspaces. This can't be undone." :purge="chatSettingsApi.purge" @purged="load" />
    </template>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.moves {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.moves label {
  cursor: pointer;
}
</style>

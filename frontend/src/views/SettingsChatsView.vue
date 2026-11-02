<script setup lang="ts">
// Settings → AI chats (docs/api/chat.md §12): how much of your chat history
// to keep, never past the server's limits, and purging it.
import { computed, onMounted, ref } from 'vue';
import { chatSettingsApi, type ChatLimits, type ChatSettings } from '../api/chats';
import { errorMessage } from '../api/client';
import ChatLimitsFields from '../components/ChatLimitsFields.vue';
import ChatPurgeCard from '../components/ChatPurgeCard.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { formatBytes } from '../lib/chatSize';

const data = ref<ChatSettings | null>(null);
const draft = ref<ChatLimits | null>(null);
const error = ref('');
const saving = ref(false);
const saved = ref(false);

async function load(): Promise<void> {
  try {
    data.value = await chatSettingsApi.get();
    draft.value = data.value.own;
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
</style>

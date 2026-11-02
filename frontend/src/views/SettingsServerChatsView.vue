<script setup lang="ts">
// Settings → Server → AI chats (docs/api/chat.md §12): the most anyone on this
// server can keep, the daily message limit, and purging everyone's chats.
import { onMounted, ref } from 'vue';
import type { ChatLimits } from '../api/chats';
import { errorMessage } from '../api/client';
import { serverApi, type ServerChat } from '../api/server';
import ChatLimitsFields from '../components/ChatLimitsFields.vue';
import ChatPurgeCard from '../components/ChatPurgeCard.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { formatBytes } from '../lib/chatSize';

const data = ref<ServerChat | null>(null);
const draft = ref<ChatLimits | null>(null);
const capped = ref(true);
const daily = ref(200);
const error = ref('');
const saving = ref(false);
const saved = ref(false);

function show(view: ServerChat): void {
  data.value = view;
  draft.value = view.limits;
  capped.value = view.limits.dailyMessages !== null;
  if (view.limits.dailyMessages !== null) daily.value = view.limits.dailyMessages;
}
async function load(): Promise<void> {
  try {
    show(await serverApi.chat());
  } catch (err) {
    error.value = errorMessage(err);
  }
}
onMounted(load);

async function save(): Promise<void> {
  if (!draft.value) return;
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    show(await serverApi.saveChat({ maxBytes: draft.value.maxBytes, maxDays: draft.value.maxDays, dailyMessages: capped.value ? daily.value : null }));
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
        <h2>Limits for each person</h2>
        <p class="muted">Chats on this server take {{ formatBytes(data.usedBytes) }}. People can set stricter limits for themselves, never looser ones. Past a limit, a person's oldest chats are deleted.</p>
        <ChatLimitsFields id-prefix="server" :limits="data.limits" no-limit-text="Unlimited." @change="draft = $event; saved = false" />
        <fieldset class="daily">
          <legend>Messages a day</legend>
          <label class="checkbox"><input v-model="capped" type="checkbox" @change="saved = false" /> Limit messages per person</label>
          <div v-if="capped" class="row">
            <label for="server-daily">Messages in 24 hours</label>
            <input id="server-daily" v-model.number="daily" type="number" min="1" max="100000" step="1" inputmode="numeric" />
          </div>
        </fieldset>
        <div><button class="btn btn-primary" type="button" :disabled="saving || !draft || (capped && !(daily >= 1))" @click="save">Save</button></div>
        <p v-if="saved" class="muted" aria-live="polite">Saved.</p>
      </section>
      <ChatPurgeCard title="Purge all chats" text="Deletes everyone's chats and their photos, on the whole server." warning="Every person's chats and photos are deleted for good, in every workspace on this server. This can't be undone." :purge="serverApi.purgeChats" @purged="load" />
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
.daily {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: none;
}
legend {
  padding: 0;
  font-weight: 600;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.row input {
  width: 110px;
}
</style>

<script setup lang="ts">
// Settings → Server → AI chats (docs/api/chat.md §12): the most anyone on this
// server can keep, the daily message limit, and purging everyone's chats.
import { computed, onMounted, ref } from 'vue';
import type { ChatLimits } from '../api/chats';
import { errorMessage } from '../api/client';
import { serverApi, type ServerChat, type ServerChatInput, type ServerChatPreview } from '../api/server';
import ChatLimitsFields from '../components/ChatLimitsFields.vue';
import ChatPurgeCard from '../components/ChatPurgeCard.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { formatBytes } from '../lib/chatSize';

const data = ref<ServerChat | null>(null);
const draft = ref<ChatLimits | null>(null);
const capped = ref(true);
const daily = ref(200);
// Pinned chats per person (docs/api/chat.md §12, "Pinned chats"). Lowering
// it unpins nothing.
const pinCapped = ref(true);
const maxPinned = ref(20);
const pinLowered = computed(() => pinCapped.value && data.value !== null && (data.value.limits.maxPinned === null || maxPinned.value < data.value.limits.maxPinned));
const error = ref('');
const saving = ref(false);
const saved = ref(false);

function show(view: ServerChat): void {
  data.value = view;
  draft.value = view.limits;
  capped.value = view.limits.dailyMessages !== null;
  if (view.limits.dailyMessages !== null) daily.value = view.limits.dailyMessages;
  pinCapped.value = view.limits.maxPinned !== null;
  if (view.limits.maxPinned !== null) maxPinned.value = view.limits.maxPinned;
}
async function load(): Promise<void> {
  try {
    show(await serverApi.chat());
  } catch (err) {
    error.value = errorMessage(err);
  }
}
onMounted(load);

// A save that would delete people's chats asks first, with how many, and
// "I understand" (CLAUDE.md rule 7; docs/api/chat.md §12, "Saving limits").
// Pinned chats a new age limit catches are kept a week, so only those: a
// plain confirm.
const preview = ref<ServerChatPreview | null>(null);
const understood = ref(false);
const deletesNow = computed(() => (preview.value?.chats ?? 0) > 0);
const input = (): ServerChatInput | null =>
  draft.value ? { maxBytes: draft.value.maxBytes, maxDays: draft.value.maxDays, dailyMessages: capped.value ? daily.value : null, maxPinned: pinCapped.value ? maxPinned.value : null } : null;
async function save(confirmed = false): Promise<void> {
  const limits = input();
  if (!limits) return;
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    if (!confirmed) {
      const p = await serverApi.previewChat(limits);
      if (p.chats > 0 || p.pinnedLater > 0) {
        understood.value = false;
        preview.value = p;
        return;
      }
    }
    preview.value = null;
    show(await serverApi.saveChat(limits));
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const previewText = computed(() => {
  const p = preview.value;
  if (!p) return [];
  const lines: string[] = [];
  if (p.chats) {
    lines.push(`Saving deletes ${plural(p.chats, 'chat', 'chats')} from ${plural(p.people, 'person', 'people')} for good${p.pinned ? ` (${p.pinned} of them pinned, over the size limit)` : ''}. This can't be undone.`);
  }
  if (p.pinnedLater && p.pinnedLaterOn) {
    const on = new Date(p.pinnedLaterOn).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    lines.push(`${plural(p.pinnedLater, 'pinned chat is', 'pinned chats are')} past the new age limit: kept until ${on}, so their owners can export them, then deleted.`);
  }
  return lines;
});
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
        <p class="muted small">Pinned chats stay at the top of a person's list and are kept from their own age limit, but not from this one: an age limit set here deletes pinned chats too, a week after you save it. For size, pinned chats go only after every unpinned one.</p>
        <fieldset class="daily">
          <legend>Pinned chats</legend>
          <label class="checkbox"><input v-model="pinCapped" type="checkbox" @change="saved = false" /> Limit pinned chats per person</label>
          <div v-if="pinCapped" class="row">
            <label for="server-pinned">Pinned chats, across all their workspaces</label>
            <input id="server-pinned" v-model.number="maxPinned" type="number" min="1" max="1000" step="1" inputmode="numeric" @input="saved = false" />
          </div>
          <p v-if="pinLowered" class="muted small">People with more pinned chats keep them, but can't pin more until they're under it.</p>
        </fieldset>
        <div><button class="btn btn-primary" type="button" :disabled="saving || !draft || (capped && !(daily >= 1)) || (pinCapped && !(maxPinned >= 1 && maxPinned <= 1000))" @click="save()">Save</button></div>
        <p v-if="saved" class="muted" aria-live="polite">Saved.</p>
      </section>
      <ConfirmDialog :open="preview !== null" :title="deletesNow ? 'Delete people\'s chats?' : 'Pinned chats will go'" @cancel="preview = null">
        <p v-for="line in previewText" :key="line">{{ line }}</p>
        <label v-if="deletesNow" class="checkbox">
          <input v-model="understood" type="checkbox" />
          I understand
        </label>
        <template #actions>
          <button :class="['btn', deletesNow ? 'btn-danger' : 'btn-primary']" type="button" :disabled="saving || (deletesNow && !understood)" @click="save(true)">
            {{ saving ? 'Saving…' : deletesNow ? 'Save and delete' : 'Save' }}
          </button>
          <button class="btn btn-secondary" type="button" :disabled="saving" @click="preview = null">Cancel</button>
        </template>
      </ConfirmDialog>
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

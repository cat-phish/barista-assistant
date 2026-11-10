<script setup lang="ts">
// Pinning at the pin limit (docs/api/chat.md §12, "Pinned chats"): unpin
// the longest pinned chat, or one you pick, to pin this one in its place,
// with Export to keep a copy first. Unpinning can be undone, so there's no
// "I understand" (CLAUDE.md rule 7).
import { computed, ref, watch } from 'vue';
import type { PinLimit, PinnedChatRef } from '../api/chats';
import { errorMessage } from '../api/client';
import { formatAdded } from '../lib/format';
import ChatExportMenu, { type ChatExportFormat } from './ChatExportMenu.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{
  open: boolean;
  limit: PinLimit | null;
  title: string; // the chat being pinned
  workspaceId: string | null; // the one you're in: others are named
  swap: (unpin: PinnedChatRef) => Promise<unknown>;
  exportChat: (chat: PinnedChatRef, format: ChatExportFormat) => Promise<unknown>;
}>();
const emit = defineEmits<{ cancel: []; done: [] }>();

const busy = ref(false);
const error = ref('');
const oldest = computed(() => props.limit?.pinned[0] ?? null);
watch(
  () => props.open,
  (open) => {
    if (open) error.value = '';
  },
);

async function run(task: () => Promise<unknown>, after?: () => void) {
  busy.value = true;
  error.value = '';
  try {
    await task();
    after?.();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
const unpin = (chat: PinnedChatRef) => run(() => props.swap(chat), () => emit('done'));
const exportOne = (chat: PinnedChatRef, format: ChatExportFormat) => run(() => props.exportChat(chat, format));
</script>

<template>
  <ConfirmDialog :open="open" title="Pinned chats are full" @cancel="emit('cancel')">
    <template v-if="limit">
      <p>
        You have {{ limit.pinnedCount }} pinned chats{{ limit.pinnedCount > limit.maxPinned ? `, over the ${limit.maxPinned}` : ', the most' }} this server allows. Unpin one to pin
        “{{ title }}”.
      </p>
      <ul class="pinned">
        <li v-for="p in limit.pinned" :key="p.id">
          <span class="name">
            <span class="chat-title">{{ p.title }}</span>
            <span class="muted small">{{ p.workspaceId !== workspaceId ? `${p.workspaceName} · ` : '' }}pinned {{ formatAdded(p.pinnedAt) }}</span>
          </span>
          <ChatExportMenu :formats="['md', 'zip']" :label="`Export ${p.title}`" @pick="exportOne(p, $event)" />
          <button type="button" class="btn-link" :disabled="busy" :aria-label="`Unpin ${p.title} and pin this`" @click="unpin(p)">Unpin and pin this</button>
        </li>
      </ul>
      <p class="muted small">Unpinned chats are kept, under your age and size limits. To keep a copy as PDF, open the chat and use Export there.</p>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template #actions>
      <button v-if="oldest" class="btn btn-primary" type="button" :disabled="busy" @click="unpin(oldest)">Unpin “{{ oldest.title }}” and pin this</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.pinned {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--border);
}
.name {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 10rem;
}
.chat-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
li .btn-link {
  min-height: var(--tap);
}
</style>

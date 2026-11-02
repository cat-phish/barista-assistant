<script setup lang="ts">
// Insights → Chat (docs/api/chat.md §12): your own conversations with the AI,
// replies appearing as they're written. Nobody else in the workspace sees them.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { chatsApi, type Chat, type ChatMessage } from '../../api/chats';
import { ApiError } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspace';

const MESSAGE_MAX = 4000;

const workspaces = useWorkspaceStore();
const workspaceId = computed(() => workspaces.current?.id ?? null);

const chats = ref<Chat[]>([]);
const chatId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const draft = ref('');
const sending = ref(false);
const error = ref('');
const thread = ref<HTMLElement | null>(null);

let stopFollowing: (() => void) | null = null;
const writing = computed(() => messages.value.some((m) => m.status === 'pending'));

function say(err: unknown) {
  error.value = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}
async function toBottom() {
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight });
}
function stop() {
  stopFollowing?.();
  stopFollowing = null;
}

async function refreshList() {
  if (!workspaceId.value) return;
  chats.value = (await chatsApi.list(workspaceId.value)).chats;
}

function replace(message: ChatMessage) {
  messages.value = messages.value.map((m) => (m.id === message.id ? message : m));
}

// The reply is rebuilt from the stream, which starts from its first piece.
function follow(reply: ChatMessage) {
  stop();
  if (!workspaceId.value || !chatId.value) return;
  const ws = workspaceId.value;
  const id = chatId.value;
  replace({ ...reply, content: '' });
  stopFollowing = chatsApi.follow(ws, id, reply.id, {
    text(text) {
      const current = messages.value.find((m) => m.id === reply.id);
      if (current) replace({ ...current, content: current.content + text });
      void toBottom();
    },
    done(message) {
      stop();
      replace(message);
      void toBottom();
      void refreshList().catch(() => undefined);
    },
    closed() {
      stop();
      void open(id);
    },
  });
}

async function open(id: string) {
  if (!workspaceId.value) return;
  stop();
  error.value = '';
  try {
    const pair = await chatsApi.get(workspaceId.value, id);
    chatId.value = id;
    messages.value = pair.messages;
    const pending = pair.messages.find((m) => m.status === 'pending');
    if (pending) follow(pending);
    await toBottom();
  } catch (err) {
    say(err);
  }
}

function newChat() {
  stop();
  chatId.value = null;
  messages.value = [];
  error.value = '';
}

async function send() {
  const content = draft.value.trim();
  if (!content || sending.value || writing.value || !workspaceId.value) return;
  sending.value = true;
  error.value = '';
  try {
    const pair = chatId.value ? await chatsApi.send(workspaceId.value, chatId.value, content) : await chatsApi.start(workspaceId.value, content);
    chatId.value = pair.chat.id;
    messages.value = [...messages.value, ...pair.messages];
    draft.value = '';
    const reply = pair.messages.find((m) => m.status === 'pending');
    if (reply) follow(reply);
    await refreshList();
    await toBottom();
  } catch (err) {
    say(err);
  } finally {
    sending.value = false;
  }
}

async function remove(chat: Chat) {
  if (!workspaceId.value) return;
  try {
    await chatsApi.remove(workspaceId.value, chat.id);
    if (chatId.value === chat.id) newChat();
    await refreshList();
  } catch (err) {
    say(err);
  }
}

// Enter sends; Shift+Enter is a new line.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

watch(
  workspaceId,
  () => {
    newChat();
    void refreshList().catch(say);
  },
  { immediate: true },
);
onBeforeUnmount(stop);
</script>

<template>
  <div class="chat">
    <aside class="card chat-list" aria-label="Your chats">
      <button type="button" class="btn-link" :disabled="chatId === null" @click="newChat">New chat</button>
      <ul v-if="chats.length">
        <li v-for="c in chats" :key="c.id" :class="{ current: c.id === chatId }">
          <button type="button" class="chat-open" :aria-current="c.id === chatId ? 'true' : undefined" @click="open(c.id)">{{ c.title }}</button>
          <button type="button" class="btn-link chat-delete" :aria-label="`Delete chat: ${c.title}`" @click="remove(c)">×</button>
        </li>
      </ul>
    </aside>

    <section class="card chat-main" aria-label="Conversation">
      <div ref="thread" class="thread" aria-live="polite">
        <p v-if="!messages.length" class="muted">Ask about your coffee. Only you can see your chats.</p>
        <div v-for="m in messages" :key="m.id" class="message" :class="m.role">
          <p v-if="m.content" class="text">{{ m.content }}</p>
          <p v-if="m.status === 'pending' && !m.content" class="muted">Thinking…</p>
          <p v-if="m.status === 'failed'" class="form-error" role="alert">{{ m.error ?? 'The reply failed' }}. Send your message again to retry.</p>
        </div>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <form v-if="workspaces.canEdit" class="composer" @submit.prevent="send">
        <label for="chat-message" class="visually-hidden">Message</label>
        <textarea id="chat-message" v-model="draft" rows="2" :maxlength="MESSAGE_MAX" placeholder="Ask about a bean, a brew, a recipe…" @keydown="onKey"></textarea>
        <button type="submit" class="btn-primary" :disabled="!draft.trim() || sending || writing">Send</button>
      </form>
      <p v-else class="muted">Viewers can read their chats but can't send messages.</p>
    </section>
  </div>
</template>

<style scoped>
.chat {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
}
.chat-list ul {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}
.chat-list li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  border-radius: 6px;
}
.chat-list li.current {
  background: var(--brand-tint);
}
.chat-open {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: var(--space-1) var(--space-2);
  overflow: hidden;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.chat-delete {
  min-width: 32px;
  min-height: 40px;
}
.chat-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.thread {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 240px;
  max-height: 60vh;
  overflow-y: auto;
}
.message {
  max-width: 85%;
}
.message.user {
  align-self: flex-end;
  padding: var(--space-1) var(--space-2);
  border-radius: 10px;
  background: var(--brand-tint);
}
.message p {
  margin: 0;
}
.text {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.composer {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  min-width: 0;
  resize: vertical;
}
@media (max-width: 720px) {
  .chat {
    grid-template-columns: minmax(0, 1fr);
  }
  .chat-list ul {
    max-height: 160px;
    overflow-y: auto;
  }
  .message {
    max-width: 100%;
  }
}
</style>

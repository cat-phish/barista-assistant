<script setup lang="ts">
// Insights → Chat (docs/api/chat.md §12): your own conversations with the AI,
// replies appearing as they're written. Nobody else in the workspace sees them.
// Fills the screen below the tabs: the thread scrolls, the composer stays at
// the bottom. On a phone the chat list is a drawer behind "Chats".
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { chatSettingsApi, chatsApi, type Chat, type ChatAttachment, type ChatMessage, type ChatPhoto, type ChatProposal } from '../../api/chats';
import { ApiError, errorMessage } from '../../api/client';
import ChatAttachChips from '../../components/ChatAttachChips.vue';
import ChatAttachDialog from '../../components/ChatAttachDialog.vue';
import ChatList from '../../components/ChatList.vue';
import ChatMarkdown from '../../components/ChatMarkdown.vue';
import ChatProposalCard from '../../components/ChatProposalCard.vue';
import { usePreferences } from '../../composables/usePreferences';
import { attachKey } from '../../lib/chatAttach';
import { estimateTokens, tokenWarning } from '../../lib/chatTokens';
import { proposalRoute } from '../../lib/chatProposal';
import { formatWhen } from '../../lib/format';
import { droppedImages, pastedImages } from '../../lib/pastedImages';
import { useChatProposalStore } from '../../stores/chatProposal';
import { useWorkspaceStore } from '../../stores/workspace';

const MESSAGE_MAX = 4000;
const PHOTOS_MAX = 4;
const SUGGESTIONS = ['Why did my last two brews taste different?', 'What should I change next time with this bean?', 'Compare these recipes for me.'];

const workspaces = useWorkspaceStore();
const { settings } = usePreferences();
const workspaceId = computed(() => workspaces.current?.id ?? null);

const chats = ref<Chat[]>([]);
const chatId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const draft = ref('');
const sending = ref(false);
const canSend = ref(true);
const error = ref('');
const thread = ref<HTMLElement | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);
const composing = computed(() => workspaces.canEdit && canSend.value);
const title = computed(() => chats.value.find((c) => c.id === chatId.value)?.title ?? 'New chat');

// What the next message attaches, picked in ChatAttachDialog, up to the
// workspace's limit (docs/api/chat.md §12).
const attachments = ref<ChatAttachment[]>([]);
const picking = ref(false);
const attachMax = computed(() => settings.value.chatMaxAttachments ?? 50);
// A live period's cap on its brews: the workspace's, or your own lower one.
const ownPeriodCap = ref<number | null>(null);
const periodCap = computed(() => {
  const ws = settings.value.chatPeriodMaxBrews ?? 60;
  return ownPeriodCap.value ? Math.min(ws, ownPeriodCap.value) : ws;
});
void chatSettingsApi
  .get()
  .then((s) => (ownPeriodCap.value = s.own.periodMaxBrews))
  .catch(() => undefined);
// How many brews each period held when picked, for the token estimate.
const periodBrews = ref(new Map<string, number>());
function attachPicked(picked: ChatAttachment[], counts: Map<string, number>) {
  attachments.value = picked;
  periodBrews.value = counts;
  picking.value = false;
}
// What the next reply is sent: this message's and what the chat attached
// before, each once (the worker's attachedIn), as a rough count of tokens.
const tokenNote = computed(() => {
  const all = [...messages.value.flatMap((m) => m.attachments), ...attachments.value];
  const unique = [...new Map(all.map((a) => [attachKey(a), a])).values()].slice(-attachMax.value);
  return tokenWarning(estimateTokens(unique, periodBrews.value, periodCap.value));
});
function detach(item: ChatAttachment) {
  attachments.value = attachments.value.filter((a) => attachKey(a) !== attachKey(item));
}

// A reply's proposals (docs/api/chat.md §12, "Proposals"): Open hands one
// to the page it fills in; Dismiss is saved on the chat.
const router = useRouter();
const proposalStore = useChatProposalStore();
const proposalBusy = ref<string | null>(null); // the message being saved
function openProposal(p: ChatProposal) {
  proposalStore.give(p);
  void router.push(proposalRoute(p));
}
async function setProposal(m: ChatMessage, index: number, state: ChatProposal['state']) {
  if (!workspaceId.value || !chatId.value) return;
  proposalBusy.value = m.id;
  error.value = '';
  try {
    m.proposals = (await chatsApi.setProposal(workspaceId.value, chatId.value, m.id, index, state)).proposals;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    proposalBusy.value = null;
  }
}

// Photos go up as they're picked, pasted or dropped, and are sent with the
// next message.
const photos = ref<ChatPhoto[]>([]);
const uploading = ref(false);
const photoUrl = (id: string) => (workspaceId.value ? chatsApi.photoUrl(workspaceId.value, id) : '');
async function addFiles(picked: File[]) {
  if (!workspaceId.value || !picked.length || uploading.value) return;
  const files = picked.slice(0, PHOTOS_MAX - photos.value.length);
  error.value = '';
  if (files.length < picked.length) error.value = `Up to ${PHOTOS_MAX} photos a message.`;
  if (!files.length) return;
  uploading.value = true;
  try {
    for (const file of files) photos.value = [...photos.value, (await chatsApi.addPhoto(workspaceId.value, file)).photo];
  } catch (err) {
    say(err);
  } finally {
    uploading.value = false;
  }
}
function addPhotos(e: Event) {
  const picked = e.target as HTMLInputElement;
  const files = [...(picked.files ?? [])];
  picked.value = '';
  void addFiles(files);
}
// A pasted picture goes up as a photo; pasted text goes in the message as usual.
function onPaste(e: ClipboardEvent) {
  const files = pastedImages(e.clipboardData?.items ?? []);
  if (!files.length) return;
  e.preventDefault();
  void addFiles(files);
}
// Files dragged over the conversation highlight the composer; dropping adds
// the images. Counted, since dragenter and dragleave fire for every child crossed.
const dragDepth = ref(0);
const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
function onDragEnter(e: DragEvent) {
  if (!composing.value || !carriesFiles(e)) return;
  e.preventDefault();
  dragDepth.value++;
}
function onDragOver(e: DragEvent) {
  if (composing.value && carriesFiles(e)) e.preventDefault();
}
function onDragLeave(e: DragEvent) {
  if (carriesFiles(e)) dragDepth.value = Math.max(0, dragDepth.value - 1);
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0;
  if (!composing.value || !carriesFiles(e)) return;
  e.preventDefault();
  void addFiles(droppedImages(e.dataTransfer?.files ?? []));
}

let stopFollowing: (() => void) | null = null;
const writing = computed(() => messages.value.some((m) => m.status === 'pending'));

function say(err: unknown) {
  error.value = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

// The thread follows a reply as it's written while you're at the bottom;
// scrolled up to read, it stays put and offers a way down instead.
const atBottom = ref(true);
const newBelow = ref(false);
function onScroll() {
  const t = thread.value;
  atBottom.value = !t || t.scrollHeight - t.scrollTop - t.clientHeight < 80;
  if (atBottom.value) newBelow.value = false;
}
async function toBottom(force = false) {
  await nextTick();
  if (!force && !atBottom.value) {
    newBelow.value = true;
    return;
  }
  thread.value?.scrollTo({ top: thread.value.scrollHeight });
  atBottom.value = true;
  newBelow.value = false;
}
function stop() {
  stopFollowing?.();
  stopFollowing = null;
}

async function refreshList() {
  if (!workspaceId.value) return;
  const list = await chatsApi.list(workspaceId.value);
  chats.value = list.chats;
  canSend.value = list.canSend;
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
  listOpen.value = false;
  try {
    const pair = await chatsApi.get(workspaceId.value, id);
    chatId.value = id;
    messages.value = pair.messages;
    const pending = pair.messages.find((m) => m.status === 'pending');
    if (pending) follow(pending);
    await toBottom(true);
  } catch (err) {
    say(err);
  }
}

function newChat() {
  stop();
  chatId.value = null;
  messages.value = [];
  error.value = '';
  listOpen.value = false;
  void nextTick(() => input.value?.focus());
}

async function send() {
  const content = draft.value.trim();
  if (!content || sending.value || writing.value || uploading.value || !workspaceId.value) return;
  sending.value = true;
  error.value = '';
  try {
    const body = { content, attachments: attachments.value.map(({ kind, id, chart }) => ({ kind, id, ...(chart ? { chart } : {}) })), photoIds: photos.value.map((p) => p.id) };
    const pair = chatId.value ? await chatsApi.send(workspaceId.value, chatId.value, body) : await chatsApi.start(workspaceId.value, body);
    chatId.value = pair.chat.id;
    messages.value = [...messages.value, ...pair.messages];
    draft.value = '';
    attachments.value = [];
    photos.value = [];
    picking.value = false;
    const reply = pair.messages.find((m) => m.status === 'pending');
    if (reply) follow(reply);
    await refreshList();
    await toBottom(true);
  } catch (err) {
    say(err);
  } finally {
    sending.value = false;
  }
}

// A failed reply: your message goes back in the box, with what it attached,
// to send again.
function retry(failed: ChatMessage) {
  const asked = [...messages.value].reverse().find((m) => m.role === 'user' && m.position < failed.position);
  if (!asked) return;
  draft.value = asked.content;
  attachments.value = asked.attachments.slice(0, attachMax.value);
  void nextTick(() => input.value?.focus());
}

function suggest(text: string) {
  draft.value = text;
  void nextTick(() => input.value?.focus());
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
// The box grows with what's typed, up to about eight lines, then scrolls.
function grow() {
  const el = input.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}
watch(draft, () => void nextTick(grow));

// Message times: today's as a time, older ones with the day.
function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : formatWhen(iso);
}

// The chat list on a phone: a drawer.
const listOpen = ref(false);
const drawer = ref<HTMLDialogElement | null>(null);
watch(
  listOpen,
  (on) => {
    if (on && !drawer.value?.open) drawer.value?.showModal();
    if (!on && drawer.value?.open) drawer.value.close();
  },
  { flush: 'post' },
);
function onDrawerClick(e: MouseEvent) {
  if (e.target === drawer.value) listOpen.value = false; // the backdrop
}

// Down to the bottom of the screen, from wherever the tabs end.
const shell = ref<HTMLElement | null>(null);
const height = ref('');
function fit() {
  const el = shell.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const page = el.closest('.page');
  const below = page ? parseFloat(getComputedStyle(page).paddingBottom) || 0 : 16;
  const view = window.visualViewport?.height ?? window.innerHeight;
  height.value = `${Math.max(420, Math.floor(view - top - below))}px`;
}
onMounted(() => {
  fit();
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', fit);
  window.visualViewport?.removeEventListener('resize', fit);
});

watch(
  workspaceId,
  () => {
    newChat();
    attachments.value = [];
    photos.value = [];
    void refreshList().catch(say);
  },
  { immediate: true },
);
onBeforeUnmount(stop);
</script>

<template>
  <div ref="shell" class="chat" :style="{ height }">
    <aside class="card side" aria-label="Your chats">
      <ChatList :chats="chats" :current="chatId" @open="open" @remove="remove" @new="newChat" />
    </aside>

    <dialog ref="drawer" class="drawer" aria-label="Your chats" @cancel.prevent="listOpen = false" @click="onDrawerClick">
      <div class="drawer-body">
        <div class="drawer-head">
          <h2>Chats</h2>
          <button type="button" class="btn-link close" aria-label="Close" @click="listOpen = false">✕</button>
        </div>
        <ChatList :chats="chats" :current="chatId" @open="open" @remove="remove" @new="newChat" />
      </div>
    </dialog>

    <section class="card main" aria-label="Conversation" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
      <header class="bar">
        <button type="button" class="btn-link phone-only" @click="listOpen = true">☰ Chats</button>
        <h2 class="title">{{ title }}</h2>
        <button type="button" class="btn-link phone-only" :disabled="chatId === null" @click="newChat">+ New</button>
      </header>

      <div ref="thread" class="thread" aria-live="polite" @scroll="onScroll">
        <div v-if="!messages.length" class="welcome">
          <h3>Ask about your coffee</h3>
          <p class="muted">Attach brews, beans or recipes for the AI to look at, or a photo of a puck or a bag. Only you can see your chats.</p>
          <div v-if="composing" class="suggestions">
            <button v-for="s in SUGGESTIONS" :key="s" type="button" class="suggestion" @click="suggest(s)">{{ s }}</button>
          </div>
        </div>
        <div v-for="m in messages" :key="m.id" class="message" :class="m.role">
          <span v-if="m.role === 'assistant'" class="who" aria-hidden="true">AI</span>
          <div class="bubble">
            <ChatAttachChips :attachments="m.attachments" class="message-chips" />
            <div v-if="m.photos.length" class="photos">
              <img v-for="p in m.photos" :key="p.id" :src="photoUrl(p.id)" :width="p.width" :height="p.height" alt="Photo you sent" loading="lazy" />
            </div>
            <template v-if="m.content">
              <ChatMarkdown v-if="m.role === 'assistant'" :source="m.content" />
              <p v-else class="text">{{ m.content }}</p>
            </template>
            <span v-if="m.status === 'pending' && !m.content" class="typing" role="status" aria-label="The AI is writing"><span></span><span></span><span></span></span>
            <div v-if="m.status === 'failed'" class="failed" role="alert">
              <span>{{ m.error ?? 'The reply failed' }}.</span>
              <button v-if="composing" type="button" class="btn-link" @click="retry(m)">Retry</button>
            </div>
            <ChatProposalCard
              v-for="(p, i) in m.proposals"
              :key="i"
              :proposal="p"
              :can-open="workspaces.canEdit"
              :busy="proposalBusy === m.id"
              @open="openProposal(p)"
              @state="setProposal(m, i, $event)"
            />
          </div>
          <span class="when">{{ timeOf(m.createdAt) }}</span>
        </div>
      </div>
      <button v-if="newBelow" type="button" class="new-below" @click="toBottom(true)">↓ New reply</button>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <form v-if="composing" class="composer" :class="{ dropping: dragDepth > 0 }" @submit.prevent="send">
        <div v-if="photos.length || attachments.length" class="pending">
          <div v-if="photos.length" class="photos">
            <span v-for="p in photos" :key="p.id" class="pending-photo">
              <img :src="photoUrl(p.id)" :width="p.width" :height="p.height" alt="Photo to send" />
              <button type="button" class="remove-photo" aria-label="Remove this photo" @click="photos = photos.filter((x) => x !== p)">×</button>
            </span>
          </div>
          <ChatAttachChips :attachments="attachments" removable @remove="detach" />
        </div>
        <p v-if="tokenNote" class="token-note small" role="status">{{ tokenNote }}</p>
        <label for="chat-message" class="visually-hidden">Message</label>
        <textarea
          id="chat-message"
          ref="input"
          v-model="draft"
          rows="1"
          :maxlength="MESSAGE_MAX"
          placeholder="Ask about a bean, a brew, a recipe…"
          @keydown="onKey"
          @paste="onPaste"
        ></textarea>
        <div class="tools">
          <button type="button" class="tool" @click="picking = true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5 12.6 20a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>
            {{ attachments.length ? `Attached (${attachments.length})` : 'Attach' }}
          </button>
          <label v-if="photos.length < PHOTOS_MAX" class="tool">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></svg>
            {{ uploading ? 'Adding…' : 'Photo' }}
            <input type="file" accept="image/*" multiple class="visually-hidden" :disabled="uploading" @change="addPhotos" />
          </label>
          <span class="muted small hint">Enter sends · Shift+Enter for a new line</span>
          <button type="submit" class="btn btn-primary send" :disabled="!draft.trim() || sending || writing || uploading">
            Send
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      </form>
      <p v-else-if="!canSend" class="muted notice">Chat is turned off for you here. You can still read your chats.</p>
      <p v-else class="muted notice">Viewers can read their chats but can't send messages.</p>
      <ChatAttachDialog :open="picking" :selected="attachments" :max="attachMax" :period-cap="periodCap" :period-brews="periodBrews" @close="picking = false" @done="attachPicked" />
    </section>
  </div>
</template>

<style scoped>
.token-note {
  margin: 0;
  color: var(--warning);
}
.chat {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: var(--space-3);
  min-height: 420px;
}
.side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-3);
}
.main {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
}
.title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phone-only {
  display: none;
  flex: none;
  min-height: var(--tap);
}
.thread {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  flex: 1;
  min-height: 0;
  padding: var(--space-3);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.welcome {
  margin: auto;
  max-width: 30rem;
  text-align: center;
}
.welcome h3 {
  margin: 0 0 var(--space-1);
  font-size: 1.15rem;
}
.welcome p {
  margin: 0;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.suggestion {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--brand-line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--brand);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}
.suggestion:hover,
.suggestion:focus-visible {
  background: var(--brand-tint);
}

.message {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px var(--space-2);
  max-width: min(85%, 46rem);
}
.message.user {
  align-self: flex-end;
  grid-template-columns: minmax(0, 1fr);
  justify-items: end;
}
.who {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--surface);
  font-size: 0.7rem;
  font-weight: 700;
}
.bubble {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: 14px;
}
.message.user .bubble {
  border-bottom-right-radius: 4px;
  background: var(--brand-tint);
}
.message.assistant .bubble {
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
  background: var(--surface);
}
.when {
  grid-column: -2;
  color: var(--text-muted);
  font-size: 0.75rem;
}
.message.user .when {
  grid-column: 1;
}
.message-chips {
  margin-bottom: var(--space-1);
}
.text {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  color: var(--danger);
}
.failed .btn-link {
  min-height: 0;
  padding: 0;
}
.typing {
  display: inline-flex;
  gap: 4px;
  padding: var(--space-1) 0;
}
.typing span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: blink 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) {
  animation-delay: 0.2s;
}
.typing span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .typing span {
    animation: none;
    opacity: 0.6;
  }
}
.photos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
}
.photos img {
  display: block;
  width: auto;
  max-width: 180px;
  height: auto;
  max-height: 180px;
  border-radius: 8px;
}
.new-below {
  position: absolute;
  left: 50%;
  bottom: 9rem;
  transform: translateX(-50%);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--brand-line);
  border-radius: 999px;
  background: var(--surface);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  color: var(--brand);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.main > .form-error {
  margin: 0 var(--space-3);
}

.composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 var(--space-3) var(--space-3);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}
.composer:focus-within {
  border-color: var(--focus);
}
/* Files dragged over the conversation: dropping them adds photos. */
.composer.dropping {
  border-style: dashed;
  border-color: var(--focus);
  background: var(--brand-tint);
}
.pending {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border);
}
.pending .photos {
  margin: 0;
}
.pending .photos img {
  max-width: 72px;
  max-height: 72px;
}
.pending-photo {
  position: relative;
}
.remove-photo {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  line-height: 1;
  cursor: pointer;
}
.composer textarea {
  width: 100%;
  min-height: 0;
  padding: var(--space-1);
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  resize: none;
  outline: none;
  box-shadow: none;
}
.tools {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--brand);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.tool:hover,
.tool:focus-within,
.tool:focus-visible {
  background: var(--brand-tint);
}
.tools svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tool circle {
  fill: currentColor;
  stroke: none;
}
.hint {
  flex: 1;
  text-align: right;
  white-space: nowrap;
}
.send {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.notice {
  margin: 0;
  padding: var(--space-3);
  border-top: 1px solid var(--border);
}

.drawer {
  margin: 0;
  width: min(320px, 85vw);
  max-width: none;
  height: 100dvh;
  max-height: none;
  padding: 0;
  border: none;
  background: var(--surface);
  color: var(--text);
}
/* Padding inside, so a click on the dialog itself is only ever the backdrop. */
.drawer-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  padding: var(--space-3);
}
.drawer::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.drawer-head h2 {
  margin: 0;
  font-size: 1.1rem;
}
.close {
  min-width: var(--tap);
  min-height: var(--tap);
}

@media (max-width: 720px) {
  .chat {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: none;
  }
  .phone-only {
    display: inline-flex;
  }
  .message {
    max-width: 92%;
  }
  .hint {
    visibility: hidden;
  }
  .thread {
    padding: var(--space-2);
  }
  .composer {
    margin: 0 var(--space-2) var(--space-2);
  }
}
</style>

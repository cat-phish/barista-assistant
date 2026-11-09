<script setup lang="ts">
// Insights → Chat (docs/api/chat.md §12): your own conversations with the AI,
// replies appearing as they're written. Nobody else in the workspace sees them.
// Fills the screen below the tabs: the thread scrolls, the composer stays at
// the bottom. On a phone the chat list is a drawer behind "Chats".
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { chatSettingsApi, chatsApi, type Chat, type ChatAttachment, type ChatMessage, type ChatPhoto, type ChatProposal, type ChatSettings } from '../../api/chats';
import { ApiError, errorMessage } from '../../api/client';
import ChatAttachChips from '../../components/ChatAttachChips.vue';
import ChatAttachDialog from '../../components/ChatAttachDialog.vue';
import ChatList from '../../components/ChatList.vue';
import ChatMarkdown from '../../components/ChatMarkdown.vue';
import ChatProposalCard from '../../components/ChatProposalCard.vue';
import { usePreferences } from '../../composables/usePreferences';
import { saveBlob } from '../../lib/backup';
import { attachKey, attachRef } from '../../lib/chatAttach';
import { canSummarize, chatLength, historyTokens } from '../../lib/chatLength';
import { chatLimitsWarning } from '../../lib/chatLimitsWarning';
import { chatFileName, chatToMarkdown } from '../../lib/chatMarkdownExport';
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
const currentChat = ref<Chat | null>(null);
const title = computed(() => chats.value.find((c) => c.id === chatId.value)?.title ?? 'New chat');

// Long chats (docs/api/chat.md §12, "Long chats"): past 30 messages (or a lot
// of tokens) a notice offers "Summarize and continue"; while the summary is
// written, the chat is read again every few seconds.
const length = computed(() => (chatId.value ? chatLength(messages.value, currentChat.value, attachmentTokens.value) : 'ok'));
const summarizing = computed(() => currentChat.value?.summaryStatus === 'pending');
const summaryOpen = ref(false);
let summaryTimer: ReturnType<typeof setTimeout> | null = null;
function stopSummaryPoll() {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = null;
}
function pollSummary() {
  stopSummaryPoll();
  const ws = workspaceId.value;
  const id = chatId.value;
  if (!ws || !id || !summarizing.value) return;
  summaryTimer = setTimeout(async () => {
    try {
      const pair = await chatsApi.get(ws, id);
      if (chatId.value !== id) return;
      currentChat.value = pair.chat;
    } catch {
      // try again next time
    }
    pollSummary();
  }, 3000);
}
// The summary can be put right, or dropped so the older messages are sent
// again (until they fall out of the window).
const summaryDraft = ref<string | null>(null); // editing when set
const summaryBusy = ref(false);
async function changeSummary(change: (ws: string, id: string) => Promise<{ chat: Chat }>) {
  if (!workspaceId.value || !chatId.value) return;
  summaryBusy.value = true;
  error.value = '';
  try {
    currentChat.value = (await change(workspaceId.value, chatId.value)).chat;
    summaryDraft.value = null;
  } catch (err) {
    say(err);
  } finally {
    summaryBusy.value = false;
  }
}
const saveSummary = () => {
  const text = summaryDraft.value?.trim();
  if (text) void changeSummary((ws, id) => chatsApi.editSummary(ws, id, text));
};
const clearSummary = () => void changeSummary((ws, id) => chatsApi.clearSummary(ws, id));

async function summarize() {
  if (!workspaceId.value || !chatId.value || summarizing.value) return;
  error.value = '';
  try {
    currentChat.value = (await chatsApi.summarize(workspaceId.value, chatId.value)).chat;
    pollSummary();
  } catch (err) {
    say(err);
  }
}

// What the next message attaches, picked in ChatAttachDialog, up to the
// workspace's limit (docs/api/chat.md §12).
const attachments = ref<ChatAttachment[]>([]);
const picking = ref(false);
const attachMax = computed(() => settings.value.chatMaxAttachments ?? 50);
// Your chat settings (Settings → AI chats): a live period's cap on its brews
// (the workspace's, or your own lower one), and how close your chats are to
// the limits that delete them, read again after each reply.
const chatSettings = ref<ChatSettings | null>(null);
function loadChatSettings() {
  void chatSettingsApi
    .get()
    .then((s) => (chatSettings.value = s))
    .catch(() => undefined);
}
loadChatSettings();
const periodCap = computed(() => {
  const ws = settings.value.chatPeriodMaxBrews ?? 60;
  const own = chatSettings.value?.own.periodMaxBrews;
  return own ? Math.min(ws, own) : ws;
});
const limitNotes = computed(() => chatLimitsWarning(chatSettings.value, currentChat.value));
// How many brews each period held when picked, for the token estimate.
const periodBrews = ref(new Map<string, number>());
function attachPicked(picked: ChatAttachment[], counts: Map<string, number>) {
  attachments.value = picked;
  periodBrews.value = counts;
  picking.value = false;
}
// What the next reply is sent, as a rough count of tokens: this message's
// attachments and what the chat attached before, each once (the worker's
// attachedIn), plus the summary and the messages after it (chatLength.ts).
const attachmentTokens = computed(() => {
  const all = [...messages.value.flatMap((m) => m.attachments), ...attachments.value];
  const unique = [...new Map(all.map((a) => [attachKey(a), a])).values()].slice(-attachMax.value);
  return estimateTokens(unique, periodBrews.value, periodCap.value);
});
const tokenNote = computed(() => tokenWarning(attachmentTokens.value + historyTokens(messages.value, currentChat.value)));
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
      loadChatSettings();
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
    currentChat.value = pair.chat;
    summaryOpen.value = false;
    summaryDraft.value = null;
    pollSummary();
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
  stopSummaryPoll();
  chatId.value = null;
  currentChat.value = null;
  messages.value = [];
  error.value = '';
  listOpen.value = false;
  void nextTick(() => input.value?.focus());
}

async function send() {
  const content = draft.value.trim();
  if (!content || sending.value || writing.value || summarizing.value || uploading.value || !workspaceId.value) return;
  sending.value = true;
  error.value = '';
  try {
    const body = { content, attachments: attachments.value.map(attachRef), photoIds: photos.value.map((p) => p.id) };
    const pair = chatId.value ? await chatsApi.send(workspaceId.value, chatId.value, body) : await chatsApi.start(workspaceId.value, body);
    chatId.value = pair.chat.id;
    currentChat.value = pair.chat;
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
    loadChatSettings();
  } catch (err) {
    say(err);
  }
}

// Pinned chats stay at the top, and are kept from the age limit
// (docs/api/chat.md §12, "Pinned chats").
async function pin(chat: Chat) {
  if (!workspaceId.value) return;
  try {
    const { chat: saved } = await chatsApi.pin(workspaceId.value, chat.id, !chat.pinnedAt);
    if (chatId.value === saved.id) currentChat.value = saved;
    await refreshList();
  } catch (err) {
    say(err);
  }
}

// Export this chat (docs/api/chat.md §12, "Exporting a chat"): Markdown to
// read or share, a PDF through the browser's own print dialog (Save as PDF),
// or the .zip that Settings → AI chats → Import brings back.
const exportMenu = ref<HTMLDetailsElement | null>(null);
const printing = ref(false);
async function exportAs(format: 'md' | 'pdf' | 'zip') {
  if (exportMenu.value) exportMenu.value.open = false;
  const ws = workspaceId.value;
  const chat = currentChat.value;
  if (!ws || !chat) return;
  error.value = '';
  try {
    if (format === 'md') {
      saveBlob(chatFileName(chat.title, 'md'), new Blob([chatToMarkdown(chat, messages.value)], { type: 'text/markdown' }));
    } else if (format === 'zip') {
      saveBlob(chatFileName(chat.title, 'zip'), await chatsApi.exportChatZip(ws, chat.id));
    } else {
      printChat(chat.title);
    }
  } catch (err) {
    say(err);
  }
}
// While printing, the conversation moves to the top of the page (Teleport)
// and the print stylesheet leaves the rest of the app out; the tab's title is
// the file name the dialog suggests.
function printChat(chatTitle: string) {
  const before = document.title;
  const done = () => {
    printing.value = false;
    document.title = before;
    document.body.classList.remove('printing-chat');
    window.removeEventListener('afterprint', done);
  };
  printing.value = true;
  document.title = chatFileName(chatTitle, 'pdf').replace(/\.pdf$/, '');
  document.body.classList.add('printing-chat');
  window.addEventListener('afterprint', done);
  void nextTick(() => window.print());
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
onBeforeUnmount(stopSummaryPoll);
</script>

<template>
  <div ref="shell" class="chat" :style="{ height }">
    <aside class="card side" aria-label="Your chats">
      <ChatList :chats="chats" :current="chatId" @open="open" @remove="remove" @pin="pin" @new="newChat" />
    </aside>

    <dialog ref="drawer" class="drawer" aria-label="Your chats" @cancel.prevent="listOpen = false" @click="onDrawerClick">
      <div class="drawer-body">
        <div class="drawer-head">
          <h2>Chats</h2>
          <button type="button" class="btn-link close" aria-label="Close" @click="listOpen = false">✕</button>
        </div>
        <ChatList :chats="chats" :current="chatId" @open="open" @remove="remove" @pin="pin" @new="newChat" />
      </div>
    </dialog>

    <Teleport to="body" :disabled="!printing">
    <section class="card main" :class="{ 'chat-print': printing }" aria-label="Conversation" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
      <header class="bar">
        <button type="button" class="btn-link phone-only" @click="listOpen = true">☰ Chats</button>
        <h2 class="title">{{ title }}</h2>
        <details v-if="currentChat" ref="exportMenu" class="export">
          <summary class="btn-link">Export <span aria-hidden="true">▾</span></summary>
          <div class="export-menu card">
            <button type="button" class="btn-link" @click="exportAs('md')">Markdown (.md)</button>
            <button type="button" class="btn-link" @click="exportAs('pdf')">PDF (print)</button>
            <button type="button" class="btn-link" @click="exportAs('zip')">Backup (.zip)</button>
          </div>
        </details>
        <button type="button" class="btn-link phone-only" :disabled="chatId === null" @click="newChat">+ New</button>
      </header>
      <p v-if="printing && currentChat" class="print-only muted small">
        Started {{ formatWhen(currentChat.createdAt) }} · last message {{ formatWhen(currentChat.updatedAt) }}
      </p>

      <div ref="thread" class="thread" aria-live="polite" @scroll="onScroll">
        <div v-if="!messages.length" class="welcome">
          <h3>Ask about your coffee</h3>
          <p class="muted">Attach brews, beans or recipes for the AI to look at, or a photo of a puck or a bag. Only you can see your chats.</p>
          <div v-if="composing" class="suggestions">
            <button v-for="s in SUGGESTIONS" :key="s" type="button" class="suggestion" @click="suggest(s)">{{ s }}</button>
          </div>
        </div>
        <template v-for="m in messages" :key="m.id">
        <div class="message" :class="m.role">
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
        <div v-if="currentChat?.summary && m.position === currentChat.summaryThrough" class="summary-divider">
          <button type="button" class="btn-link" :aria-expanded="summaryOpen" @click="summaryOpen = !summaryOpen">
            Earlier messages summarized for the AI <span aria-hidden="true">{{ summaryOpen ? '▴' : '▾' }}</span>
          </button>
          <template v-if="summaryOpen">
            <form v-if="summaryDraft !== null" class="summary-edit" @submit.prevent="saveSummary">
              <label for="chat-summary" class="visually-hidden">Summary</label>
              <textarea id="chat-summary" v-model="summaryDraft" rows="8" maxlength="6000"></textarea>
              <div class="summary-actions">
                <button type="submit" class="btn btn-primary" :disabled="summaryBusy || !summaryDraft.trim()">Save</button>
                <button type="button" class="btn btn-secondary" :disabled="summaryBusy" @click="summaryDraft = null">Cancel</button>
              </div>
            </form>
            <template v-else>
              <p class="summary-text">{{ currentChat.summary }}</p>
              <p class="muted small">The AI gets this instead of the messages above it. If something in it is wrong, fix it here; clearing it sends the older messages again, the last 40.</p>
              <div v-if="composing" class="summary-actions">
                <button type="button" class="btn-link" :disabled="summaryBusy || summarizing" @click="summaryDraft = currentChat.summary">Edit</button>
                <button type="button" class="btn-link" :disabled="summaryBusy || summarizing" @click="clearSummary">Clear summary</button>
              </div>
            </template>
          </template>
        </div>
        </template>
      </div>
      <button v-if="newBelow" type="button" class="new-below" @click="toBottom(true)">↓ New reply</button>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div v-if="composing && (summarizing || currentChat?.summaryStatus === 'failed' || (length !== 'ok' && canSummarize(messages)))" class="long-chat" role="status">
        <span v-if="summarizing">Summarizing the earlier messages…</span>
        <template v-else>
          <span v-if="currentChat?.summaryStatus === 'failed'">The summary couldn't be written.</span>
          <span v-else-if="length === 'dropping'">Older messages in this chat aren't sent to the AI any more. What was attached still is.</span>
          <span v-else>This chat is getting long: soon its older messages won't be sent to the AI.</span>
          <button type="button" class="btn btn-secondary" :disabled="writing" @click="summarize">{{ currentChat?.summaryStatus === 'failed' ? 'Try again' : 'Summarize and continue' }}</button>
        </template>
      </div>
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
      <p v-for="note in limitNotes" :key="note" class="limits-note small" role="status">
        {{ note }} <RouterLink :to="{ name: 'settings-chats' }">AI chat settings</RouterLink>
      </p>
      <ChatAttachDialog :open="picking" :selected="attachments" :max="attachMax" :period-cap="periodCap" :period-brews="periodBrews" @close="picking = false" @done="attachPicked" />
    </section>
    </Teleport>
  </div>
</template>

<style scoped>
.long-chat {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--warning-tint);
  font-size: 0.9rem;
}
.summary-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  border-top: 1px dashed var(--border);
  padding-top: var(--space-1);
  font-size: 0.85rem;
}
.summary-edit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(60ch, 100%);
}
.summary-edit textarea {
  width: 100%;
  font: inherit;
}
.summary-actions {
  display: flex;
  gap: var(--space-3);
}
.summary-text {
  margin: 0;
  max-width: 60ch;
  white-space: pre-wrap;
  color: var(--text-muted);
}
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

.limits-note {
  margin: 0 var(--space-3) var(--space-2);
  color: var(--warning);
}
.export {
  position: relative;
  flex: none;
}
.export summary {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  min-height: var(--tap);
  list-style: none;
  cursor: pointer;
}
.export summary::-webkit-details-marker {
  display: none;
}
.export-menu {
  position: absolute;
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 11rem;
  padding: var(--space-1);
}
.export-menu button {
  min-height: var(--tap);
  padding: 0 var(--space-2);
  text-align: left;
}
.print-only {
  display: none;
}

/* PDF: the conversation alone, whole (see printChat). */
@media print {
  .main {
    overflow: visible;
    border: none;
    box-shadow: none;
  }
  .thread {
    overflow: visible;
    padding: 0;
  }
  .bar {
    padding: 0 0 var(--space-2);
  }
  .bar .title {
    font-size: 1.3rem;
    white-space: normal;
  }
  .print-only {
    display: block;
    margin: 0;
  }
  .bar button,
  .export,
  .composer,
  .long-chat,
  .new-below,
  .notice,
  .limits-note,
  .form-error,
  .failed button,
  .summary-divider,
  .typing {
    display: none !important;
  }
  .message,
  .bubble img {
    break-inside: avoid;
  }
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

<style>
/* While a chat prints (StatsChatView's printChat), only it is on the page. */
@media print {
  body.printing-chat > :not(.chat-print) {
    display: none !important;
  }
}
</style>

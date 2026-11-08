<script setup lang="ts">
// Notes (docs/api/notes.md §3h), one tab of Bar setup: what the workspace
// looks up again and again (cleaning powder per litre, a descaling routine).
// Search by title and text; pinned ones first; a note opens to its formatted
// text and, for "20 g per 1 L" lines, a Scale for box (NoteScale). Add,
// edit and delete on NoteFormView. The AI never sees notes.
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '../api/client';
import { notesApi } from '../api/notes';
import type { Note } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ChatMarkdown from '../components/ChatMarkdown.vue';
import ListDataBar from '../components/ListDataBar.vue';
import NoteScale from '../components/NoteScale.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { useSelection } from '../composables/useSelection';
import { matches } from '../lib/chatAttach';
import { formatAdded } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const route = useRoute();
const notes = ref<Note[]>([]);
const loading = ref(true);
const error = ref('');
const search = ref('');

// In the API's order: pinned first, then the most recently changed.
const found = computed(() => notes.value.filter((n) => matches(`${n.title}\n${n.body}`, search.value)));
const pinned = computed(() => found.value.filter((n) => n.pinnedAt));
const others = computed(() => found.value.filter((n) => !n.pinnedAt));
const groups = computed(() =>
  [
    { id: 'pinned', title: 'Pinned', notes: pinned.value },
    { id: 'others', title: pinned.value.length ? 'Other notes' : null, notes: others.value },
  ].filter((g) => g.notes.length),
);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    notes.value = (await notesApi.list(ws)).notes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  // Back from the editor: the note just saved is open.
  const open = route.query.open;
  if (typeof open === 'string' && notes.value.some((n) => n.id === open)) openId.value = open;
});

// One note open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

// Pinning is the workspace's; the list comes back in its new order.
const busyId = ref<string | null>(null);
async function setPinned(n: Note, pin: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || busyId.value) return;
  busyId.value = n.id;
  error.value = '';
  try {
    await notesApi.update(ws, n.id, { pinned: pin });
    notes.value = (await notesApi.list(ws)).notes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Select mode for exporting some notes (components/ListDataBar.vue).
const selection = useSelection();
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
    </div>
    <SetupTabs />
    <p class="muted intro">What you look up again and again: cleaning powder per litre, a descaling routine. Shared with the workspace; the AI doesn't see them.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading notes…</p>
    <section v-else class="card stack" aria-labelledby="notes-title">
      <div class="head">
        <h2 id="notes-title">Notes</h2>
        <RouterLink v-if="workspaces.canEdit" class="btn btn-secondary" :to="{ name: 'note-new' }">New note</RouterLink>
      </div>
      <ListDataBar list="notes" noun="notes" :selection="selection" :visible-ids="found.map((n) => n.id)" @imported="load()" />
      <div v-if="notes.length" class="field">
        <label for="notes-search" class="visually-hidden">Search notes</label>
        <input id="notes-search" v-model="search" type="search" placeholder="Search notes" />
      </div>

      <p v-if="!notes.length" class="muted small">No notes yet.<template v-if="workspaces.canEdit"> Add one for anything you keep looking up.</template></p>
      <p v-else-if="!found.length" class="muted small" aria-live="polite">No notes match “{{ search.trim() }}”.</p>

      <div v-for="g in groups" :key="g.id" class="group">
        <h3 v-if="g.title">{{ g.title }}</h3>
        <ul class="notes">
          <li v-for="n in g.notes" :key="n.id" class="note" :class="{ open: openId === n.id }">
            <div class="row">
              <input v-if="selection.selecting" type="checkbox" :checked="selection.has(n.id)" :aria-label="`Select ${n.title}`" @change="selection.toggle(n.id)" />
              <button class="toggle" type="button" :aria-expanded="openId === n.id" :aria-controls="`note-${n.id}`" @click="toggle(n.id)">
                <span class="title">{{ n.title }}</span>
                <span class="muted small when">{{ formatAdded(n.updatedAt) }}</span>
              </button>
            </div>
            <div v-if="openId === n.id" :id="`note-${n.id}`" class="body stack">
              <ChatMarkdown v-if="n.body.trim()" :source="n.body" />
              <p v-else class="muted small">No text yet.</p>
              <NoteScale :note-id="n.id" :body="n.body" />
              <div v-if="workspaces.canEdit" class="actions">
                <button class="btn btn-secondary" type="button" :disabled="busyId !== null" @click="setPinned(n, !n.pinnedAt)">
                  {{ busyId === n.id ? 'Saving…' : n.pinnedAt ? 'Unpin' : 'Pin' }}
                </button>
                <RouterLink class="btn btn-secondary" :to="{ name: 'note-edit', params: { id: n.id } }">Edit</RouterLink>
              </div>
            </div>
          </li>
        </ul>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
  margin: 0;
}
h3 {
  font-size: 0.95rem;
  margin: 0 0 var(--space-1);
  color: var(--text-muted);
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.notes {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.note {
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.note.open {
  border-color: var(--brand-line);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-left: var(--space-2);
}
.toggle {
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-2) 0;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.when {
  white-space: nowrap;
}
.body {
  padding: 0 var(--space-2) var(--space-2);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}
</style>

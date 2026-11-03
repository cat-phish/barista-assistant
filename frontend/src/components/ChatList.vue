<script setup lang="ts">
// A person's chats (docs/api/chat.md §12), newest first: StatsChatView's
// sidebar, and its drawer on a phone. Deleting one takes no confirmation
// (CLAUDE.md rule 7).
import type { Chat } from '../api/chats';
import { formatAdded } from '../lib/format';

defineProps<{ chats: Chat[]; current: string | null }>();
const emit = defineEmits<{ open: [id: string]; remove: [chat: Chat]; new: [] }>();

// Today's as a time, older ones as a date.
function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : formatAdded(iso);
}
</script>

<template>
  <div class="chat-list">
    <button type="button" class="btn btn-secondary new" :disabled="current === null" @click="emit('new')">+ New chat</button>
    <ul v-if="chats.length">
      <li v-for="c in chats" :key="c.id" :class="{ current: c.id === current }">
        <button type="button" class="open" :aria-current="c.id === current ? 'true' : undefined" @click="emit('open', c.id)">
          <span class="title">{{ c.title }}</span>
          <span class="muted when">{{ when(c.updatedAt) }}</span>
        </button>
        <button type="button" class="btn-link delete" :aria-label="`Delete chat: ${c.title}`" @click="emit('remove', c)">×</button>
      </li>
    </ul>
    <p v-else class="muted small none">No chats yet.</p>
  </div>
</template>

<style scoped>
.chat-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}
.new {
  width: 100%;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
}
li {
  display: flex;
  align-items: center;
  border-radius: var(--radius);
}
li:hover,
li:focus-within {
  background: var(--brand-tint);
}
li.current {
  background: var(--brand-tint);
  box-shadow: inset 3px 0 0 var(--brand);
}
.open {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  padding: var(--space-1) var(--space-2);
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
li.current .title {
  font-weight: 600;
}
.when {
  font-size: 0.75rem;
}
/* Shown on hover or focus, and always where there's no hover (a phone). */
.delete {
  min-width: 36px;
  min-height: var(--tap);
  opacity: 0;
}
li:hover .delete,
li:focus-within .delete,
li.current .delete {
  opacity: 1;
}
@media (hover: none) {
  .delete {
    opacity: 1;
  }
}
.none {
  margin: 0;
}
</style>

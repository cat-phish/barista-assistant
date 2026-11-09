<script setup lang="ts">
// A person's chats (docs/api/chat.md §12): pinned ones on top, then newest
// first, as the server sends them. StatsChatView's sidebar, and its drawer on
// a phone. Deleting one takes no confirmation (CLAUDE.md rule 7).
import { computed } from 'vue';
import type { Chat } from '../api/chats';
import { formatAdded } from '../lib/format';

const props = defineProps<{ chats: Chat[]; current: string | null }>();
const emit = defineEmits<{ open: [id: string]; remove: [chat: Chat]; pin: [chat: Chat]; new: [] }>();

const groups = computed(() => {
  const pinned = props.chats.filter((c) => c.pinnedAt);
  const rest = props.chats.filter((c) => !c.pinnedAt);
  return pinned.length
    ? [
        { name: 'Pinned', chats: pinned },
        { name: 'Chats', chats: rest },
      ].filter((g) => g.chats.length)
    : [{ name: null, chats: rest }];
});

// Today's as a time, older ones as a date.
function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : formatAdded(iso);
}
</script>

<template>
  <div class="chat-list">
    <button type="button" class="btn btn-secondary new" :disabled="current === null" @click="emit('new')">+ New chat</button>
    <div v-if="chats.length" class="groups">
      <section v-for="g in groups" :key="g.name ?? 'all'">
        <h3 v-if="g.name" class="group">{{ g.name }}</h3>
        <ul>
          <li v-for="c in g.chats" :key="c.id" :class="{ current: c.id === current, pinned: !!c.pinnedAt }">
            <button type="button" class="open" :aria-current="c.id === current ? 'true' : undefined" @click="emit('open', c.id)">
              <span class="title">{{ c.title }}</span>
              <span class="muted when">{{ when(c.updatedAt) }}</span>
            </button>
            <button
              type="button"
              class="btn-link action pin"
              :aria-label="`${c.pinnedAt ? 'Unpin' : 'Pin'} chat: ${c.title}`"
              :aria-pressed="!!c.pinnedAt"
              :title="c.pinnedAt ? 'Unpin' : 'Pin to the top'"
              @click="emit('pin', c)"
            >
              <span aria-hidden="true">📌</span>
            </button>
            <button type="button" class="btn-link action" :aria-label="`Delete chat: ${c.title}`" @click="emit('remove', c)">×</button>
          </li>
        </ul>
      </section>
    </div>
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
.groups {
  overflow-y: auto;
  min-height: 0;
}
.group {
  margin: var(--space-2) var(--space-2) var(--space-1);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
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
/* Shown on hover or focus, and always where there's no hover (a phone). A
   pinned chat's pin always shows. */
.action {
  min-width: 36px;
  min-height: var(--tap);
  opacity: 0;
}
li:hover .action,
li:focus-within .action,
li.current .action,
li.pinned .pin {
  opacity: 1;
}
.pin span {
  display: inline-block;
  font-size: 0.85rem;
  filter: grayscale(1);
  opacity: 0.55;
}
li.pinned .pin span {
  filter: none;
  opacity: 1;
}
@media (hover: none) {
  .action {
    opacity: 1;
  }
}
.none {
  margin: 0;
}
</style>

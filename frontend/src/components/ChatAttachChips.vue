<script setup lang="ts">
// A chat message's attachments as chips, by kind (lib/chatAttach.ts). Up to
// SHOWN of a kind show one by one; more fold into one chip ("14 brews ▾")
// that opens the list. With `removable`, each has a × (the next message's).
import { ref } from 'vue';
import type { ChatAttachment, ChatAttachmentKind } from '../api/chats';
import { attachKey, countLabel, groupByKind, KIND_NAMES } from '../lib/chatAttach';

const SHOWN = 3;
defineProps<{ attachments: ChatAttachment[]; removable?: boolean }>();
const emit = defineEmits<{ remove: [item: ChatAttachment] }>();
const opened = ref(new Set<ChatAttachmentKind>());
function flip(kind: ChatAttachmentKind): void {
  const next = new Set(opened.value);
  if (!next.delete(kind)) next.add(kind);
  opened.value = next;
}
</script>

<template>
  <ul v-if="attachments.length" class="chips">
    <template v-for="g in groupByKind(attachments)" :key="g.kind">
      <li v-if="g.items.length > SHOWN" class="chip">
        <button type="button" class="fold" :aria-expanded="opened.has(g.kind)" @click="flip(g.kind)">
          {{ countLabel(g.kind, g.items.length) }} <span aria-hidden="true">{{ opened.has(g.kind) ? '▴' : '▾' }}</span>
        </button>
      </li>
      <template v-if="g.items.length <= SHOWN || opened.has(g.kind)">
        <li v-for="a in g.items" :key="attachKey(a)" class="chip">
          {{ KIND_NAMES[a.kind].one }}: {{ a.label }}
          <button v-if="removable" type="button" class="btn-link remove" :aria-label="`Remove ${a.label}`" @click="emit('remove', a)">×</button>
        </li>
      </template>
    </template>
  </ul>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-2);
  border: 1px solid var(--brand-line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.fold {
  padding: 0;
  border: none;
  background: none;
  color: var(--brand);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.remove {
  padding: 0 2px;
}
</style>

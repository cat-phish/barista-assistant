<script setup lang="ts">
// Export ▾ for a chat (docs/api/chat.md §12, "Exporting a chat"): the chat
// page's header offers all three formats, the pin-limit dialog the two that
// don't need the chat open.
import { ref } from 'vue';

export type ChatExportFormat = 'md' | 'pdf' | 'zip';
const LABELS: Record<ChatExportFormat, string> = { md: 'Markdown (.md)', pdf: 'PDF (print)', zip: 'Backup (.zip)' };

withDefaults(defineProps<{ formats?: ChatExportFormat[]; label?: string }>(), { formats: () => ['md', 'pdf', 'zip'], label: undefined });
const emit = defineEmits<{ pick: [format: ChatExportFormat] }>();
const menu = ref<HTMLDetailsElement | null>(null);

function pick(format: ChatExportFormat) {
  if (menu.value) menu.value.open = false;
  emit('pick', format);
}
</script>

<template>
  <details ref="menu" class="export">
    <summary class="btn-link" :aria-label="label">Export <span aria-hidden="true">▾</span></summary>
    <div class="export-menu card">
      <button v-for="f in formats" :key="f" type="button" class="btn-link" @click="pick(f)">{{ LABELS[f] }}</button>
    </div>
  </details>
</template>

<style scoped>
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
  white-space: nowrap;
}
@media print {
  .export {
    display: none;
  }
}
</style>

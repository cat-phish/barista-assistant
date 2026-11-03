<script setup lang="ts">
// Filters folded into one line (the chat's attach picker): what they're set
// to, in words, and a button that opens the fields underneath. Closed to
// start, so the list below gets the room.
import { ref, useId } from 'vue';

defineProps<{ summary: string; describe?: string }>();
const open = ref(false);
const panelId = useId();
</script>

<template>
  <div class="filter-bar">
    <div class="line">
      <span class="summary muted small" :title="describe ? `${describe}: ${summary}` : summary">{{ summary }}</span>
      <button type="button" class="btn-link toggle" :aria-expanded="open" :aria-controls="panelId" @click="open = !open">
        Filters <span aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
      </button>
    </div>
    <div v-show="open" :id="panelId" class="fields">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toggle {
  flex: none;
  min-height: 36px;
}
</style>

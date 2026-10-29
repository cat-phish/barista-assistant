<script setup lang="ts">
// Under a bean form field the label read differently, or the web found
// something for (lib/labelFill.ts): what it says, the page it's from, and a
// button to use it instead. The links stay together on one line.
defineProps<{ text: string; source?: string }>();
defineEmits<{ use: [] }>();
</script>

<template>
  <span class="label-hint">
    <span>{{ source ? 'Web says:' : 'Label says:' }} <strong>{{ text }}</strong></span>
    <span class="actions">
      <a v-if="source" :href="source" target="_blank" rel="noopener noreferrer">source</a>
      <button type="button" class="btn-link small" @click="$emit('use')">Use</button>
    </span>
  </span>
</template>

<style scoped>
.label-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--space-2);
  font-size: 0.85rem;
  color: var(--text-muted);
  white-space: pre-line;
}
.actions {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  white-space: nowrap;
}
</style>

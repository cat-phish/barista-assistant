<script setup lang="ts">
// Under a bean form field the label read differently (lib/labelFill.ts):
// what the label says, and a button to use it instead.
defineProps<{ text: string }>();
defineEmits<{ use: [] }>();
</script>

<template>
  <span class="label-hint">
    Label says: <strong>{{ text }}</strong>
    <button type="button" class="btn-link small" @click="$emit('use')">Use</button>
  </span>
</template>

<style scoped>
.label-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1);
  font-size: 0.85rem;
  color: var(--text-muted);
  white-space: pre-line;
}
</style>

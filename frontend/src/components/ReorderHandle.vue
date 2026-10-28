<script setup lang="ts">
import { releaseReorderFocus } from '../lib/reorder';
defineProps<{ name: string; disabled: boolean }>();
defineEmits<{ move: [delta: -1 | 1] }>();
</script>

<template>
  <button class="reorder-handle" type="button" :disabled="disabled"
    :aria-label="`Move ${name}. Use the up and down arrow keys.`"
    @pointerdown="releaseReorderFocus"
    @keydown.up.prevent="$emit('move', -1)" @keydown.down.prevent="$emit('move', 1)">⠿</button>
</template>

<style scoped>
.reorder-handle {
  width: var(--tap);
  height: var(--tap);
  flex-shrink: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 1.4rem;
  line-height: 1;
  cursor: grab;
  touch-action: none;
}
.reorder-handle:active { cursor: grabbing; }
.reorder-handle:disabled { cursor: default; opacity: 0.5; }
</style>

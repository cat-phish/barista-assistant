<script setup lang="ts">
// Modal confirmation built on the native <dialog> (focus trap, Escape to
// cancel and the backdrop come from the browser). Parent controls `open`.
import { ref, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ (e: 'cancel'): void }>();
const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
  },
  { flush: 'post' },
);
</script>

<template>
  <dialog ref="dialog" class="confirm" :aria-label="title" @cancel.prevent="emit('cancel')">
    <h2>{{ title }}</h2>
    <slot />
    <div class="actions"><slot name="actions" /></div>
  </dialog>
</template>

<style scoped>
.confirm {
  width: min(440px, calc(100vw - 2 * var(--space-3)));
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: var(--text);
}
.confirm::backdrop {
  background: rgb(0 0 0 / 0.45);
}
h2 {
  font-size: 1.2rem;
  margin-bottom: var(--space-3);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
</style>

<script setup lang="ts">
// A one-off note for the AI with one request (docs/api/auth.md §1c): added
// to the prompt for this request only. Folded until wanted.
const note = defineModel<string>({ required: true });
defineProps<{ id: string }>();
const MAX = 500; // AI_NOTE_MAX
</script>

<template>
  <details class="ai-note" :open="!!note">
    <summary class="small">Add a note for the AI</summary>
    <label :for="id" class="visually-hidden">Note for the AI, this time only</label>
    <textarea :id="id" v-model="note" rows="2" :maxlength="MAX" placeholder="e.g. I'll drink it with milk; we're out of the usual water" />
    <p class="muted small">This time only. Your standing instructions are under Settings → Your AI prompt.</p>
  </details>
</template>

<style scoped>
.ai-note summary {
  cursor: pointer;
  min-height: var(--tap);
  display: flex;
  align-items: center;
  color: var(--brand);
}
.ai-note textarea {
  width: 100%;
}
.ai-note p {
  margin: var(--space-1) 0 0;
}
</style>

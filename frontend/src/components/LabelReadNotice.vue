<script setup lang="ts">
// Under the header while a bean label read started on another page is going
// on or has finished (stores/labelRead.ts): back to the bean to see it.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useLabelReadStore } from '../stores/labelRead';

const reads = useLabelReadStore();
const route = useRoute();
const read = computed(() => reads.current);
// The form it's for shows it itself.
const here = computed(() => {
  const r = read.value;
  if (!r) return false;
  return r.key === 'new' ? route.name === 'bean-new' : route.name === 'bean-edit' && `bean:${String(route.params.id)}` === r.key;
});
const back = computed(() => (read.value?.key === 'new' ? { name: 'bean-new' } : { name: 'bean-edit', params: { id: read.value?.key.slice(5) } }));
</script>

<template>
  <div v-if="read && !here" class="label-read-notice" role="status">
    <span v-if="read.status === 'reading'">
      {{ read.step === 'web' ? 'Looking it up on the web' : read.web ? 'Reading the label, then the web' : 'Reading the label' }} for {{ read.name }}…
    </span>
    <span v-else-if="read.status === 'done'">{{ read.photos ? 'The label' : 'The web lookup' }} for {{ read.name }} is done.</span>
    <span v-else>Reading the label for {{ read.name }} didn't work.</span>
    <RouterLink :to="back">Back to the bean</RouterLink>
    <button v-if="read.status !== 'reading'" type="button" class="btn-link small" aria-label="Dismiss" @click="reads.dismiss()">✕</button>
  </div>
</template>

<style scoped>
/* As wide as the page's content (.page: 640px, with side padding). */
.label-read-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  max-width: calc(640px - 2 * var(--space-3));
  margin: var(--space-2) var(--space-3) 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--brand-tint);
  font-size: 0.9rem;
}
@media (min-width: 640px) {
  .label-read-notice {
    margin-inline: auto;
  }
}
</style>

<script setup lang="ts">
// Tabs across a section's screens (Bar setup; Recipes / Drinks / Ingredients).
// One row; on a phone, more than four tabs wrap into two even rows (Bar
// setup's six become 3 + 3) instead of squeezing into each other.
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

const props = defineProps<{ label: string; tabs: Array<{ to: RouteLocationRaw; text: string }> }>();
const columns = computed(() => ({
  '--cols': props.tabs.length,
  '--cols-narrow': props.tabs.length > 4 ? Math.ceil(props.tabs.length / 2) : props.tabs.length,
}));
</script>

<template>
  <nav class="tabs" :aria-label="label" :style="columns">
    <RouterLink v-for="t in tabs" :key="t.text" :to="t.to" active-class="active">{{ t.text }}</RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--brand-tint);
  border-radius: var(--radius);
}
.tabs a {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  padding: 0 var(--space-2);
  border-radius: calc(var(--radius) - 2px);
  color: var(--brand);
  font-weight: 600;
  text-decoration: none;
  text-align: center;
  touch-action: manipulation;
}
@media (max-width: 600px) {
  .tabs {
    grid-template-columns: repeat(var(--cols-narrow), minmax(0, 1fr));
  }
  .tabs a {
    padding: 0 var(--space-1);
  }
}
.tabs a.active {
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
</style>

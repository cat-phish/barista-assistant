<script setup lang="ts">
// Tabs across a section's screens (Equipment; Recipes / Drinks / Components).
import type { RouteLocationRaw } from 'vue-router';

defineProps<{ label: string; tabs: Array<{ to: RouteLocationRaw; text: string }> }>();
</script>

<template>
  <nav class="tabs" :aria-label="label" :style="{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }">
    <RouterLink v-for="t in tabs" :key="t.text" :to="t.to" active-class="active">{{ t.text }}</RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
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
.tabs a.active {
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
</style>

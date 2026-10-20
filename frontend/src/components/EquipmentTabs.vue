<script setup lang="ts">
// Tabs across the Equipment screens (grinders, machines, brew methods).
</script>

<template>
  <nav class="tabs" aria-label="Equipment">
    <RouterLink :to="{ name: 'grinders' }" active-class="active">Grinders</RouterLink>
    <RouterLink :to="{ name: 'machines' }" active-class="active">Machines</RouterLink>
    <RouterLink :to="{ name: 'brew-methods' }" active-class="active">Methods</RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

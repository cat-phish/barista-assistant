<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
</script>

<template>
  <AppHeader />
  <main class="page">
    <section class="card">
      <h1>{{ workspaces.current?.name }}</h1>
      <p class="muted">Pick a bean and recipe, follow the timer, and log how it tasted.</p>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary btn-block" :to="{ name: 'brew' }">Start a brew</RouterLink>
    </section>
    <nav class="shortcuts" aria-label="Get started">
      <RouterLink class="card shortcut" :to="{ name: 'beans' }">
        <strong>Beans</strong>
        <span class="muted">Coffees, roast dates and stock</span>
      </RouterLink>
      <RouterLink class="card shortcut" :to="{ name: 'recipes' }">
        <strong>Recipes</strong>
        <span class="muted">Doses, ratios and pour steps</span>
      </RouterLink>
      <RouterLink class="card shortcut" :to="{ name: 'grinders' }">
        <strong>Grinders</strong>
        <span class="muted">Track settings per grinder</span>
      </RouterLink>
    </nav>
  </main>
</template>

<style scoped>
.page {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-3);
}
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.shortcuts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.shortcut {
  text-decoration: none;
  color: var(--text);
  padding: var(--space-3);
}
.shortcut:hover {
  border-color: var(--brand);
}
h1 {
  font-size: 1.5rem;
}
p {
  margin: 0;
}
</style>

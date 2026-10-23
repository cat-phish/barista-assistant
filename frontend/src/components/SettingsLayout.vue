<script setup lang="ts">
// The Settings screens: the grouped nav beside the tab on wide screens. On a
// phone, /settings is just the nav (`index`), and each tab has a back link.
import AppHeader from './AppHeader.vue';
import SettingsNav from './SettingsNav.vue';

defineProps<{ title?: string; index?: boolean }>();
</script>

<template>
  <AppHeader />
  <main class="settings-page" :class="{ index }">
    <aside class="nav">
      <h1 class="nav-title">Settings</h1>
      <SettingsNav />
    </aside>
    <div v-if="!index" class="content">
      <RouterLink class="back" :to="{ name: 'settings' }">‹ Settings</RouterLink>
      <h1>{{ title }}</h1>
      <slot />
    </div>
  </main>
</template>

<style scoped>
.settings-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-3) var(--space-5);
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
}
.nav {
  flex: 0 0 200px;
  position: sticky;
  top: var(--space-3);
  min-width: 0;
}
.nav-title {
  font-size: 1.5rem;
  margin-bottom: var(--space-3);
}
.content {
  flex: 1;
  min-width: 0;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.content h1 {
  font-size: 1.5rem;
}
.back {
  display: none;
}
@media (max-width: 749px) {
  .settings-page {
    display: block;
  }
  .settings-page:not(.index) .nav {
    display: none;
  }
  .nav {
    position: static;
  }
  .back {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    align-self: flex-start;
    margin: calc(-1 * var(--space-3)) 0 calc(-1 * var(--space-2));
  }
}
</style>

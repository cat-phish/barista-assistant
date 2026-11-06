<script setup lang="ts">
// The Settings screens: the grouped nav beside the tab on wide screens. On a
// phone, /settings is just the nav (`index`), and each tab has a back link.
import { nextTick, onMounted, ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import AppHeader from './AppHeader.vue';
import SettingsNav from './SettingsNav.vue';

defineProps<{ title?: string; index?: boolean }>();

// Account needs no workspace, so its route doesn't load them; the nav's
// workspace group still should show when there is one.
const workspaces = useWorkspaceStore();
onMounted(() => workspaces.ensureLoaded().catch(() => undefined));

// On a wide screen the nav scrolls on its own when it's taller than the
// window. Each tab mounts its own layout, so the nav starts at the top again:
// bring the selected tab into view. Set the nav's scrollTop directly, since
// scrollIntoView would scroll the page as well.
const aside = ref<HTMLElement | null>(null);
onMounted(async () => {
  await nextTick();
  const nav = aside.value;
  const active = nav?.querySelector<HTMLElement>('a.active');
  if (!nav || !active || nav.scrollHeight <= nav.clientHeight) return;
  const top = active.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
  const bottom = top + active.offsetHeight;
  if (top < nav.scrollTop || bottom > nav.scrollTop + nav.clientHeight) {
    nav.scrollTop = top - (nav.clientHeight - active.offsetHeight) / 2;
  }
});
</script>

<template>
  <AppHeader />
  <main class="settings-page" :class="{ index }">
    <aside ref="aside" class="nav">
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
  /* Taller than the window: scroll the nav, not just the page. The padding
     (taken back by the margin) keeps the focus ring from being clipped. */
  max-height: calc(100vh - 2 * var(--space-3));
  max-height: calc(100dvh - 2 * var(--space-3));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  margin: -6px;
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
    max-height: none;
    overflow: visible;
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

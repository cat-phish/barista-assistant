<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useBrewSessionStore } from '../stores/brewSession';
import { useWorkspaceStore } from '../stores/workspace';

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const router = useRouter();
const route = useRoute();
const loggingOut = ref(false);

async function logout(): Promise<void> {
  loggingOut.value = true;
  try {
    await auth.logout();
  } finally {
    workspaces.reset({ forgetSelection: true });
    loggingOut.value = false;
    await router.replace({ name: 'login' });
  }
}

// Already brewing: clicking Brew offers to abandon the brew and start over.
const brewSession = useBrewSessionStore();
function onBrewClick(): void {
  if (route.name === 'brew' && brewSession.inProgress) brewSession.requestRestart();
}
</script>

<template>
  <header class="app-header">
    <div class="title">
      <img src="/favicon.svg" alt="" width="32" height="32" />
      <div>
        <strong>{{ workspaces.current?.name ?? 'Coffee Brew Journal' }}</strong>
        <RouterLink v-if="workspaces.current" class="switch" :to="{ name: 'workspaces' }">Switch workspace</RouterLink>
      </div>
    </div>
    <div class="account">
      <span class="email" :title="auth.user?.email">{{ auth.user?.email }}</span>
      <RouterLink v-if="auth.user" class="settings" :class="{ active: route.path.startsWith('/settings') }" :to="{ name: 'settings' }" aria-label="Settings" title="Settings">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg><span class="settings-text">Settings</span>
      </RouterLink>
      <button class="btn btn-secondary" type="button" :disabled="loggingOut" @click="logout">Log out</button>
    </div>
  </header>
  <nav v-if="workspaces.current" class="tabs" aria-label="Sections">
    <RouterLink :to="{ name: 'home' }" exact-active-class="active">Home</RouterLink>
    <RouterLink :to="{ name: 'brew' }" active-class="active" @click="onBrewClick">Brew</RouterLink>
    <RouterLink :to="{ name: 'journal' }" active-class="active">Journal</RouterLink>
    <RouterLink :to="{ name: 'beans' }" active-class="active">Beans</RouterLink>
    <RouterLink :to="{ name: 'recipes' }" :class="{ active: ['/recipes', '/drinks', '/ingredients'].some((p) => route.path.startsWith(p)) }">Recipes</RouterLink>
    <RouterLink :to="{ name: 'brewers' }" :class="{ active: route.path.startsWith('/setup') }">Bar setup</RouterLink>
  </nav>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.title div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switch {
  font-size: 0.85rem;
}
.account {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
.email {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  color: var(--text-muted);
}
.settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--tap);
  min-width: var(--tap);
  padding: 0 var(--space-2);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-weight: 600;
  text-decoration: none;
}
.settings svg {
  flex-shrink: 0;
}
.settings:hover,
.settings.active {
  color: var(--brand);
  background: var(--brand-tint);
}
.tabs {
  display: flex;
  gap: 0;
  padding: 0 var(--space-1);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.tabs a {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: var(--tap);
  /* Six tabs must fit a 320px phone without scrolling (see the media queries). */
  padding: 0 var(--space-2);
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 600;
  border-bottom: 3px solid transparent;
}
@media (max-width: 420px) {
  .tabs a {
    padding: 0 6px;
    font-size: 0.95rem;
  }
}
@media (max-width: 370px) {
  .tabs a {
    padding: 0 4px;
    font-size: 0.85rem;
  }
}
@media (max-width: 340px) {
  .tabs {
    padding: 0 2px;
  }
  .tabs a {
    padding: 0 3px;
    font-size: 0.8rem;
  }
}
.tabs a.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
}
@media (max-width: 480px) {
  .email,
  .settings-text {
    display: none;
  }
}
</style>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const router = useRouter();
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
      <button class="btn btn-secondary" type="button" :disabled="loggingOut" @click="logout">Log out</button>
    </div>
  </header>
  <nav v-if="workspaces.current" class="tabs" aria-label="Sections">
    <RouterLink :to="{ name: 'home' }" exact-active-class="active">Home</RouterLink>
    <RouterLink :to="{ name: 'brew' }" active-class="active">Brew</RouterLink>
    <RouterLink :to="{ name: 'journal' }" active-class="active">Journal</RouterLink>
    <RouterLink :to="{ name: 'beans' }" active-class="active">Beans</RouterLink>
    <RouterLink :to="{ name: 'recipes' }" active-class="active">Recipes</RouterLink>
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
  /* Five tabs must fit a 360px phone without scrolling. */
  padding: 0 var(--space-2);
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 600;
  border-bottom: 3px solid transparent;
}
@media (max-width: 340px) {
  .tabs a {
    padding: 0 6px;
    font-size: 0.9rem;
  }
}
.tabs a.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
}
@media (max-width: 480px) {
  .email {
    display: none;
  }
}
</style>

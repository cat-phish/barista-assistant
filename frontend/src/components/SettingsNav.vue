<script setup lang="ts">
// The Settings tabs, grouped like Bar Assistant's: what's yours, then what
// belongs to the current workspace (headed by its name).
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const auth = useAuthStore();
</script>

<template>
  <nav class="settings-nav" aria-label="Settings">
    <h2>You</h2>
    <RouterLink :to="{ name: 'settings-account' }" active-class="active">Account</RouterLink>
    <RouterLink :to="{ name: 'settings-preferences' }" active-class="active">Preferences</RouterLink>
    <RouterLink :to="{ name: 'settings-repeat' }" active-class="active">Repeat brews</RouterLink>
    <RouterLink :to="{ name: 'settings-notifications' }" active-class="active">Notifications</RouterLink>
    <template v-if="workspaces.current">
      <h2 :title="workspaces.current.name">{{ workspaces.current.name }}</h2>
      <RouterLink :to="{ name: 'settings-workspace' }" active-class="active">Workspace</RouterLink>
      <RouterLink :to="{ name: 'settings-members' }" active-class="active">Members</RouterLink>
      <RouterLink :to="{ name: 'settings-defaults' }" active-class="active">Defaults</RouterLink>
      <RouterLink :to="{ name: 'settings-fields' }" active-class="active">Fields</RouterLink>
      <RouterLink :to="{ name: 'settings-ai' }" active-class="active">AI</RouterLink>
      <RouterLink :to="{ name: 'settings-lists' }" active-class="active">Lists</RouterLink>
      <RouterLink :to="{ name: 'settings-data' }" active-class="active">Data</RouterLink>
    </template>
    <template v-if="auth.user?.isAdmin">
      <h2>Server</h2>
      <RouterLink :to="{ name: 'settings-server' }" active-class="active">Backups</RouterLink>
    </template>
  </nav>
</template>

<style scoped>
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
h2 {
  margin: var(--space-3) 0 var(--space-1);
  padding: 0 var(--space-2);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
h2:first-child {
  margin-top: 0;
}
a {
  display: flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 var(--space-2);
  border-radius: var(--radius);
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
}
a:hover {
  background: var(--brand-tint);
}
a.active {
  background: var(--brand-tint);
  color: var(--brand);
}
</style>

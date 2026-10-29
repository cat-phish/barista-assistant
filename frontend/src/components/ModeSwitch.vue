<script setup lang="ts">
// Brew | Roast (docs/backlog.md item 15): switches between brew mode and roast
// mode, each with its own tabs, in the same workspace. Shown when the
// workspace has home roasting on (docs/api/workspaces.md §2). Each side goes
// back to the last page used in that mode (lib/mode.ts), or the mode's
// landing page; the side you're on goes to its landing page.
import { computed } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { headerMode, lastPage, type AppMode } from '../lib/mode';
import { useWorkspaceStore } from '../stores/workspace';

const route = useRoute();
const workspaces = useWorkspaceStore();
const mode = computed(() => headerMode(route.path, workspaces.current?.id ?? null));

const LANDING: Record<AppMode, () => RouteLocationRaw> = {
  brew: () => ({ name: workspaces.canEdit ? 'brew' : 'journal' }),
  roast: () => ({ name: 'roast-home' }),
};
const target = (m: AppMode): RouteLocationRaw => {
  void route.fullPath; // recomputed on every move, when the last page changes
  const ws = workspaces.current?.id;
  return (m !== mode.value && ws && lastPage(ws, m)) || LANDING[m]();
};
const MODES: Array<{ mode: AppMode; label: string }> = [
  { mode: 'brew', label: 'Brew' },
  { mode: 'roast', label: 'Roast' },
];
</script>

<template>
  <nav class="mode-switch" aria-label="Mode">
    <RouterLink v-for="m in MODES" :key="m.mode" :to="target(m.mode)" :class="{ on: mode === m.mode }" :aria-current="mode === m.mode ? 'page' : undefined">{{ m.label }}</RouterLink>
  </nav>
</template>

<style scoped>
.mode-switch {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
}
.mode-switch a {
  display: inline-flex;
  align-items: center;
  /* Small in the header, but a full-height tap target around the text. */
  min-height: 32px;
  padding: 0 var(--space-3);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
  text-decoration: none;
}
.mode-switch a + a {
  border-left: 1px solid var(--border);
}
.mode-switch a.on {
  background: var(--brand-tint);
  color: var(--brand);
}
.mode-switch a:hover:not(.on) {
  color: var(--text);
}
</style>

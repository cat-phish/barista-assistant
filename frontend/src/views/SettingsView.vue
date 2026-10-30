<script setup lang="ts">
// /settings: on a phone, the list of tabs; on a wide screen the nav is always
// beside the tab, so go straight to the first one.
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useWorkspaceStore } from '../stores/workspace';

const router = useRouter();
const workspaces = useWorkspaceStore();

onMounted(async () => {
  if (!window.matchMedia('(min-width: 750px)').matches) return;
  await workspaces.ensureLoaded().catch(() => undefined);
  await router.replace({ name: workspaces.current ? 'settings-workspace' : 'settings-account' });
});
</script>

<template>
  <SettingsLayout index />
</template>

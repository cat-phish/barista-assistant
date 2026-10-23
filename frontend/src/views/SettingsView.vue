<script setup lang="ts">
// /settings: on a phone, the list of tabs; on a wide screen the nav is always
// beside the tab, so go straight to the first one.
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsLayout from '../components/SettingsLayout.vue';

const router = useRouter();

onMounted(() => {
  if (window.matchMedia('(min-width: 750px)').matches) {
    void router.replace({ name: 'settings-workspace' });
  }
});
</script>

<template>
  <SettingsLayout index />
</template>

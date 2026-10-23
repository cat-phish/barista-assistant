<script setup lang="ts">
// The public menu page for guests (docs/api/public-menu.md §7): no login, no
// app header. Works offline from the last copy the service worker cached
// (vite.config.ts, NetworkFirst on /api/public/menu).
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { ApiError } from '../api/client';
import { menuApi } from '../api/menu';
import type { PublicMenu } from '../api/types';
import MenuPreview from '../components/MenuPreview.vue';

const props = defineProps<{ slug: string }>();
const menu = ref<PublicMenu | null>(null);
const problem = ref<'missing' | 'offline' | 'error' | null>(null);
const offline = ref(typeof navigator !== 'undefined' && !navigator.onLine);
const setOnline = () => (offline.value = !navigator.onLine);

onMounted(async () => {
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  try {
    menu.value = await menuApi.publicMenu(props.slug);
    document.title = menu.value.workspace.name;
  } catch (err) {
    // 404: unknown, or the bar turned it off. 0: no network and nothing cached.
    problem.value = err instanceof ApiError && err.status === 404 ? 'missing' : err instanceof ApiError && err.status === 0 ? 'offline' : 'error';
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('online', setOnline);
  window.removeEventListener('offline', setOnline);
});
</script>

<template>
  <main class="guest">
    <p v-if="offline && menu" class="offline muted small" role="status">Offline: showing the last saved menu.</p>
    <MenuPreview v-if="menu" :menu="menu" />
    <div v-else-if="problem" class="card empty">
      <p v-if="problem === 'missing'">This menu isn't available.</p>
      <p v-else-if="problem === 'offline'">You're offline, and this menu hasn't been saved on this device yet.</p>
      <p v-else>The menu couldn't be loaded. Try again in a moment.</p>
    </div>
    <p v-else class="muted" aria-live="polite">Loading the menu…</p>
  </main>
</template>

<style scoped>
.guest {
  max-width: 36rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-3);
}
.offline {
  text-align: center;
  margin: 0 0 var(--space-3);
}
.small {
  font-size: 0.85rem;
}
p {
  margin: 0;
}
</style>

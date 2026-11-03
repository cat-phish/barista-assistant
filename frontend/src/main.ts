import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { setUnauthorizedHandler } from './api/client';
import { createUpdateGate } from './lib/swUpdate';
import { applyTheme } from './lib/theme';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import { useBrewSessionStore } from './stores/brewSession';
import { useWorkspaceStore } from './stores/workspace';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia()); // before the router, whose guards use the stores
app.use(router);

// Session revoked or expired mid-use (e.g. password changed on another
// device): forget local state and go to login, then come back afterwards.
setUnauthorizedHandler(() => {
  useAuthStore().sessionEnded();
  useWorkspaceStore().reset({ forgetSelection: false });
  const route = router.currentRoute.value;
  if (route.meta.requiresAuth || route.meta.requiresWorkspace) {
    void router.replace({ name: 'login', query: { redirect: route.fullPath } });
  }
});

// The signed-in person's Theme preference (logged out, the device's last
// choice stays, applied by index.html).
watch(
  () => useAuthStore().user?.preferences.theme,
  (theme) => {
    if (theme) applyTheme(theme);
  },
  { immediate: true },
);

// Service worker updates apply on their own, but never mid-brew
// (lib/swUpdate.ts). An installed app can stay open for days without a page
// load, which is when browsers look for updates, so check hourly too.
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const updateGate = createUpdateGate(() => void updateSW());
const updateSW = registerSW({
  onNeedRefresh: () => updateGate.ready(),
  onRegisteredSW: (_url, registration) => {
    if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS);
  },
});
watch(
  () => useBrewSessionStore().inProgress,
  (busy) => updateGate.setBusy(busy),
  { immediate: true },
);

// A tapped reminder (public/push-sw.js) opens its page here, through the
// router, so a brew in progress asks before leaving.
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'open-path' && 'path' in data && typeof data.path === 'string' && data.path.startsWith('/')) {
    void router.push(data.path);
  }
});

app.mount('#app');

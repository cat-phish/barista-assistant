import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import App from './App.vue';
import { setUnauthorizedHandler } from './api/client';
import { applyTheme } from './lib/theme';
import { router } from './router';
import { useAuthStore } from './stores/auth';
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

app.mount('#app');

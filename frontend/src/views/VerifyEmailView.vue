<script setup lang="ts">
// The page a verification mail links to (docs/api/auth.md §1e). The token is
// in the URL fragment, so it never reaches a server log or a Referer; it's
// posted from here, then removed from the address bar.
import { onMounted, ref } from 'vue';
import { authApi } from '../api/auth';
import { errorMessage } from '../api/client';
import AuthCard from '../components/AuthCard.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');

onMounted(async () => {
  const token = window.location.hash.slice(1);
  history.replaceState(null, '', window.location.pathname);
  if (!token) {
    state.value = 'failed';
    message.value = 'This link is incomplete. Open the link from the mail again.';
    return;
  }
  try {
    await authApi.verifyEmail(token);
    state.value = 'done';
    await auth.fetchMe().catch(() => undefined);
  } catch (err) {
    state.value = 'failed';
    message.value = errorMessage(err);
  }
});
</script>

<template>
  <AuthCard title="Confirm your email">
    <p v-if="state === 'working'" class="muted" aria-live="polite">Checking the link…</p>
    <p v-else-if="state === 'done'" role="status">Your email address is confirmed.</p>
    <p v-else class="form-error" role="alert">{{ message }} Log in and ask for a new link.</p>
    <template #footer><RouterLink :to="{ name: 'workspaces' }">Continue to the app</RouterLink></template>
  </AuthCard>
</template>

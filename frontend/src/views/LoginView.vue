<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import AuthCard from '../components/AuthCard.vue';
import { safeRedirect } from '../router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref('');

async function submit(): Promise<void> {
  error.value = '';
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    await router.replace(safeRedirect(route.query.redirect));
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 429
        ? 'Too many attempts. Wait a few minutes and try again.'
        : errorMessage(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard title="Log in">
    <form class="form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" v-model.trim="email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary btn-block" type="submit" :disabled="submitting || !email || !password">
        {{ submitting ? 'Logging in…' : 'Log in' }}
      </button>
    </form>
    <template #footer>
      New here? <RouterLink :to="{ name: 'register', query: route.query }">Create an account</RouterLink>
    </template>
  </AuthCard>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import AuthCard from '../components/AuthCard.vue';
import { safeRedirect } from '../router';
import { useAuthStore } from '../stores/auth';

const MIN_PASSWORD = 8; // docs/api/auth.md §1

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const confirm = ref('');
const submitting = ref(false);
const error = ref('');

const tooShort = computed(() => password.value.length > 0 && password.value.length < MIN_PASSWORD);
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value);
const canSubmit = computed(
  () => !!email.value && password.value.length >= MIN_PASSWORD && confirm.value === password.value && !submitting.value,
);

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  error.value = '';
  submitting.value = true;
  try {
    await auth.register(email.value, password.value);
    // New accounts have no workspace yet; the guard sends them to create one.
    await router.replace(safeRedirect(route.query.redirect));
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 409
        ? 'An account with this email already exists. Try logging in.'
        : errorMessage(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard title="Create an account">
    <form class="form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" v-model.trim="email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          :aria-invalid="tooShort"
          aria-describedby="password-hint"
        />
        <span id="password-hint" class="hint">At least {{ MIN_PASSWORD }} characters.</span>
      </div>
      <div class="field">
        <label for="confirm">Confirm password</label>
        <input id="confirm" v-model="confirm" type="password" autocomplete="new-password" required :aria-invalid="mismatch" />
        <span v-if="mismatch" class="hint mismatch">Passwords don't match.</span>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary btn-block" type="submit" :disabled="!canSubmit">
        {{ submitting ? 'Creating account…' : 'Create account' }}
      </button>
    </form>
    <template #footer>
      Already have an account? <RouterLink :to="{ name: 'login', query: route.query }">Log in</RouterLink>
    </template>
  </AuthCard>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.mismatch {
  color: var(--danger);
}
</style>

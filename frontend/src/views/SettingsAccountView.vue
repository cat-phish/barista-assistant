<script setup lang="ts">
// Settings → Account (docs/api/auth.md §1): change your password (other
// devices are logged out) and delete your account. Deleting is refused while
// you're the only owner of a workspace; the API lists those (409).
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { authApi } from '../api/auth';
import { ApiError, errorMessage } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const MIN_PASSWORD = 8; // docs/api/auth.md §1

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const router = useRouter();

const TOO_MANY = 'Too many wrong passwords. Wait a few minutes and try again.';

// --- Change password ---
const current = ref('');
const next = ref('');
const repeat = ref('');
const changing = ref(false);
const changeError = ref('');
const changed = ref(false);
const tooShort = computed(() => next.value.length > 0 && next.value.length < MIN_PASSWORD);
const mismatch = computed(() => repeat.value.length > 0 && repeat.value !== next.value);
const canChange = computed(
  () => current.value.length > 0 && next.value.length >= MIN_PASSWORD && repeat.value === next.value && !changing.value,
);

async function changePassword(): Promise<void> {
  if (!canChange.value) return;
  changing.value = true;
  changeError.value = '';
  changed.value = false;
  try {
    await authApi.changePassword(current.value, next.value);
    current.value = next.value = repeat.value = '';
    changed.value = true;
  } catch (err) {
    changeError.value =
      err instanceof ApiError && err.status === 403
        ? "That isn't your current password."
        : err instanceof ApiError && err.status === 429
          ? TOO_MANY
          : err instanceof ApiError && err.status === 400 && current.value === next.value
            ? 'The new password must be different from the current one.'
            : errorMessage(err);
  } finally {
    changing.value = false;
  }
}

// --- Delete account: re-enter the password and tick "I understand" (CLAUDE.md rule 6) ---
interface OwnedWorkspace {
  id: string;
  name: string;
  slug: string;
}
const deleting = ref(false);
const deletePassword = ref('');
const understood = ref(false);
const deleteBusy = ref(false);
const deleteError = ref('');
const soleOwnerOf = ref<OwnedWorkspace[]>([]);

function openDelete(): void {
  deletePassword.value = '';
  understood.value = false;
  deleteError.value = '';
  soleOwnerOf.value = [];
  deleting.value = true;
}

async function deleteAccount(): Promise<void> {
  deleteBusy.value = true;
  deleteError.value = '';
  try {
    await authApi.deleteAccount(deletePassword.value);
    deleting.value = false;
    auth.sessionEnded();
    workspaces.reset({ forgetSelection: true });
    await router.replace({ name: 'login' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && Array.isArray(err.body?.workspaces)) {
      soleOwnerOf.value = err.body.workspaces as OwnedWorkspace[];
    } else {
      deleteError.value =
        err instanceof ApiError && err.status === 403 ? "That isn't your password." : err instanceof ApiError && err.status === 429 ? TOO_MANY : errorMessage(err);
    }
  } finally {
    deleteBusy.value = false;
  }
}

// From the 409 list: open that workspace's Members tab to make someone else owner.
async function openMembers(id: string): Promise<void> {
  deleting.value = false;
  workspaces.select(id);
  await router.push({ name: 'settings-members' });
}
</script>

<template>
  <SettingsLayout title="Account">
    <section class="card stack" aria-labelledby="account-email">
      <h2 id="account-email">Email</h2>
      <p class="email">{{ auth.user?.email }}</p>
    </section>

    <section class="card stack" aria-labelledby="account-password">
      <h2 id="account-password">Change password</h2>
      <form class="stack" novalidate @submit.prevent="changePassword">
        <!-- Lets password managers match the account. -->
        <input class="visually-hidden" type="text" autocomplete="username" :value="auth.user?.email ?? ''" readonly tabindex="-1" aria-hidden="true" />
        <div class="field">
          <label for="current-password">Current password<span class="req" aria-hidden="true">*</span></label>
          <input id="current-password" v-model="current" aria-required="true" type="password" autocomplete="current-password" @input="changed = false" />
        </div>
        <div class="field">
          <label for="new-password">New password<span class="req" aria-hidden="true">*</span></label>
          <input id="new-password" v-model="next" aria-required="true" type="password" autocomplete="new-password" :aria-invalid="tooShort" aria-describedby="new-password-hint" />
          <span id="new-password-hint" class="hint" :class="{ invalid: tooShort }">At least {{ MIN_PASSWORD }} characters.</span>
        </div>
        <div class="field">
          <label for="repeat-password">New password again<span class="req" aria-hidden="true">*</span></label>
          <input id="repeat-password" v-model="repeat" aria-required="true" type="password" autocomplete="new-password" :aria-invalid="mismatch" />
          <span v-if="mismatch" class="field-error">The passwords don't match.</span>
        </div>
        <p class="muted small">Your other devices are logged out; this one stays logged in.</p>
        <p v-if="changeError" class="form-error" role="alert">{{ changeError }}</p>
        <div class="actions">
          <button class="btn btn-primary" type="submit" :disabled="!canChange">{{ changing ? 'Changing…' : 'Change password' }}</button>
          <span v-if="changed" class="muted small" aria-live="polite">Password changed.</span>
        </div>
      </form>
    </section>

    <section class="card danger-zone">
      <div>
        <h2>Delete your account</h2>
        <p class="muted small">You leave every workspace. Brews you logged stay in them, without your name.</p>
      </div>
      <button class="btn btn-danger" type="button" @click="openDelete">Delete account</button>
    </section>
  </SettingsLayout>

  <ConfirmDialog :open="deleting" title="Delete your account?" @cancel="deleting = false">
    <form id="delete-account" class="stack" @submit.prevent="deleteAccount">
      <p>This can't be undone. You're removed from every workspace; brews you logged stay in them, without your name.</p>
      <div v-if="soleOwnerOf.length > 0" class="blocked" role="alert">
        <p>You're the only owner of:</p>
        <ul>
          <li v-for="w in soleOwnerOf" :key="w.id">
            <button class="btn-link" type="button" @click="openMembers(w.id)">{{ w.name }}</button>
          </li>
        </ul>
        <p>Make someone else an owner in its Members tab, or delete the workspace, first. Nothing was deleted.</p>
      </div>
      <input class="visually-hidden" type="text" autocomplete="username" :value="auth.user?.email ?? ''" readonly tabindex="-1" aria-hidden="true" />
      <div class="field">
        <label for="delete-password">Your password<span class="req" aria-hidden="true">*</span></label>
        <input id="delete-password" v-model="deletePassword" aria-required="true" type="password" autocomplete="current-password" />
      </div>
      <label class="checkbox">
        <input v-model="understood" type="checkbox" />
        I understand
      </label>
      <p v-if="deleteError" class="form-error" role="alert">{{ deleteError }}</p>
    </form>
    <template #actions>
      <button class="btn btn-danger" type="submit" form="delete-account" :disabled="deleteBusy || !understood || !deletePassword">
        {{ deleteBusy ? 'Deleting…' : 'Delete my account' }}
      </button>
      <button class="btn btn-secondary" type="button" @click="deleting = false">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.email {
  overflow-wrap: anywhere;
}
.hint.invalid {
  color: var(--danger);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.danger-zone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.danger-zone > div {
  flex: 1 1 16rem;
}
.blocked {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--danger-tint);
  color: var(--danger);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.blocked ul {
  margin: 0;
  padding-left: var(--space-4);
}
</style>

<script setup lang="ts">
// Settings → Members (docs/api/workspaces.md §2 Members): everyone sees who's
// in the workspace; owners add people by email (they must have registered,
// there's no email delivery), change roles and remove members; anyone can
// leave. A workspace always keeps at least one owner (the API answers 409).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { membersApi } from '../api/members';
import type { Member, Role } from '../api/types';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { ROLE_HINTS, ROLE_LABELS, ROLES } from '../lib/roles';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const router = useRouter();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const myId = computed(() => auth.user?.id ?? '');

const members = ref<Member[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);

const LAST_OWNER = 'A workspace needs at least one owner. Make someone else an owner first.';
const failure = (err: unknown) => (err instanceof ApiError && err.status === 409 ? LAST_OWNER : errorMessage(err));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    members.value = (await membersApi.list(ws)).members;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// --- Add (owners) ---
const email = ref('');
const role = ref<Role>('barista');
const addError = ref('');
const added = ref('');
async function add(): Promise<void> {
  const ws = workspaces.current?.id;
  const address = email.value.trim();
  if (!ws || !address) return;
  busy.value = true;
  addError.value = '';
  added.value = '';
  try {
    const { member } = await membersApi.add(ws, address, role.value);
    members.value = [...members.value, member].sort((a, b) => a.email.localeCompare(b.email));
    added.value = `${member.email} added as ${ROLE_LABELS[member.role].toLowerCase()}.`;
    email.value = '';
  } catch (err) {
    addError.value =
      err instanceof ApiError && err.status === 404
        ? 'No account with that email. They need to register first, then you can add them.'
        : err instanceof ApiError && err.status === 409
          ? "They're already a member."
          : errorMessage(err);
  } finally {
    busy.value = false;
  }
}

// --- Change a role (owners). Demoting yourself asks first. ---
async function setRole(member: Member, next: Role): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || next === member.role) return;
  busy.value = true;
  error.value = '';
  try {
    const { member: updated } = await membersApi.setRole(ws, member.userId, next);
    members.value = members.value.map((m) => (m.userId === updated.userId ? updated : m));
    if (updated.userId === myId.value) await workspaces.load();
  } catch (err) {
    error.value = failure(err);
  } finally {
    busy.value = false;
  }
}

// One confirmation dialog, for demoting yourself, removing someone, or leaving.
type Pending = { kind: 'demote'; member: Member; role: Role } | { kind: 'remove'; member: Member } | { kind: 'leave' };
const pending = ref<Pending | null>(null);
const pendingError = ref('');
const understood = ref(false); // every one of these needs "I understand" (CLAUDE.md rule 7)
const dialogTitle = computed(() => {
  const p = pending.value;
  if (!p) return '';
  if (p.kind === 'demote') return `Make yourself ${ROLE_LABELS[p.role].toLowerCase()}?`;
  if (p.kind === 'remove') return `Remove ${p.member.email}?`;
  return `Leave ${workspaces.current?.name ?? 'this workspace'}?`;
});
function ask(p: Pending): void {
  pendingError.value = '';
  understood.value = false;
  pending.value = p;
}

function onRoleChange(member: Member, event: Event): void {
  const select = event.target as HTMLSelectElement;
  const next = select.value as Role;
  if (member.userId === myId.value && member.role === 'owner') {
    select.value = member.role; // only changes once confirmed
    ask({ kind: 'demote', member, role: next });
  } else {
    void setRole(member, next);
  }
}

async function confirmPending(): Promise<void> {
  const p = pending.value;
  const ws = workspaces.current?.id;
  if (!p || !ws) return;
  busy.value = true;
  pendingError.value = '';
  try {
    if (p.kind === 'demote') {
      await membersApi.setRole(ws, p.member.userId, p.role);
      pending.value = null;
      await workspaces.load();
      await load();
    } else if (p.kind === 'remove') {
      await membersApi.remove(ws, p.member.userId);
      members.value = members.value.filter((m) => m.userId !== p.member.userId);
      pending.value = null;
    } else {
      await membersApi.remove(ws, myId.value);
      pending.value = null;
      workspaces.select(null);
      await workspaces.load();
      await router.push({ name: workspaces.current ? 'home' : 'workspaces' });
    }
  } catch (err) {
    pendingError.value = failure(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Members">
    <p v-if="loading" class="muted" aria-live="polite">Loading members…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <section v-if="!loading" class="card stack" aria-labelledby="members-list">
      <h2 id="members-list">Who's in {{ workspaces.current?.name }}</h2>
      <ul class="members">
        <li v-for="m in members" :key="m.userId">
          <div class="who">
            <span class="email" :title="m.email">{{ m.email }}</span>
            <span v-if="m.userId === myId" class="muted small">You</span>
          </div>
          <template v-if="isOwner">
            <label class="visually-hidden" :for="`role-${m.userId}`">Role for {{ m.email }}</label>
            <select :id="`role-${m.userId}`" class="role-select" :value="m.role" :disabled="busy" @change="onRoleChange(m, $event)">
              <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
            </select>
            <button v-if="m.userId !== myId" class="btn-link danger" type="button" :disabled="busy" @click="ask({ kind: 'remove', member: m })">
              Remove<span class="visually-hidden"> {{ m.email }}</span>
            </button>
          </template>
          <span v-else class="role">{{ ROLE_LABELS[m.role] }}</span>
        </li>
      </ul>
      <dl class="roles muted small">
        <template v-for="r in ROLES" :key="r">
          <dt>{{ ROLE_LABELS[r] }}</dt>
          <dd>{{ ROLE_HINTS[r] }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="!loading && isOwner" class="card stack" aria-labelledby="members-add">
      <h2 id="members-add">Add someone</h2>
      <p class="muted small">They need an account first: ask them to register, then add the email they used.</p>
      <form class="add" novalidate @submit.prevent="add">
        <div class="field email-field">
          <label for="member-email">Email<span class="req" aria-hidden="true">*</span></label>
          <input id="member-email" v-model="email" aria-required="true" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="255" @input="added = ''" />
        </div>
        <div class="field">
          <label for="member-role">Role</label>
          <select id="member-role" v-model="role">
            <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
          </select>
        </div>
        <button class="btn btn-primary" type="submit" :disabled="busy || !email.trim()">Add</button>
      </form>
      <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
      <p v-if="added" class="muted small" aria-live="polite">{{ added }}</p>
    </section>

    <section v-if="!loading" class="card leave">
      <div>
        <h2>Leave this workspace</h2>
        <p class="muted small">You lose access to its beans, recipes and journal. Brews you logged stay in it.</p>
      </div>
      <button class="btn btn-danger" type="button" :disabled="busy" @click="ask({ kind: 'leave' })">Leave</button>
    </section>
  </SettingsLayout>

  <ConfirmDialog :open="pending !== null" :title="dialogTitle" @cancel="pending = null">
    <p v-if="pending?.kind === 'demote'">You won't be able to change settings or members any more, and only another owner can make you owner again.</p>
    <p v-else-if="pending?.kind === 'remove'">They lose access to this workspace. Brews they logged stay in it. You can add them again later.</p>
    <p v-else-if="pending?.kind === 'leave'">You'll need an owner to add you again to get back in.</p>
    <label class="checkbox">
      <input v-model="understood" type="checkbox" />
      I understand
    </label>
    <p v-if="pendingError" class="form-error" role="alert">{{ pendingError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy || !understood" @click="confirmPending">
        {{ pending?.kind === 'demote' ? 'Change my role' : pending?.kind === 'remove' ? 'Remove' : 'Leave workspace' }}
      </button>
      <button class="btn btn-secondary" type="button" @click="pending = null">Cancel</button>
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
.members {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.members li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--border);
}
.members li:last-child {
  border-bottom: 0;
}
.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.email {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-select {
  flex-shrink: 0;
  min-height: var(--tap);
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: max(1rem, 16px);
  background: var(--surface);
  color: var(--text);
}
.role {
  font-size: 0.8rem;
  padding: 2px var(--space-2);
  border-radius: 999px;
  background: var(--brand-tint);
  color: var(--brand);
  flex-shrink: 0;
}
.roles {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--space-3);
}
.roles dt {
  font-weight: 600;
}
.roles dd {
  margin: 0;
}
.add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
}
.email-field {
  flex: 1 1 14rem;
}
.leave {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.leave > div {
  flex: 1 1 16rem;
}
</style>

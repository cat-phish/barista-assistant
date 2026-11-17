<script setup lang="ts">
// Settings → Guests (docs/api/guests.md §2d): the people this workspace brews
// for besides whoever logs the brew (backlog 67). Add and edit in place;
// archive keeps history, delete goes through DeleteDialog.
import { computed, onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { guestsApi } from '../api/guests';
import type { Guest } from '../api/types';
import DeleteDialog from '../components/DeleteDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const wsId = () => workspaces.current?.id ?? '';
const guests = ref<Guest[]>([]);
const loading = ref(true);
const error = ref('');
const showArchived = ref(false);
const archivedCount = computed(() => guests.value.filter((g) => g.archivedAt).length);
const shown = computed(() => guests.value.filter((g) => !g.archivedAt || showArchived.value));

async function load(): Promise<void> {
  if (!wsId()) return;
  try {
    guests.value = (await guestsApi.list(wsId())).guests;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// One form, for adding (editingId null) or editing one guest.
const editingId = ref<string | null>(null);
const formOpen = ref(false);
const name = ref('');
const notes = ref('');
const submitted = ref(false);
const saving = ref(false);
const formError = ref('');
const nameError = computed(() => (name.value.trim() ? '' : 'Give the guest a name.'));

function openForm(g?: Guest): void {
  editingId.value = g?.id ?? null;
  name.value = g?.name ?? '';
  notes.value = g?.notes ?? '';
  submitted.value = false;
  formError.value = '';
  formOpen.value = true;
}

async function save(): Promise<void> {
  submitted.value = true;
  if (nameError.value || !wsId()) return;
  saving.value = true;
  formError.value = '';
  const input = { name: name.value.trim(), notes: notes.value.trim() || null };
  try {
    if (editingId.value) await guestsApi.update(wsId(), editingId.value, input);
    else await guestsApi.create(wsId(), input);
    formOpen.value = false;
    await load();
  } catch (err) {
    formError.value = err instanceof ApiError && err.status === 409 ? 'A guest with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}

const busyId = ref<string | null>(null);
async function setArchived(g: Guest, archived: boolean): Promise<void> {
  busyId.value = g.id;
  error.value = '';
  try {
    const { guest } = await guestsApi.update(wsId(), g.id, { archived });
    guests.value = guests.value.map((x) => (x.id === guest.id ? guest : x));
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

const deleting = ref<Guest | null>(null);
const deleteUsage = () => guestsApi.usage(wsId(), deleting.value?.id ?? '');
const deleteIt = () => guestsApi.remove(wsId(), deleting.value?.id ?? '');
async function onDeleted(): Promise<void> {
  deleting.value = null;
  await load();
}
</script>

<template>
  <SettingsLayout title="Guests">
    <p class="muted">People you brew for in {{ workspaces.current?.name }}, so a brew can say who it was for.</p>
    <p v-if="loading" class="muted" aria-live="polite">Loading guests…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <section v-if="!loading" class="card stack" aria-labelledby="guests-list">
      <div class="head">
        <h2 id="guests-list">Guests</h2>
        <button v-if="workspaces.canEdit && !formOpen" class="btn btn-primary" type="button" @click="openForm()">Add guest</button>
      </div>

      <form v-if="formOpen" class="stack edit" novalidate @submit.prevent="save">
        <div class="field">
          <label for="guest-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="guest-name" v-model="name" maxlength="100" aria-required="true" placeholder="e.g. Sam" :aria-invalid="submitted && !!nameError" />
          <span v-if="submitted && nameError" class="field-error">{{ nameError }}</span>
        </div>
        <div class="field">
          <label for="guest-notes">Notes</label>
          <textarea id="guest-notes" v-model="notes" maxlength="1000" rows="2" placeholder="e.g. Oat milk, no sugar"></textarea>
        </div>
        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
        <div class="buttons">
          <button class="btn btn-secondary" type="button" @click="formOpen = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editingId ? 'Save guest' : 'Add guest' }}</button>
        </div>
      </form>

      <p v-if="guests.length === 0" class="muted">No guests yet.</p>
      <template v-else>
        <label v-if="archivedCount" class="checkbox">
          <input v-model="showArchived" type="checkbox" />
          Show archived ({{ archivedCount }})
        </label>
        <ul class="list">
          <li v-for="g in shown" :key="g.id" class="item">
            <div class="text">
              <strong>{{ g.name }}</strong><span v-if="g.archivedAt" class="muted"> (archived)</span>
              <span v-if="g.notes" class="muted small">{{ g.notes }}</span>
            </div>
            <div v-if="workspaces.canEdit" class="actions">
              <button class="btn-link" type="button" @click="openForm(g)">Edit</button>
              <button class="btn-link" type="button" :disabled="busyId === g.id" @click="setArchived(g, !g.archivedAt)">{{ g.archivedAt ? 'Restore' : 'Archive' }}</button>
              <button class="btn-link" type="button" @click="deleting = g">Delete</button>
            </div>
          </li>
        </ul>
      </template>
    </section>

    <DeleteDialog
      v-if="deleting"
      :open="!!deleting"
      kind="guest"
      :name="deleting.name"
      :archived="!!deleting.archivedAt"
      :load="deleteUsage"
      :remove="deleteIt"
      @cancel="deleting = null"
      @deleted="onDeleted"
    />
  </SettingsLayout>
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.edit {
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
</style>

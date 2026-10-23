<script setup lang="ts">
// Water profiles (docs/api/water-profiles.md §3c), one tab of Bar setup, like
// grinders: a row expands to its figures and actions. One profile can be the
// default, which new brews start on. Retire keeps history; delete only works
// for profiles no brew used.
import { computed, onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import type { WaterProfile } from '../api/types';
import { waterProfilesApi } from '../api/waterProfiles';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { formatAdded } from '../lib/format';
import { waterSummary } from '../lib/water';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const profiles = ref<WaterProfile[]>([]);
const loading = ref(true);
const error = ref('');
const showRetired = ref(false);

const active = computed(() => profiles.value.filter((p) => !p.retiredAt));
const retired = computed(() => profiles.value.filter((p) => p.retiredAt));
const shown = computed(() => (showRetired.value ? retired.value : active.value));
const figure = (n: number | null) => (n === null ? '–' : String(n));

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    profiles.value = (await waterProfilesApi.list(ws)).waterProfiles;
    if (retired.value.length === 0) showRetired.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const busyId = ref<string | null>(null);
async function change(p: WaterProfile, input: { retired?: boolean; isDefault?: boolean }): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = p.id;
  error.value = '';
  try {
    await waterProfilesApi.update(ws, p.id, input);
    await load(); // a new default clears the old one
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}

// Delete: confirm; if brews used it, the server says how many and we offer Retire.
const pending = ref<WaterProfile | null>(null);
const usedCount = ref<number | null>(null);
const deleting = ref(false);
const dialogError = ref('');
function askDelete(p: WaterProfile): void {
  pending.value = p;
  usedCount.value = null;
  dialogError.value = '';
}
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const p = pending.value;
  if (!ws || !p) return;
  deleting.value = true;
  dialogError.value = '';
  try {
    await waterProfilesApi.remove(ws, p.id);
    pending.value = null;
    await load();
  } catch (err) {
    const count = err instanceof ApiError && err.status === 409 ? err.body?.brewLogCount : undefined;
    if (typeof count === 'number') usedCount.value = count;
    else dialogError.value = errorMessage(err);
  } finally {
    deleting.value = false;
  }
}
async function retireInstead(): Promise<void> {
  const p = pending.value;
  pending.value = null;
  if (p) await change(p, { retired: true });
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'water-profile-new' }">Add water</RouterLink>
    </div>
    <SetupTabs />
    <p class="muted intro">Brews record the water you used. Minerals change extraction, so the AI takes them into account.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading water profiles…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <div v-if="profiles.length === 0" class="card empty">
        <p>No water profiles yet. Add the water you brew with (tap, a bottled water, or a recipe like Third Wave Water) to record it with each brew.</p>
      </div>
      <template v-else>
        <div v-if="retired.length > 0" class="view-toggle">
          <label class="checkbox">
            <input v-model="showRetired" type="checkbox" />
            Show retired ({{ retired.length }})
          </label>
        </div>
        <p v-if="showRetired" class="muted small">Retired water is hidden when brewing; past brews still show it.</p>
        <p v-if="shown.length === 0" class="card empty">No active water profiles.</p>
        <div v-else class="data-table" style="--cols: minmax(0, 2fr) repeat(3, minmax(0, 0.7fr)) 5.5rem">
          <div class="data-row data-head">
            <span class="data-th">Name</span>
            <span class="data-th">TDS</span>
            <span class="data-th">GH</span>
            <span class="data-th">KH</span>
            <span class="data-th end">Added</span>
          </div>
          <div v-for="p in shown" :key="p.id" class="data-item" :class="{ open: openId === p.id }">
            <button class="data-row" type="button" :aria-expanded="openId === p.id" @click="toggle(p.id)">
              <span class="data-td primary">{{ p.name }} <span v-if="p.isDefault" class="badge">Default</span></span>
              <span class="data-td">{{ figure(p.tdsPpm) }}</span>
              <span class="data-td">{{ figure(p.generalHardnessPpm) }}</span>
              <span class="data-td">{{ figure(p.alkalinityPpm) }}</span>
              <span class="data-td end">{{ formatAdded(p.createdAt) }}</span>
            </button>
            <div v-if="openId === p.id" class="data-details">
              <p class="muted">{{ waterSummary(p) ? `${waterSummary(p)} (mg/L)` : 'No figures yet: edit to add TDS, hardness and minerals.' }}</p>
              <p v-if="p.notes" class="muted">{{ p.notes }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <template v-if="p.retiredAt">
                  <button class="btn-link" type="button" :disabled="busyId === p.id" @click="change(p, { retired: false })">Restore</button>
                </template>
                <template v-else>
                  <RouterLink class="btn-link" :to="{ name: 'water-profile-edit', params: { id: p.id } }">Edit</RouterLink>
                  <button v-if="!p.isDefault" class="btn-link" type="button" :disabled="busyId === p.id" @click="change(p, { isDefault: true })">Make default</button>
                  <button v-else class="btn-link" type="button" :disabled="busyId === p.id" @click="change(p, { isDefault: false })">Remove default</button>
                  <button class="btn-link" type="button" :disabled="busyId === p.id" @click="change(p, { retired: true })">Retire</button>
                </template>
                <button class="btn-link danger" type="button" @click="askDelete(p)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" :title="usedCount === null ? 'Delete this water profile?' : 'This water has brew history'" @cancel="pending = null">
    <p v-if="usedCount === null">{{ pending?.name }} will be removed.</p>
    <p v-else>
      {{ usedCount }} brew{{ usedCount === 1 ? ' was' : 's were' }} made with {{ pending?.name }}, so it can't be deleted.
      Retire it instead: it's hidden when brewing, and past brews keep showing it.
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button v-if="usedCount === null" class="btn btn-danger" type="button" :disabled="deleting" @click="confirmDelete">Delete</button>
      <button v-else class="btn btn-primary" type="button" @click="retireInstead">Retire instead</button>
      <button class="btn btn-secondary" type="button" :disabled="deleting" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
.view-toggle {
  display: flex;
  justify-content: flex-end;
}
</style>

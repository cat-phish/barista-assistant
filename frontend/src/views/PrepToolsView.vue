<script setup lang="ts">
// Prep tools (docs/api/prep-tools.md §3d), one tab of Bar setup: the brew
// form's Prep checklist, in this order. Add, edit (name and method), move
// up/down, archive (keeps history) or delete (only tools no brew used).
import { computed, onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { prepToolsApi } from '../api/prepTools';
import type { MethodKind, PrepTool } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { METHOD_KINDS, METHOD_ORDER } from '../lib/equipment';
import { methodLabel } from '../lib/prepTools';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const tools = ref<PrepTool[]>([]);
const loading = ref(true);
const error = ref('');
const showArchived = ref(false);

const archivedCount = computed(() => tools.value.filter((t) => t.archivedAt).length);
const shown = computed(() => tools.value.filter((t) => !t.archivedAt || showArchived.value));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    tools.value = (await prepToolsApi.list(ws)).tools;
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const busy = ref(false);
const conflict = (err: unknown) => (err instanceof ApiError && err.status === 409 ? 'A tool with that name already exists.' : errorMessage(err));
async function run(action: (ws: string) => Promise<unknown>): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws) return false;
  busy.value = true;
  error.value = '';
  try {
    await action(ws);
    await load();
    return true;
  } catch (err) {
    error.value = conflict(err);
    return false;
  } finally {
    busy.value = false;
  }
}

// '' in the method selects = every method.
type MethodChoice = MethodKind | '';
const newName = ref('');
const newMethod = ref<MethodChoice>('');
async function add(): Promise<void> {
  const name = newName.value.trim();
  if (name && (await run((ws) => prepToolsApi.create(ws, { name, methodKind: newMethod.value || null })))) newName.value = '';
}

const editingId = ref<string | null>(null);
const editName = ref('');
const editMethod = ref<MethodChoice>('');
function startEdit(t: PrepTool): void {
  editingId.value = t.id;
  editName.value = t.name;
  editMethod.value = t.methodKind ?? '';
  error.value = '';
}
async function saveEdit(t: PrepTool): Promise<void> {
  const name = editName.value.trim();
  if (name && (await run((ws) => prepToolsApi.update(ws, t.id, { name, methodKind: editMethod.value || null })))) editingId.value = null;
}

// Swap with the neighbour on screen; the API takes the whole list (archived too).
async function move(t: PrepTool, by: -1 | 1): Promise<void> {
  const neighbour = shown.value[shown.value.indexOf(t) + by];
  if (!neighbour) return;
  const ids = tools.value.map((x) => x.id);
  const a = ids.indexOf(t.id);
  const b = ids.indexOf(neighbour.id);
  [ids[a], ids[b]] = [neighbour.id, t.id];
  await run((ws) => prepToolsApi.reorder(ws, ids));
}

const setArchived = (t: PrepTool, archived: boolean) => run((ws) => prepToolsApi.update(ws, t.id, { archived }));

// Delete: confirm; if brews used it, the server says how many and we offer Archive.
const pending = ref<PrepTool | null>(null);
const usedCount = ref<number | null>(null);
const dialogError = ref('');
function askDelete(t: PrepTool): void {
  pending.value = t;
  usedCount.value = null;
  dialogError.value = '';
}
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const t = pending.value;
  if (!ws || !t) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await prepToolsApi.remove(ws, t.id);
    pending.value = null;
    await load();
  } catch (err) {
    const count = err instanceof ApiError && err.status === 409 ? err.body?.brewLogCount : undefined;
    if (typeof count === 'number') usedCount.value = count;
    else dialogError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
async function archiveInstead(): Promise<void> {
  const t = pending.value;
  pending.value = null;
  if (t) await setArchived(t, true);
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
    </div>
    <SetupTabs />
    <p class="muted intro">The prep you can tick on each brew, in this order. A tool for one method only shows on that method's brews; the AI sees what you ticked.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading tools…</p>
    <template v-else>
      <section class="card stack" aria-labelledby="tools-title">
        <div class="head">
          <h2 id="tools-title">Tools</h2>
          <label v-if="archivedCount > 0" class="checkbox">
            <input v-model="showArchived" type="checkbox" />
            Show archived ({{ archivedCount }})
          </label>
        </div>
        <ol v-if="shown.length" class="tools">
          <li v-for="(t, i) in shown" :key="t.id">
            <form v-if="editingId === t.id" class="row" novalidate @submit.prevent="saveEdit(t)">
              <label class="visually-hidden" :for="`tool-${t.id}`">Name</label>
              <input :id="`tool-${t.id}`" v-model="editName" maxlength="100" />
              <label class="visually-hidden" :for="`tool-method-${t.id}`">Method</label>
              <select :id="`tool-method-${t.id}`" v-model="editMethod">
                <option value="">All methods</option>
                <option v-for="k in METHOD_ORDER" :key="k" :value="k">{{ METHOD_KINDS[k].label }}</option>
              </select>
              <button class="btn-link" type="submit" :disabled="busy || !editName.trim()">Save</button>
              <button class="btn-link" type="button" @click="editingId = null">Cancel</button>
            </form>
            <div v-else class="row">
              <span class="name" :class="{ muted: t.archivedAt }">{{ t.name }}<template v-if="t.archivedAt"> (archived)</template></span>
              <span class="badge">{{ methodLabel(t.methodKind) }}</span>
              <template v-if="workspaces.canEdit">
                <button class="btn-link" type="button" :disabled="busy || i === 0" :aria-label="`Move ${t.name} up`" @click="move(t, -1)">↑</button>
                <button class="btn-link" type="button" :disabled="busy || i === shown.length - 1" :aria-label="`Move ${t.name} down`" @click="move(t, 1)">↓</button>
                <template v-if="t.archivedAt">
                  <button class="btn-link" type="button" :disabled="busy" @click="setArchived(t, false)">Restore</button>
                </template>
                <template v-else>
                  <button class="btn-link" type="button" @click="startEdit(t)">Edit</button>
                  <button class="btn-link" type="button" :disabled="busy" @click="setArchived(t, true)">Archive</button>
                </template>
                <button class="btn-link danger" type="button" @click="askDelete(t)">Delete</button>
              </template>
            </div>
          </li>
        </ol>
        <p v-else class="muted small">No tools yet.</p>
        <form v-if="workspaces.canEdit" class="row" novalidate @submit.prevent="add">
          <label class="visually-hidden" for="new-tool">New tool</label>
          <input id="new-tool" v-model="newName" maxlength="100" placeholder="e.g. Melodrip" />
          <label class="visually-hidden" for="new-tool-method">Method</label>
          <select id="new-tool-method" v-model="newMethod">
            <option value="">All methods</option>
            <option v-for="k in METHOD_ORDER" :key="k" :value="k">{{ METHOD_KINDS[k].label }}</option>
          </select>
          <button class="btn btn-secondary" type="submit" :disabled="busy || !newName.trim()">Add</button>
        </form>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </section>
    </template>
  </main>

  <ConfirmDialog :open="pending !== null" :title="usedCount === null ? 'Delete this tool?' : 'This tool has brew history'" @cancel="pending = null">
    <p v-if="usedCount === null">{{ pending?.name }} will be removed.</p>
    <p v-else>
      {{ usedCount }} brew{{ usedCount === 1 ? '' : 's' }} used {{ pending?.name }}, so it can't be deleted.
      Archive it instead: it leaves the checklist, and past brews keep showing it.
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button v-if="usedCount === null" class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete</button>
      <button v-else class="btn btn-primary" type="button" @click="archiveInstead">Archive instead</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
  margin: 0;
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.tools {
  margin: 0;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.row input {
  flex: 1;
  min-width: 10rem;
}
.name {
  flex: 1;
}
</style>

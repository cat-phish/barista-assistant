<script setup lang="ts">
// An editable list of names for Settings → Lists (processes now; styles and
// methods later): add, rename, move up/down, hide or show, and delete custom
// entries. Built-ins (builtin set) can be renamed and hidden but not deleted.
// Deleting goes through DeleteDialog, so what uses it is listed first and an
// "I understand" is needed when anything does (CLAUDE.md rule 6).
import { ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import type { DeletableKind, Usage } from '../lib/deleting';
import { useWorkspaceStore } from '../stores/workspace';
import DeleteDialog from './DeleteDialog.vue';

export interface ListEntry {
  id: string;
  name: string;
  hidden: boolean;
  builtin: string | null;
}
export interface ListApi {
  create: (ws: string, name: string) => Promise<unknown>;
  update: (ws: string, id: string, changes: { name?: string; hidden?: boolean }) => Promise<unknown>;
  reorder: (ws: string, ids: string[]) => Promise<unknown>;
  usage: (ws: string, id: string) => Promise<Usage>;
  remove: (ws: string, id: string) => Promise<unknown>;
}

const props = defineProps<{
  entries: ListEntry[];
  api: ListApi;
  kind: DeletableKind; // for the delete dialog's wording
  noun: string; // "process"
  placeholder: string; // for the add field
  hiddenHint: string; // what hiding does
}>();
const emit = defineEmits<{ changed: [] }>();
const workspaces = useWorkspaceStore();

const busy = ref(false);
const error = ref('');
async function run(action: (ws: string) => Promise<unknown>): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws) return false;
  busy.value = true;
  error.value = '';
  try {
    await action(ws);
    emit('changed');
    return true;
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? `There's already a ${props.noun} with that name.` : errorMessage(err);
    return false;
  } finally {
    busy.value = false;
  }
}

const newName = ref('');
async function add(): Promise<void> {
  const name = newName.value.trim();
  if (name && (await run((ws) => props.api.create(ws, name)))) newName.value = '';
}

const editingId = ref<string | null>(null);
const editName = ref('');
function startEdit(e: ListEntry): void {
  editingId.value = e.id;
  editName.value = e.name;
  error.value = '';
}
async function saveEdit(e: ListEntry): Promise<void> {
  const name = editName.value.trim();
  if (name === e.name) editingId.value = null;
  else if (name && (await run((ws) => props.api.update(ws, e.id, { name })))) editingId.value = null;
}

async function move(index: number, by: -1 | 1): Promise<void> {
  const ids = props.entries.map((e) => e.id);
  const [id] = ids.splice(index, 1);
  if (!id) return;
  ids.splice(index + by, 0, id);
  await run((ws) => props.api.reorder(ws, ids));
}

const toggleHidden = (e: ListEntry) => run((ws) => props.api.update(ws, e.id, { hidden: !e.hidden }));

const deleting = ref<ListEntry | null>(null);
const loadUsage = () => props.api.usage(workspaces.current?.id ?? '', deleting.value?.id ?? '');
const remove = () => props.api.remove(workspaces.current?.id ?? '', deleting.value?.id ?? '');
function deleted(): void {
  deleting.value = null;
  emit('changed');
}
</script>

<template>
  <ol class="entries">
    <li v-for="(e, i) in entries" :key="e.id" :class="{ hidden: e.hidden }">
      <form v-if="editingId === e.id" class="row" novalidate @submit.prevent="saveEdit(e)">
        <label class="visually-hidden" :for="`entry-${e.id}`">Name</label>
        <input :id="`entry-${e.id}`" v-model="editName" maxlength="100" />
        <button class="btn-link" type="submit" :disabled="busy || !editName.trim()">Save</button>
        <button class="btn-link" type="button" @click="editingId = null">Cancel</button>
      </form>
      <div v-else class="row">
        <span class="name">
          {{ e.name }}
          <span v-if="e.hidden" class="badge">Hidden</span>
          <span v-if="e.builtin" class="muted small">built-in</span>
        </span>
        <template v-if="workspaces.canEdit">
          <span class="actions">
            <button class="btn-link" type="button" :disabled="busy || i === 0" :aria-label="`Move ${e.name} up`" @click="move(i, -1)">↑</button>
            <button class="btn-link" type="button" :disabled="busy || i === entries.length - 1" :aria-label="`Move ${e.name} down`" @click="move(i, 1)">↓</button>
            <button class="btn-link" type="button" @click="startEdit(e)">Rename</button>
            <button class="btn-link" type="button" :disabled="busy" @click="toggleHidden(e)">{{ e.hidden ? 'Show' : 'Hide' }}</button>
            <button v-if="!e.builtin" class="btn-link danger" type="button" @click="deleting = e">Delete</button>
          </span>
        </template>
      </div>
    </li>
  </ol>
  <p class="muted small">{{ hiddenHint }}</p>
  <form v-if="workspaces.canEdit" class="row" novalidate @submit.prevent="add">
    <label class="visually-hidden" :for="`new-${kind}`">New {{ noun }}</label>
    <input :id="`new-${kind}`" v-model="newName" maxlength="100" :placeholder="placeholder" />
    <button class="btn btn-secondary" type="submit" :disabled="busy || !newName.trim()">Add</button>
  </form>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p>

  <DeleteDialog
    :open="deleting !== null"
    :kind="kind"
    :name="deleting?.name ?? ''"
    :load="loadUsage"
    :remove="remove"
    :alternative="`To keep it on those, hide it instead: it leaves the choices but stays where it's used.`"
    @cancel="deleting = null"
    @deleted="deleted"
  />
</template>

<style scoped>
.entries {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}
.entries li {
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--border);
}
.entries li:last-child {
  border-bottom: 0;
}
.entries li.hidden .name {
  color: var(--text-muted);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-height: var(--tap);
}
.row input {
  flex: 1;
  min-width: 10rem;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: max(1rem, 16px);
  background: var(--surface);
  color: var(--text);
}
.name {
  flex: 1 1 10rem;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
}
p {
  margin: 0;
}
</style>

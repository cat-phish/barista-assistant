<script setup lang="ts">
// An editable list of names for Settings → Lists (processes, recipe styles;
// methods later): add, rename, move up/down, hide or show, and delete custom
// entries. An optional choice goes with each custom entry (a style's "brews
// like"): asked when adding, shown and changeable on the row. Built-ins (builtin set) can be renamed and hidden but not deleted.
// Deleting goes through DeleteDialog, so what uses it is listed first and an
// "I understand" is needed when anything does (CLAUDE.md rule 7).
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import ReorderHandle from './ReorderHandle.vue';
import { ApiError, errorMessage } from '../api/client';
import type { DeletableKind, Usage } from '../lib/deleting';
import { useReorder } from '../composables/useReorder';
import { useWorkspaceStore } from '../stores/workspace';
import DeleteDialog from './DeleteDialog.vue';

export interface ListEntry {
  id: string;
  name: string;
  hidden: boolean;
  builtin: string | null;
  choice?: string; // e.g. a style's brewsLike
}
export interface ListApi {
  create: (ws: string, name: string, choice?: string) => Promise<unknown>;
  update: (ws: string, id: string, changes: { name?: string; hidden?: boolean; choice?: string }) => Promise<unknown>;
  reorder: (ws: string, ids: string[]) => Promise<unknown>;
  usage: (ws: string, id: string) => Promise<Usage>;
  remove: (ws: string, id: string) => Promise<unknown>;
}

const props = defineProps<{
  entries: ListEntry[];
  draggable?: boolean; // opt in for brew problems
  reload: () => Promise<void>; // after every change; the list stays locked until it's done
  api: ListApi;
  kind: DeletableKind; // for the delete dialog's wording
  noun: string; // "process"
  placeholder: string; // for the add field
  hiddenHint: string; // what hiding does
  choices?: Array<{ value: string; label: string }>; // offered for custom entries
  choiceLabel?: string; // "Brews like"
  // What switching an entry off is called: hide (lists) or archive (brew problems).
  words?: { hide: string; show: string; hidden: string };
}>();
const words = computed(() => props.words ?? { hide: 'Hide', show: 'Show', hidden: 'Hidden' });
const workspaces = useWorkspaceStore();
const ordered = ref<ListEntry[]>([...props.entries]);
watch(() => props.entries, (entries) => { ordered.value = [...entries]; });

// v-model:busy lets a parent lock what's around the list (e.g. its import)
// while a change saves.
const busy = defineModel<boolean>('busy', { default: false });
// A failed reload can replace the list with the parent's error mid-save;
// the parent mustn't stay locked by a list that's gone.
onBeforeUnmount(() => { busy.value = false; });
const error = ref('');
async function run(action: (ws: string) => Promise<unknown>): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws || busy.value) return false;
  busy.value = true;
  error.value = '';
  try {
    await action(ws);
    await props.reload();
    return true;
  } catch (err) {
    // A 409 is a taken name, unless the server explains (e.g. recipes use a
    // method's brewers, so its behaviour can't change).
    const taken = err instanceof ApiError && err.status === 409 && err.body?.recipeCount === undefined;
    error.value = taken ? `There's already a ${props.noun} with that name.` : errorMessage(err);
    return false;
  } finally {
    busy.value = false;
  }
}

const newName = ref('');
const newChoice = ref(props.choices?.[0]?.value ?? '');
async function add(): Promise<void> {
  const name = newName.value.trim();
  const choice = props.choices ? newChoice.value || props.choices[0]?.value : undefined;
  if (name && (await run((ws) => props.api.create(ws, name, choice)))) newName.value = '';
}
const choiceText = (value: string | undefined) => props.choices?.find((c) => c.value === value)?.label.toLowerCase() ?? '';
// A refused change redraws the row's select, so it shows what's saved again.
const revision = ref(0);
async function setChoice(e: ListEntry, choice: string): Promise<void> {
  if (!(await run((ws) => props.api.update(ws, e.id, { choice })))) revision.value += 1;
}

const editingId = ref<string | null>(null);
const editName = ref('');
function startEdit(e: ListEntry): void {
  if (busy.value) return;
  editingId.value = e.id;
  editName.value = e.name;
  error.value = '';
}
async function saveEdit(e: ListEntry): Promise<void> {
  const name = editName.value.trim();
  if (name === e.name) editingId.value = null;
  else if (name && (await run((ws) => props.api.update(ws, e.id, { name })))) editingId.value = null;
}

const reorderDisabled = computed(() => busy.value || !workspaces.canEdit || editingId.value !== null);
const { announcement: moveAnnouncement, onDragUpdate, move } = useReorder({
  items: ordered,
  visible: () => ordered.value,
  disabled: () => reorderDisabled.value,
  save: (next) => run((ws) => props.api.reorder(ws, next.map((item) => item.id))),
});

const toggleHidden = (e: ListEntry) => run((ws) => props.api.update(ws, e.id, { hidden: !e.hidden }));

const deleting = ref<ListEntry | null>(null);
const loadUsage = () => props.api.usage(workspaces.current?.id ?? '', deleting.value?.id ?? '');
const remove = () => props.api.remove(workspaces.current?.id ?? '', deleting.value?.id ?? '');
function deleted(): void {
  deleting.value = null;
  void props.reload();
}
</script>

<template>
  <p v-if="draggable && workspaces.canEdit && ordered.length > 1" class="muted small">Drag ⠿ to reorder, or use the arrow buttons.</p>
  <span class="visually-hidden" aria-live="polite">{{ moveAnnouncement }}</span>
  <VueDraggable ref="reorder-list" :model-value="ordered" tag="ol" class="entries"
    handle=".reorder-handle" :animation="150" ghost-class="drag-ghost"
    :disabled="!draggable || reorderDisabled" :custom-update="onDragUpdate" :inert="busy">
    <li v-for="(e, i) in ordered" :key="e.id" :data-reorder-id="e.id" :class="{ hidden: e.hidden }">
      <form v-if="editingId === e.id" class="row" novalidate @submit.prevent="saveEdit(e)">
        <label class="visually-hidden" :for="`entry-${e.id}`">Name</label>
        <input :id="`entry-${e.id}`" v-model="editName" maxlength="100" />
        <button class="btn-link" type="submit" :disabled="busy || !editName.trim()">Save</button>
        <button class="btn-link" type="button" @click="editingId = null">Cancel</button>
      </form>
      <div v-else class="row">
        <ReorderHandle v-if="draggable && workspaces.canEdit" :name="e.name" :disabled="reorderDisabled" @move="move(i, $event)" />
        <span class="name">
          {{ e.name }}
          <span v-if="e.hidden" class="badge">{{ words.hidden }}</span>
          <span v-if="e.builtin" class="muted small">built-in</span>
          <span v-else-if="choices && !workspaces.canEdit" class="muted small">{{ choiceLabel?.toLowerCase() }} {{ choiceText(e.choice) }}</span>
          <label v-else-if="choices" class="choice muted small">
            {{ choiceLabel?.toLowerCase() }}
            <select :key="`${e.id}-${revision}`" :value="e.choice" :disabled="busy" :aria-label="`${choiceLabel} for ${e.name}`" @change="setChoice(e, ($event.target as HTMLSelectElement).value)">
              <option v-for="c in choices" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </label>
        </span>
        <template v-if="workspaces.canEdit">
          <span class="actions">
            <button class="btn-link" type="button" :disabled="reorderDisabled || i === 0" :aria-label="`Move ${e.name} up`" @click="move(i, -1)">↑</button>
            <button class="btn-link" type="button" :disabled="reorderDisabled || i === ordered.length - 1" :aria-label="`Move ${e.name} down`" @click="move(i, 1)">↓</button>
            <button class="btn-link" type="button" @click="startEdit(e)">Rename</button>
            <button class="btn-link" type="button" :disabled="busy" @click="toggleHidden(e)">{{ e.hidden ? words.show : words.hide }}</button>
            <button v-if="!e.builtin" class="btn-link danger" type="button" @click="deleting = e">Delete</button>
          </span>
        </template>
      </div>
    </li>
  </VueDraggable>
  <p class="muted small">{{ hiddenHint }}</p>
  <form v-if="workspaces.canEdit" class="row" :inert="busy" novalidate @submit.prevent="add">
    <label class="visually-hidden" :for="`new-${kind}`">New {{ noun }}</label>
    <input :id="`new-${kind}`" v-model="newName" maxlength="100" :placeholder="placeholder" />
    <label v-if="choices && choices.length > 1" class="choice-new">
      <span>{{ choiceLabel }}</span>
      <select v-model="newChoice">
        <option v-for="c in choices" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
    </label>
    <button class="btn btn-secondary" type="submit" :disabled="busy || !newName.trim()">Add</button>
  </form>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p>

  <DeleteDialog
    :open="deleting !== null"
    :kind="kind"
    :name="deleting?.name ?? ''"
    :load="loadUsage"
    :remove="remove"
    :alternative="`To keep it on those, ${words.hide.toLowerCase()} it instead: it leaves the choices but stays where it's used.`"
    @cancel="deleting = null"
    @deleted="deleted"
  />
</template>

<style scoped>
.drag-ghost { opacity: 0.35; }
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
.choice,
.choice-new {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.choice-new {
  font-size: 0.9rem;
  color: var(--text-muted);
}
.choice select,
.choice-new select {
  min-height: 2rem;
  padding: 0 var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  background: var(--surface);
  color: var(--text);
}
.choice-new select {
  min-height: var(--tap);
  font-size: max(1rem, 16px);
}
p {
  margin: 0;
}
</style>

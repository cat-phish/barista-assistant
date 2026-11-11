<script setup lang="ts">
// The menu's other items (docs/api/menu.md §7b "Other items"): things that
// aren't a drink or brewer, like a pastry or "ask about our decaf". Listed,
// added and edited here; placed in sections from the add picker, where each
// placement has its own price. Deleting one that's on the menu asks for
// "I understand" (DeleteDialog), since it leaves those sections.
import { ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { menuApi } from '../api/menu';
import type { Menu, MenuOtherItem } from '../api/types';
import { useWorkspaceStore } from '../stores/workspace';
import ConfirmDialog from './ConfirmDialog.vue';
import DeleteDialog from './DeleteDialog.vue';

const props = defineProps<{ open: boolean; items: MenuOtherItem[] }>();
const emit = defineEmits<{ close: []; changed: [menu: Menu] }>();
const workspaces = useWorkspaceStore();
const wsId = () => workspaces.current?.id ?? '';

// One form, for a new item (editing === 'new') or an existing one.
const editing = ref<MenuOtherItem | 'new' | null>(null);
const name = ref('');
const description = ref('');
const busy = ref(false);
const error = ref('');
const deleting = ref<MenuOtherItem | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) startEdit(props.items.length ? null : 'new');
  },
);

function startEdit(item: MenuOtherItem | 'new' | null): void {
  editing.value = item;
  name.value = item && item !== 'new' ? item.name : '';
  description.value = item && item !== 'new' ? (item.description ?? '') : '';
  error.value = '';
}

async function save(): Promise<void> {
  const target = editing.value;
  if (!target || !name.value.trim()) return;
  const input = { name: name.value.trim(), description: description.value.trim() || null };
  busy.value = true;
  error.value = '';
  try {
    emit('changed', target === 'new' ? await menuApi.addOtherItem(wsId(), input) : await menuApi.updateOtherItem(wsId(), target.id, input));
    startEdit(null);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const loadUsage = () => menuApi.otherItemUsage(wsId(), deleting.value?.id ?? '');
const remove = async () => emit('changed', await menuApi.removeOtherItem(wsId(), deleting.value?.id ?? ''));
const placed = (n: number) => (n === 0 ? 'not on the menu' : `in ${n} section${n === 1 ? '' : 's'}`);
</script>

<template>
  <ConfirmDialog :open="open && deleting === null" title="Other items" @cancel="emit('close')">
    <p class="muted small">Things on the menu that aren't a drink or brewer: a pastry, a bag of beans, "ask about our decaf". Add them to a section like a drink; each section sets its own price.</p>
    <ul v-if="items.length" class="list">
      <li v-for="o in items" :key="o.id">
        <div class="main">
          <span class="name">{{ o.name }}</span>
          <span v-if="o.description" class="muted small">“{{ o.description }}”</span>
          <span class="muted small">{{ placed(o.menuItemCount) }}</span>
        </div>
        <span v-if="workspaces.canEdit" class="actions">
          <button class="btn-link" type="button" :disabled="busy" @click="startEdit(o)">Edit</button>
          <button class="btn-link danger" type="button" :disabled="busy" @click="deleting = o">Delete</button>
        </span>
      </li>
    </ul>
    <p v-else class="muted small">None yet.</p>

    <form v-if="workspaces.canEdit && editing" id="other-item-form" class="stack" novalidate @submit.prevent="save">
      <h3>{{ editing === 'new' ? 'New other item' : `Edit ${editing.name}` }}</h3>
      <div class="field">
        <label for="other-item-name">Name<span class="req" aria-hidden="true">*</span></label>
        <input id="other-item-name" v-model="name" aria-required="true" maxlength="100" placeholder="e.g. Almond croissant" />
      </div>
      <div class="field">
        <label for="other-item-description">Description</label>
        <input id="other-item-description" v-model="description" maxlength="500" placeholder="e.g. Baked daily" />
      </div>
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template #actions>
      <template v-if="workspaces.canEdit && editing">
        <button class="btn btn-primary" type="submit" form="other-item-form" :disabled="busy || !name.trim()">{{ editing === 'new' ? 'Add' : 'Save' }}</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="startEdit(null)">Cancel</button>
      </template>
      <template v-else>
        <button v-if="workspaces.canEdit" class="btn btn-secondary" type="button" @click="startEdit('new')">+ New other item</button>
        <button class="btn btn-secondary" type="button" @click="emit('close')">Done</button>
      </template>
    </template>
  </ConfirmDialog>

  <DeleteDialog
    :open="deleting !== null"
    kind="menuOtherItem"
    :name="deleting?.name ?? ''"
    :load="loadUsage"
    :remove="remove"
    alternative="To take it off one section only, remove it there instead (Edit on its menu entry)."
    @cancel="deleting = null"
    @deleted="deleting = null"
  />
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: min(40vh, 20rem);
  overflow-y: auto;
}
.list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 600;
}
.actions {
  display: flex;
  gap: var(--space-3);
  flex-shrink: 0;
}
h3 {
  font-size: 1rem;
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
p {
  margin: 0 0 var(--space-3);
}
</style>

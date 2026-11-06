<script setup lang="ts">
// The Columns dialog for a list table: a checkbox per column and its place,
// by drag, the ↑/↓ keys on the handle, or the ▲▼ buttons. Changes show in the
// table straight away and are remembered on this device (lib/tableColumns.ts),
// for wide screens and phones separately. The name column always shows first.
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import ConfirmDialog from './ConfirmDialog.vue';
import ReorderHandle from './ReorderHandle.vue';
import { useReorder } from '../composables/useReorder';
import type { TableColumnsState } from '../lib/tableColumns';

const props = defineProps<{ open: boolean; state: TableColumnsState; noun: string }>();
const emit = defineEmits<{ close: [] }>();

const entries = ref([...props.state.entries]);
watch(() => props.state.entries, (next) => (entries.value = [...next]));

const { announcement, onDragUpdate, move } = useReorder({
  items: entries,
  visible: () => entries.value,
  disabled: () => false,
  save: async (next) => {
    props.state.setOrder(next.map((e) => e.id));
    return true;
  },
});

const phone = computed(() => props.state.layout === 'phone');
</script>

<template>
  <ConfirmDialog :open="open" title="Columns" @cancel="emit('close')">
    <p class="muted small">
      <template v-if="phone">What shows under each {{ noun }}'s name on this device, and in what order. Wider screens keep their own columns.</template>
      <template v-else>The columns this table shows on this device, and their order. Phones keep their own choice.</template>
    </p>
    <span class="visually-hidden" aria-live="polite">{{ announcement }}</span>
    <ul class="columns">
      <li class="locked">
        <span class="handle-space" aria-hidden="true" />
        <label class="checkbox"><input type="checkbox" checked disabled /> {{ state.nameLabel }}</label>
        <span class="muted small">Always shown</span>
      </li>
    </ul>
    <VueDraggable ref="reorder-list" :model-value="entries" tag="ul" class="columns"
      handle=".reorder-handle" :animation="150" ghost-class="drag-ghost" :custom-update="onDragUpdate">
      <li v-for="(e, i) in entries" :key="e.id" :data-reorder-id="e.id">
        <ReorderHandle :name="e.name" :disabled="false" @move="move(i, $event)" />
        <label class="checkbox"><input type="checkbox" :checked="e.on" @change="state.setOn(e.id, ($event.target as HTMLInputElement).checked)" /> {{ e.name }}</label>
        <span v-if="phone && e.end" class="muted small hint">Beside the name</span>
        <span class="steps">
          <button class="btn-link step" type="button" :disabled="i === 0" :aria-label="`Move ${e.name} up`" @click="move(i, -1)">▲</button>
          <button class="btn-link step" type="button" :disabled="i === entries.length - 1" :aria-label="`Move ${e.name} down`" @click="move(i, 1)">▼</button>
        </span>
      </li>
    </VueDraggable>
    <template #actions>
      <button class="btn btn-primary" type="button" @click="emit('close')">Done</button>
      <button v-if="state.customized" class="btn-link" type="button" @click="state.reset()">Back to the default columns</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.columns {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--tap);
  border-top: 1px solid var(--border);
}
.columns:first-of-type li {
  border-top: 0;
}
.checkbox {
  flex: 1;
  min-width: 0;
}
.handle-space {
  width: var(--tap);
  flex-shrink: 0;
}
.hint {
  margin: 0;
}
.locked .small {
  padding-right: var(--space-2);
}
.steps {
  display: flex;
}
.step {
  min-width: var(--tap);
  min-height: var(--tap);
  justify-content: center;
  color: var(--text-muted);
}
.drag-ghost {
  opacity: 0.35;
}
.small {
  font-size: 0.85rem;
  margin: 0 0 var(--space-2);
}
</style>

<script setup lang="ts">
// Delete confirmation for brewers, grinders, water, tools, recipes, drinks and
// ingredients: loads what the delete would affect (GET …/usage) and, when
// anything would, lists it and asks for "I understand" before Delete works.
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { usageWarnings, type DeletableKind, type Usage } from '../lib/deleting';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{
  open: boolean;
  kind: DeletableKind;
  name: string;
  load: () => Promise<Usage>;
  remove: () => Promise<unknown>;
  archived?: boolean; // already archived: don't suggest archiving
  alternative?: string; // what to suggest instead of deleting (default: archive it)
}>();
const emit = defineEmits<{ cancel: []; deleted: [] }>();

const usage = ref<Usage | null>(null);
const understood = ref(false);
const busy = ref(false);
const error = ref('');
const warnings = computed(() => (usage.value ? usageWarnings(props.kind, usage.value) : []));
const ready = computed(() => usage.value !== null && (warnings.value.length === 0 || understood.value));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    usage.value = null;
    understood.value = false;
    error.value = '';
    try {
      usage.value = await props.load();
    } catch (err) {
      error.value = errorMessage(err);
    }
  },
);

async function confirm(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await props.remove();
    emit('deleted');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ConfirmDialog :open="open" :title="`Delete ${name}?`" @cancel="emit('cancel')">
    <p v-if="usage === null && !error" class="muted" aria-live="polite">Checking what uses it…</p>
    <template v-else-if="usage">
      <p v-if="warnings.length === 0">{{ name }} isn't used anywhere. It will be deleted for good.</p>
      <template v-else>
        <p>{{ name }} will be deleted for good, and:</p>
        <ul class="warnings">
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>
        <p v-if="!archived" class="muted small">{{ alternative ?? 'To keep it in your history instead, archive it.' }}</p>
        <label class="checkbox">
          <input v-model="understood" type="checkbox" />
          I understand
        </label>
      </template>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy || !ready" @click="confirm">{{ busy ? 'Deleting…' : 'Delete' }}</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
p {
  margin: 0 0 var(--space-2);
}
.warnings {
  margin: 0 0 var(--space-2);
  padding-left: var(--space-4);
}
.small {
  font-size: 0.85rem;
}
</style>

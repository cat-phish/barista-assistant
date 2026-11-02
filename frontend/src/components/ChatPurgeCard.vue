<script setup lang="ts">
// Purging chat data (docs/api/chat.md §12): can't be undone, so it confirms
// with "I understand" (CLAUDE.md rule 7).
import { ref } from 'vue';
import { errorMessage } from '../api/client';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{ title: string; text: string; warning: string; purge: () => Promise<unknown> }>();
const emit = defineEmits<{ purged: [] }>();

const open = ref(false);
const understood = ref(false);
const busy = ref(false);
const error = ref('');

function ask(): void {
  understood.value = false;
  error.value = '';
  open.value = true;
}
async function confirm(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await props.purge();
    open.value = false;
    emit('purged');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card stack">
    <h2>{{ title }}</h2>
    <p class="muted">{{ text }}</p>
    <div><button class="btn btn-danger" type="button" @click="ask">Purge</button></div>
  </section>
  <ConfirmDialog :open="open" :title="title" @cancel="open = false">
    <p>{{ warning }}</p>
    <label class="checkbox">
      <input v-model="understood" type="checkbox" />
      I understand
    </label>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy || !understood" @click="confirm">Purge</button>
      <button class="btn btn-secondary" type="button" @click="open = false">Cancel</button>
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
</style>

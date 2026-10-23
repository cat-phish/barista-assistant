<script setup lang="ts">
// Settings → Lists: the workspace's editable lists (backlog item 1). Processes
// now; recipe styles and brewer methods join as tabs.
import { onMounted, ref } from 'vue';
import { beanProcessesApi } from '../api/beanProcesses';
import { errorMessage } from '../api/client';
import type { BeanProcess } from '../api/types';
import EditableList, { type ListApi } from '../components/EditableList.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const processes = ref<BeanProcess[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    processes.value = (await beanProcessesApi.list(ws)).processes;
    error.value = '';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const processApi: ListApi = {
  create: beanProcessesApi.create,
  update: beanProcessesApi.update,
  reorder: beanProcessesApi.reorder,
  usage: beanProcessesApi.usage,
  remove: beanProcessesApi.remove,
};
</script>

<template>
  <SettingsLayout title="Lists">
    <p class="muted">The choices offered in forms, for everyone in {{ workspaces.current?.name }}.</p>
    <section class="card stack" aria-labelledby="list-processes">
      <h2 id="list-processes">Bean processes</h2>
      <p class="muted small">How the coffee was processed, offered in the bean form in this order.</p>
      <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
      <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
      <EditableList
        v-else
        :entries="processes"
        :api="processApi"
        kind="process"
        noun="process"
        placeholder="e.g. Yeast Inoculated"
        hidden-hint="Hidden processes aren't offered for new beans; beans that already have one keep it."
        @changed="load"
      />
      <p v-if="!workspaces.canEdit" class="muted small">Only owners and baristas can change lists.</p>
    </section>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
</style>

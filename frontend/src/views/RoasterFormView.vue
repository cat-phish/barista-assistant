<script setup lang="ts">
// Roasting machine editor (docs/api/roasting-machines.md §3f): add one, or
// edit one (route param). Only the name is required.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { roastingMachinesApi } from '../api/roastingMachines';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { machineForm, parseMachineForm } from '../lib/roasting';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => roastingMachinesApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => roastingMachinesApi.remove(workspaces.current?.id ?? '', props.id ?? '');

const form = ref(machineForm());
const parsed = computed(() => parseMachineForm(form.value));
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    if (editing.value) {
      const machine = (await roastingMachinesApi.list(ws)).machines.find((m) => m.id === props.id);
      if (!machine) {
        error.value = 'This roaster no longer exists.';
        return;
      }
      saved.value = { name: machine.name, archived: !!machine.archivedAt };
      form.value = machineForm(machine);
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const values = parsed.value.values;
  if (!ws || !values) return;
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await roastingMachinesApi.update(ws, props.id, values);
    else await roastingMachinesApi.create(ws, values);
    await router.push({ name: 'roasting-machines' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A roaster with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit roaster' : 'Add roaster' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="machine-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="machine-name" v-model="form.name" maxlength="100" aria-required="true" placeholder="e.g. Kaffelogic Nano 7" :aria-invalid="submitted && !!parsed.errors.name" />
          <span v-if="submitted && parsed.errors.name" class="field-error">{{ parsed.errors.name }}</span>
        </div>
        <div class="field capacity">
          <label for="machine-capacity">Largest batch (g of green)</label>
          <input id="machine-capacity" v-model="form.capacity" inputmode="numeric" placeholder="e.g. 120" :aria-invalid="submitted && !!parsed.errors.capacity" />
          <span v-if="submitted && parsed.errors.capacity" class="field-error">{{ parsed.errors.capacity }}</span>
        </div>
        <div class="field">
          <label for="machine-notes">Notes</label>
          <input id="machine-notes" v-model="form.notes" maxlength="255" placeholder="e.g. firmware, mods" />
        </div>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !parsed.values" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'roasting-machines' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save roaster' : 'Add roaster' }}</button>
      </div>
    </form>
    <DeleteSection
      v-if="props.id && saved && workspaces.canEdit"
      kind="roaster"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'roasting-machines' }"
    />
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.capacity {
  max-width: 14rem;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

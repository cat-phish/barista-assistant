<script setup lang="ts">
// Vessel editor (docs/api/vessels.md §3g): add one, or edit one (route param).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { vesselsApi } from '../api/vessels';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { parseVesselForm, vesselForm } from '../lib/vessels';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => vesselsApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => vesselsApi.remove(workspaces.current?.id ?? '', props.id ?? '');

const form = ref(vesselForm());
const parsed = computed(() => parseVesselForm(form.value));
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    if (editing.value) {
      const vessel = (await vesselsApi.list(ws)).vessels.find((v) => v.id === props.id);
      if (!vessel) {
        error.value = 'This vessel no longer exists.';
        return;
      }
      saved.value = { name: vessel.name, archived: !!vessel.archivedAt };
      form.value = vesselForm(vessel);
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
    if (props.id) await vesselsApi.update(ws, props.id, values);
    else await vesselsApi.create(ws, values);
    await router.push({ name: 'vessels' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A vessel with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit vessel' : 'Add vessel' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="vessel-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="vessel-name" v-model="form.name" maxlength="100" aria-required="true" placeholder="e.g. Glass carafe" :aria-invalid="submitted && !!parsed.errors.name" />
          <span v-if="submitted && parsed.errors.name" class="field-error">{{ parsed.errors.name }}</span>
        </div>
        <div class="field weight">
          <label for="vessel-weight">Weight (g)<span class="req" aria-hidden="true">*</span></label>
          <input id="vessel-weight" v-model="form.weight" inputmode="decimal" aria-required="true" placeholder="e.g. 312" :aria-invalid="submitted && !!parsed.errors.weight" />
          <span v-if="submitted && parsed.errors.weight" class="field-error">{{ parsed.errors.weight }}</span>
          <span v-else-if="editing" class="hint">Past brews keep the weight they were saved with</span>
        </div>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !parsed.values" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'vessels' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save vessel' : 'Add vessel' }}</button>
      </div>
    </form>
    <DeleteSection
      v-if="props.id && saved && workspaces.canEdit"
      kind="vessel"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'vessels' }"
    />
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.weight {
  max-width: 14rem;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

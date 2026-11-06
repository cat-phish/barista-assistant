<script setup lang="ts">
// Brew problem editor (docs/api/brew-problems.md §6b), like the prep item
// one: add a problem, or edit one (route param). Name, and where it's
// offered: every brew, or the chosen methods and brewers.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { brewersApi } from '../api/brewers';
import { brewProblemsApi } from '../api/brewProblems';
import type { Brewer, MethodKind } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import OfferedFor from '../components/OfferedFor.vue';
import { METHOD_ORDER } from '../lib/equipment';
import { offeredError } from '../lib/prepTools';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => brewProblemsApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => brewProblemsApi.remove(workspaces.current?.id ?? '', props.id ?? '');
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const name = ref('');
const everyBrew = ref(true);
const methodKinds = ref<MethodKind[]>([]);
const brewerIds = ref<string[]>([]);
const brewers = ref<Brewer[]>([]);
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const archiving = ref(false);
const archiveError = ref('');
const error = ref('');

const nameError = computed(() => (name.value.trim() ? '' : 'Give it a name.'));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [list, problems] = await Promise.all([brewersApi.list(ws), editing.value ? brewProblemsApi.list(ws) : null]);
    brewers.value = list.brewers;
    if (problems) {
      const problem = problems.problems.find((p) => p.id === props.id);
      if (!problem) {
        error.value = 'This problem no longer exists.';
        return;
      }
      saved.value = { name: problem.name, archived: !!problem.archivedAt };
      name.value = problem.name;
      methodKinds.value = [...problem.methodKinds];
      // Brewers since deleted are gone from the problem already (the API drops them).
      brewerIds.value = [...problem.brewerIds];
      everyBrew.value = !problem.methodKinds.length && !problem.brewerIds.length;
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
  if (!ws || saving.value || archiving.value || nameError.value || offeredError(everyBrew.value, methodKinds.value, brewerIds.value)) return;
  saving.value = true;
  error.value = '';
  const values = {
    name: name.value.trim(),
    methodKinds: everyBrew.value ? [] : METHOD_ORDER.filter((k) => methodKinds.value.includes(k)),
    brewerIds: everyBrew.value ? [] : brewerIds.value,
  };
  try {
    if (props.id) await brewProblemsApi.update(ws, props.id, values);
    else await brewProblemsApi.create(ws, values);
    await router.push({ name: 'brew-problems' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A problem with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
// Archiving keeps history and is reversible (docs/api/brew-problems.md §6b).
// Only change the saved archive state; unsaved form edits stay in the form.
async function toggleArchived(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !props.id || !saved.value || saving.value || archiving.value || !workspaces.canEdit) return;
  archiving.value = true;
  archiveError.value = '';
  try {
    const { problem } = await brewProblemsApi.update(ws, props.id, { archived: !saved.value.archived });
    saved.value = { name: problem.name, archived: !!problem.archivedAt };
  } catch (err) {
    archiveError.value = errorMessage(err);
  } finally {
    archiving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit problem' : 'Add problem' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" :inert="archiving" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="problem-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="problem-name" v-model="name" aria-required="true" maxlength="100" placeholder="e.g. Paper taste" :aria-invalid="submitted && !!nameError" />
          <p v-if="submitted && nameError" class="field-error">{{ nameError }}</p>
        </div>
      </section>
      <OfferedFor
        v-model:every-brew="everyBrew"
        v-model:method-kinds="methodKinds"
        v-model:brewer-ids="brewerIds"
        :brewers="brewers"
        :submitted="submitted"
        hint="Where it shows on the brew page's Problems checklist. A brew without a recipe offers every problem."
      />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'brew-problems' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save problem' : 'Add problem' }}</button>
      </div>
    </form>
    <div v-if="props.id && saved && workspaces.canEdit" class="stack" :inert="saving || archiving">
      <section class="card stack" aria-labelledby="archive-title">
        <h2 id="archive-title">{{ saved.archived ? 'Restore this problem' : 'Archive this problem' }}</h2>
        <p class="muted small" aria-live="polite">{{ saved.archived ? 'This problem is archived. Restore it to offer it for new brews again.' : 'Remove it from new brew checklists while keeping it in past brews. You can restore it here later.' }}</p>
        <button class="btn btn-secondary archive-action" type="button" :disabled="saving || archiving" @click="toggleArchived">{{ saved.archived ? 'Restore' : 'Archive' }}</button>
      </section>
    <DeleteSection
      kind="problem"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'brew-problems' }"
    />
    </div>
    <p v-if="archiveError" class="form-error" role="alert">{{ archiveError }}</p>
  </main>
</template>

<style scoped>
.archive-action { align-self: flex-start; }
h2 {
  font-size: 1.1rem;
  margin: 0;
}
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

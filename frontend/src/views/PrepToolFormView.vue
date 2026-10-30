<script setup lang="ts">
// Prep tool editor (docs/api/prep-tools.md §3d), a page of its own like
// grinders: add a tool, or edit one (route param). Name, and where it's
// offered: every brew, or the chosen methods and brewers.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { brewersApi } from '../api/brewers';
import { prepToolsApi } from '../api/prepTools';
import type { Brewer, MethodKind } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { METHOD_KINDS, METHOD_ORDER } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => prepToolsApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => prepToolsApi.remove(workspaces.current?.id ?? '', props.id ?? '');
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

// Brewers by method, active ones plus any archived one already chosen.
const brewerGroups = computed(() =>
  METHOD_ORDER.map((kind) => ({
    kind,
    brewers: brewers.value.filter((b) => b.kind === kind && (!b.archivedAt || brewerIds.value.includes(b.id))),
  })).filter((g) => g.brewers.length),
);
const nameError = computed(() => (name.value.trim() ? '' : 'Give it a name.'));
const offeredError = computed(() => (!everyBrew.value && !methodKinds.value.length && !brewerIds.value.length ? 'Pick a method or brewer, or Every brew.' : ''));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [list, tools] = await Promise.all([brewersApi.list(ws), editing.value ? prepToolsApi.list(ws) : null]);
    brewers.value = list.brewers;
    if (tools) {
      const tool = tools.tools.find((t) => t.id === props.id);
      if (!tool) {
        error.value = 'This prep item no longer exists.';
        return;
      }
      saved.value = { name: tool.name, archived: !!tool.archivedAt };
      name.value = tool.name;
      methodKinds.value = [...tool.methodKinds];
      // Brewers since deleted are gone from the tool already (the API drops them).
      brewerIds.value = [...tool.brewerIds];
      everyBrew.value = !tool.methodKinds.length && !tool.brewerIds.length;
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
  if (!ws || saving.value || archiving.value || nameError.value || offeredError.value) return;
  saving.value = true;
  error.value = '';
  const values = {
    name: name.value.trim(),
    methodKinds: everyBrew.value ? [] : METHOD_ORDER.filter((k) => methodKinds.value.includes(k)),
    brewerIds: everyBrew.value ? [] : brewerIds.value,
  };
  try {
    if (props.id) await prepToolsApi.update(ws, props.id, values);
    else await prepToolsApi.create(ws, values);
    await router.push({ name: 'prep-tools' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A prep item with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
// Archiving keeps history and is reversible (docs/api/prep-tools.md §3d).
// Only change the saved archive state; unsaved form edits stay in the form.
async function toggleArchived(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !props.id || !saved.value || saving.value || archiving.value || !workspaces.canEdit) return;
  archiving.value = true;
  archiveError.value = '';
  try {
    const { tool } = await prepToolsApi.update(ws, props.id, { archived: !saved.value.archived });
    saved.value = { name: tool.name, archived: !!tool.archivedAt };
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
      <h1>{{ editing ? 'Edit prep item' : 'Add prep item' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" :inert="archiving" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="tool-name">Name</label>
          <input id="tool-name" v-model="name" aria-required="true" maxlength="100" placeholder="e.g. Melodrip" :aria-invalid="submitted && !!nameError" />
          <p v-if="submitted && nameError" class="field-error">{{ nameError }}</p>
        </div>
      </section>
      <section class="card stack" aria-labelledby="offered-title">
        <h2 id="offered-title">Offered for</h2>
        <p class="muted small">Where it shows on the brew page's prep checklist. A brew without a recipe offers every prep item.</p>
        <fieldset class="choices">
          <legend class="visually-hidden">Offered for</legend>
          <label class="checkbox"><input v-model="everyBrew" type="radio" :value="true" name="offered" /> Every brew</label>
          <label class="checkbox"><input v-model="everyBrew" type="radio" :value="false" name="offered" /> Only some methods or brewers</label>
        </fieldset>
        <template v-if="!everyBrew">
          <fieldset class="choices">
            <legend>Methods</legend>
            <p class="muted small">Every brewer of the method.</p>
            <label v-for="k in METHOD_ORDER" :key="k" class="checkbox">
              <input v-model="methodKinds" type="checkbox" :value="k" />
              {{ METHOD_KINDS[k].label }}
            </label>
          </fieldset>
          <fieldset class="choices">
            <legend>Brewers</legend>
            <p class="muted small">Just these, on top of the methods above.</p>
            <div v-for="g in brewerGroups" :key="g.kind" class="group">
              <p class="group-name muted">{{ METHOD_KINDS[g.kind].label }}</p>
              <p v-if="methodKinds.includes(g.kind)" class="muted small">Already offered for all of these.</p>
              <label v-for="b in g.brewers" :key="b.id" class="checkbox">
                <input v-model="brewerIds" type="checkbox" :value="b.id" />
                {{ b.name }}<template v-if="b.archivedAt"> (archived)</template>
              </label>
            </div>
            <p v-if="!brewerGroups.length" class="muted small">No brewers yet.</p>
          </fieldset>
          <p v-if="submitted && offeredError" class="field-error" role="alert">{{ offeredError }}</p>
        </template>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'prep-tools' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save prep item' : 'Add prep item' }}</button>
      </div>
    </form>
    <div v-if="props.id && saved && workspaces.canEdit" class="stack" :inert="saving || archiving">
      <section class="card stack" aria-labelledby="archive-title">
        <h2 id="archive-title">{{ saved.archived ? 'Restore this prep item' : 'Archive this prep item' }}</h2>
        <p class="muted small" aria-live="polite">{{ saved.archived ? 'This item is archived. Restore it to offer it for new brews again.' : 'Remove it from new brew checklists while keeping it in past brews. You can restore it here later.' }}</p>
        <button class="btn btn-secondary archive-action" type="button" :disabled="saving || archiving" @click="toggleArchived">{{ saved.archived ? 'Restore' : 'Archive' }}</button>
      </section>
    <DeleteSection
      kind="tool"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'prep-tools' }"
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
.choices {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.choices legend {
  font-weight: 600;
  margin-bottom: var(--space-1);
}
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.group-name {
  font-size: 0.9rem;
  margin-top: var(--space-1);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

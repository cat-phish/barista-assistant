<script setup lang="ts">
// Grinder editor (docs/api_spec.md §3b), a page of its own like recipes: add
// a grinder, or edit one (route param). Only the name is required.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { grindersApi } from '../api/grinders';
import AppHeader from '../components/AppHeader.vue';
import GrinderFields from '../components/GrinderFields.vue';
import { grinderForm, parseGrinderForm } from '../lib/equipment';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const form = ref(grinderForm());
const parsed = computed(() => parseGrinderForm(form.value));
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    if (editing.value) {
      const grinder = (await grindersApi.list(ws)).grinders.find((x) => x.id === props.id);
      if (!grinder) {
        error.value = 'This grinder no longer exists.';
        return;
      }
      form.value = grinderForm(grinder);
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
    if (props.id) await grindersApi.update(ws, props.id, values);
    else {
      const { name, ...details } = values;
      await grindersApi.create(ws, name, details);
    }
    await router.push({ name: 'grinders' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A grinder with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit grinder' : 'Add grinder' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <p v-if="!editing" class="muted small">Only the name is needed; the rest helps the AI and is easy to add later.</p>
        <GrinderFields v-model="form" id-prefix="grinder" :errors="parsed.errors" :show-errors="submitted" />
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !parsed.values" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'grinders' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save grinder' : 'Add grinder' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
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

<script setup lang="ts">
// Note editor (docs/api/notes.md §3h), a page of its own like prep items:
// add a note, or edit one (route param). Title and the text, formatted like
// chat replies. Deleting needs no "I understand": nothing uses a note.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { notesApi } from '../api/notes';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { useWorkspaceStore } from '../stores/workspace';

const MAX_BODY = 20_000; // docs/api/notes.md §3h

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);
const savedTitle = ref<string | null>(null); // as saved, for the Delete section
const deleteIt = () => notesApi.remove(workspaces.current?.id ?? '', props.id ?? '');
const noUsage = async () => ({});

const title = ref('');
const body = ref('');
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

const titleError = computed(() => (title.value.trim() ? '' : 'Give it a title.'));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws || !editing.value) {
    loading.value = false;
    return;
  }
  try {
    const note = (await notesApi.list(ws)).notes.find((n) => n.id === props.id);
    if (!note) {
      error.value = 'This note no longer exists.';
      return;
    }
    savedTitle.value = note.title;
    title.value = note.title;
    body.value = note.body;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!ws || saving.value || titleError.value) return;
  saving.value = true;
  error.value = '';
  const values = { title: title.value.trim(), body: body.value };
  try {
    const { note } = props.id ? await notesApi.update(ws, props.id, values) : await notesApi.create(ws, values);
    await router.push({ name: 'notes', query: { open: note.id } });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A note with that title already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit note' : 'New note' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="note-title">Title<span class="req" aria-hidden="true">*</span></label>
          <input id="note-title" v-model="title" aria-required="true" maxlength="100" placeholder="e.g. Descaling the kettle" :aria-invalid="submitted && !!titleError" />
          <p v-if="submitted && titleError" class="field-error">{{ titleError }}</p>
        </div>
        <div class="field">
          <label for="note-body">Text</label>
          <textarea id="note-body" v-model="body" rows="12" :maxlength="MAX_BODY" aria-describedby="note-body-hint" />
          <p id="note-body-hint" class="muted small">
            Formatted like chat replies: **bold**, *italic*, lists with “- ”, headings with “# ”. A line like “20 g per 1 L” can be scaled to any volume on the Notes page.
          </p>
        </div>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'notes' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save note' : 'Add note' }}</button>
      </div>
    </form>
    <DeleteSection v-if="props.id && savedTitle !== null && workspaces.canEdit" kind="note" :name="savedTitle" :load="noUsage" :remove="deleteIt" :back="{ name: 'notes' }" />
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
  line-height: 1.5;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

<script setup lang="ts">
// Note editor (docs/api/notes.md §3h), a page of its own like prep items:
// add a note, or edit one (route param). A title, then blocks in order: text
// (formatted like chat replies) and calculators (NoteCalculatorEditor), each
// movable and removable. Saving waits until every calculator works out.
// Deleting needs no "I understand": nothing uses a note.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { notesApi } from '../api/notes';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import NoteCalculatorEditor from '../components/NoteCalculatorEditor.vue';
import {
  CALCULATOR_TEMPLATES,
  calculatorErrors,
  DEFAULT_TEMPLATE,
  fromDraft,
  MAX_NOTE_TEXT,
  newCalculator,
  newText,
  textLength,
  toDraft,
  type CalculatorTemplate,
  type DraftBlock,
} from '../lib/noteBlocks';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);
const savedTitle = ref<string | null>(null); // as saved, for the Delete section
const deleteIt = () => notesApi.remove(workspaces.current?.id ?? '', props.id ?? '');
const noUsage = async () => ({});

const title = ref('');
const blocks = ref<DraftBlock[]>([newText()]);
const template = ref<CalculatorTemplate>(DEFAULT_TEMPLATE);
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

const titleError = computed(() => (title.value.trim() ? '' : 'Give it a title.'));
const errorsFor = computed(() => new Map(blocks.value.map((b) => [b.id, b.type === 'calculator' ? calculatorErrors(b) : {}])));
const textUsed = computed(() => textLength(blocks.value));
const tooMuchText = computed(() => textUsed.value > MAX_NOTE_TEXT);
const calculatorProblems = computed(() => [...errorsFor.value.values()].filter((e) => Object.keys(e).length).length);

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
    blocks.value = note.blocks.length ? toDraft(note.blocks) : [newText()];
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

function moveBlock(i: number, by: -1 | 1): void {
  const j = i + by;
  if (j < 0 || j >= blocks.value.length) return;
  const list = blocks.value;
  [list[i], list[j]] = [list[j]!, list[i]!];
}
const removeBlock = (i: number) => blocks.value.splice(i, 1);
const addText = () => blocks.value.push(newText());
const addCalculator = () => blocks.value.push(newCalculator(template.value));
const blockName = (b: DraftBlock) => (b.type === 'text' ? 'text' : b.title.trim() || 'calculator');

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!ws || saving.value || titleError.value || tooMuchText.value || calculatorProblems.value) return;
  saving.value = true;
  error.value = '';
  const values = { title: title.value.trim(), blocks: fromDraft(blocks.value) };
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
          <input id="note-title" v-model="title" aria-required="true" maxlength="100" placeholder="e.g. Descaling the espresso machine" :aria-invalid="submitted && !!titleError" />
          <p v-if="submitted && titleError" class="field-error">{{ titleError }}</p>
        </div>
      </section>

      <section v-for="(b, i) in blocks" :key="b.id" class="card stack block" :aria-label="b.type === 'text' ? `Text ${i + 1}` : `Calculator ${i + 1}`">
        <div class="block-head">
          <h2>{{ b.type === 'text' ? 'Text' : 'Calculator' }}</h2>
          <div class="block-actions">
            <button class="btn-link" type="button" :disabled="i === 0" :aria-label="`Move ${blockName(b)} up`" @click="moveBlock(i, -1)">↑</button>
            <button class="btn-link" type="button" :disabled="i === blocks.length - 1" :aria-label="`Move ${blockName(b)} down`" @click="moveBlock(i, 1)">↓</button>
            <button class="btn-link" type="button" :aria-label="`Remove ${blockName(b)}`" @click="removeBlock(i)">Remove</button>
          </div>
        </div>
        <div v-if="b.type === 'text'" class="field">
          <label :for="`text-${b.id}`" class="visually-hidden">Text</label>
          <textarea :id="`text-${b.id}`" v-model="b.text" rows="8" :aria-describedby="`text-${b.id}-hint`" />
          <p :id="`text-${b.id}-hint`" class="muted small">Formatted like chat replies: **bold**, *italic*, lists with “- ”, headings with “# ”.</p>
        </div>
        <!-- The editor changes the block's fields in place (it's this list's object). -->
        <NoteCalculatorEditor v-else :model-value="b" :errors="errorsFor.get(b.id) ?? {}" :show-errors="submitted" />
      </section>

      <section class="card add-blocks" aria-label="Add to the note">
        <button class="btn btn-secondary" type="button" :disabled="blocks.length >= 50" @click="addText">Add text</button>
        <span class="add-calc">
          <label for="calc-template" class="visually-hidden">Calculator to start from</label>
          <select id="calc-template" v-model="template">
            <option v-for="(t, key) in CALCULATOR_TEMPLATES" :key="key" :value="key">{{ t.label }}</option>
          </select>
          <button class="btn btn-secondary" type="button" :disabled="blocks.length >= 50" @click="addCalculator">Add calculator</button>
        </span>
      </section>

      <p v-if="tooMuchText" class="form-error" role="alert">That's {{ textUsed }} characters of text; a note holds {{ MAX_NOTE_TEXT }}.</p>
      <p v-if="submitted && calculatorProblems" class="form-error" role="alert">
        {{ calculatorProblems === 1 ? 'A calculator needs' : `${calculatorProblems} calculators need` }} fixing before saving: see the messages above.
      </p>
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
h2 {
  font-size: 1rem;
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.block-actions {
  display: flex;
  gap: var(--space-2);
}
textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
  line-height: 1.5;
}
.add-blocks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.add-calc {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

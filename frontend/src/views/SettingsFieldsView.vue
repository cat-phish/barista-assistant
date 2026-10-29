<script setup lang="ts">
// Settings → Fields (docs/api/workspaces.md §2, "Field visibility"): which
// optional fields the brew, bean, recipe (and green coffee) forms show, for everyone in the
// workspace. Owners change them; everyone else sees them.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { FIELD_FORMS, fieldsFor, type FieldForm } from '../lib/fields';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { hiddenFields, settings } = usePreferences();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const saving = ref(false);
const error = ref('');
const activeForm = ref<FieldForm | null>(null); // the section last changed
const saved = ref(false);
// The green coffee form is only there with home roasting on.
const FORMS = computed(() => (Object.keys(FIELD_FORMS) as FieldForm[]).filter((f) => f !== 'green' || settings.value.homeRoasting));

async function toggle(key: string, form: FieldForm, shown: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  const next = shown ? hiddenFields.value.filter((k) => k !== key) : [...hiddenFields.value, key];
  saving.value = true;
  error.value = '';
  saved.value = false;
  activeForm.value = form;
  try {
    await workspacesApi.setSettings(ws, { hiddenFields: next });
    await workspaces.load();
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Fields">
    <p class="muted">
      The optional fields {{ workspaces.current?.name }}'s forms show. A hidden field keeps what's already recorded: it still shows when you edit
      something that has a value in it, and the AI still gets it (<RouterLink :to="{ name: 'settings-ai' }">Settings → AI</RouterLink> chooses what
      it gets). Required fields are always shown.
    </p>

    <section v-for="form in FORMS" :key="form" class="card stack" :aria-labelledby="`fields-${form}`">
      <h2 :id="`fields-${form}`">{{ FIELD_FORMS[form] }}</h2>
      <fieldset class="fields" :disabled="!isOwner || saving">
        <legend class="visually-hidden">Fields shown on the {{ FIELD_FORMS[form].toLowerCase() }} form</legend>
        <label v-for="f in fieldsFor(form)" :key="f.key" class="checkbox field-choice">
          <input type="checkbox" :checked="!hiddenFields.includes(f.key)" @change="toggle(f.key, form, ($event.target as HTMLInputElement).checked)" />
          <span>
            {{ f.label }}
            <span v-if="f.hint" class="muted small hint">{{ f.hint }}</span>
          </span>
        </label>
      </fieldset>
      <p v-if="error && activeForm === form" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && activeForm === form" class="muted small" aria-live="polite">Saved.</p>
    </section>
    <p v-if="!isOwner" class="muted small">Only owners can change these.</p>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.fields {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-2) var(--space-3);
}
.field-choice {
  align-items: flex-start;
}
.field-choice > span {
  display: flex;
  flex-direction: column;
}
.hint {
  font-weight: 400;
}
</style>

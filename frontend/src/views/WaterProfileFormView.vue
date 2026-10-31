<script setup lang="ts">
// Water profile editor (docs/api/water-profiles.md §3c), a page of its own like
// grinders: add a profile, or edit one (route param). Only the name is required.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { WATER_FIGURES } from '../api/types';
import { waterProfilesApi } from '../api/waterProfiles';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { parseWaterForm, WATER_FIGURE_LABELS, waterForm } from '../lib/water';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => waterProfilesApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => waterProfilesApi.remove(workspaces.current?.id ?? '', props.id ?? '');
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const form = ref(waterForm());
const parsed = computed(() => parseWaterForm(form.value));
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

// GH and KH (the usual way water is described) first, then each mineral.
const headline = WATER_FIGURES.slice(0, 3);
const minerals = WATER_FIGURES.slice(3);

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    if (editing.value) {
      const profile = (await waterProfilesApi.list(ws)).waterProfiles.find((x) => x.id === props.id);
      if (!profile) {
        error.value = 'This water profile no longer exists.';
        return;
      }
      saved.value = { name: profile.name, archived: !!profile.archivedAt };
      form.value = waterForm(profile);
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
    if (props.id) await waterProfilesApi.update(ws, props.id, values);
    else await waterProfilesApi.create(ws, values);
    await router.push({ name: 'water-profiles' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A water profile with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit water profile' : 'Add water profile' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="water-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="water-name" aria-required="true" v-model="form.name" maxlength="100" placeholder="e.g. Third Wave Water" :aria-invalid="submitted && !!parsed.errors.name" />
          <span v-if="submitted && parsed.errors.name" class="field-error">{{ parsed.errors.name }}</span>
        </div>
        <div class="field">
          <label for="water-notes">Notes</label>
          <input id="water-notes" v-model="form.notes" maxlength="255" placeholder="e.g. 1 sachet per gallon of distilled" />
        </div>
      </section>

      <section class="card stack">
        <h2>Figures</h2>
        <p class="muted small">In mg/L (ppm). Fill in what your water report or recipe gives; the AI uses whatever is here.</p>
        <div class="figures">
          <div v-for="key in headline" :key="key" class="field">
            <label :for="`water-${key}`">{{ WATER_FIGURE_LABELS[key].label }}</label>
            <input :id="`water-${key}`" v-model="form[key]" inputmode="decimal" :aria-invalid="submitted && !!parsed.errors[key]" />
            <span v-if="submitted && parsed.errors[key]" class="field-error">{{ parsed.errors[key] }}</span>
          </div>
          <div class="field">
            <label for="water-ph">pH</label>
            <input id="water-ph" v-model="form.ph" inputmode="decimal" placeholder="e.g. 7.2" :aria-invalid="submitted && !!parsed.errors.ph" />
            <span v-if="submitted && parsed.errors.ph" class="field-error">{{ parsed.errors.ph }}</span>
          </div>
        </div>
        <h3>Minerals</h3>
        <div class="figures">
          <div v-for="key in minerals" :key="key" class="field">
            <label :for="`water-${key}`">{{ WATER_FIGURE_LABELS[key].label }}</label>
            <input :id="`water-${key}`" v-model="form[key]" inputmode="decimal" :aria-invalid="submitted && !!parsed.errors[key]" />
            <span v-if="submitted && parsed.errors[key]" class="field-error">{{ parsed.errors[key] }}</span>
          </div>
        </div>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !parsed.values" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'water-profiles' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save water profile' : 'Add water profile' }}</button>
      </div>
    </form>
    <DeleteSection
      v-if="props.id && saved && workspaces.canEdit"
      kind="water"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'water-profiles' }"
    />
  </main>
</template>

<style scoped>
p,
h2,
h3 {
  margin: 0;
}
h2 {
  font-size: 1.1rem;
}
h3 {
  font-size: 1rem;
}
.small {
  font-size: 0.85rem;
}
.figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.figures input {
  width: 100%;
  min-width: 0;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

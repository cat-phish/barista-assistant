<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { brewLogsApi } from '../api/brews';
import { ApiError, errorMessage } from '../api/client';
import type { BrewLog, LlmAnalysis } from '../api/types';
import AnalysisCard from '../components/AnalysisCard.vue';
import { grindersApi } from '../api/grinders';
import type { Grinder } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import BrewFields from '../components/BrewFields.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import RatingStars from '../components/RatingStars.vue';
import { useAnalysis } from '../composables/useAnalysis';
import { draftFromLog, emptyDraft, parseBrewDraft } from '../lib/brewDraft';
import { formatGrams, formatRatio, formatTime, formatWhen } from '../lib/format';
import { canModifyBrewLog } from '../lib/permissions';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id: string }>();

const workspaces = useWorkspaceStore();
const auth = useAuthStore();
const router = useRouter();

const log = ref<BrewLog | null>(null);
const storedAnalysis = ref<LlmAnalysis | null>(null);
const grinders = ref<Grinder[]>([]);
const loading = ref(true);
const loadError = ref('');

const canModify = computed(() => !!log.value && canModifyBrewLog(log.value, workspaces.current?.role, auth.user?.id));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [{ brewLog }, g] = await Promise.all([brewLogsApi.get(ws, props.id), grindersApi.list(ws)]);
    grinders.value = g.grinders;
    const { latestAnalysis, ...rest } = brewLog;
    log.value = rest;
    storedAnalysis.value = latestAnalysis;
  } catch (err) {
    loadError.value = err instanceof ApiError && err.status === 404 ? 'This brew no longer exists.' : errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// AI analysis: newest of the stored one and any just requested.
const { analysis: freshAnalysis, state: aiState, error: aiError, request } = useAnalysis();
const analysis = computed(() => freshAnalysis.value ?? storedAnalysis.value);
function analyze(): void {
  const ws = workspaces.current?.id;
  if (ws && log.value) void request(ws, log.value.id, analysis.value);
}

// Edit
const editing = ref(false);
const draft = reactive(emptyDraft());
const parsed = computed(() => parseBrewDraft(draft));
const submitted = ref(false);
const saving = ref(false);
const saveError = ref('');

function startEdit(): void {
  if (!log.value) return;
  Object.assign(draft, draftFromLog(log.value));
  submitted.value = false;
  saveError.value = '';
  editing.value = true;
}

async function saveEdit(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const values = parsed.value.values;
  if (!ws || !log.value || !values) return;
  saving.value = true;
  saveError.value = '';
  try {
    log.value = (await brewLogsApi.update(ws, log.value.id, values)).brewLog;
    editing.value = false;
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

// Delete
const confirmingDelete = ref(false);
const deleting = ref(false);
const deleteError = ref('');
async function remove(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !log.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await brewLogsApi.remove(ws, log.value.id);
    await router.push({ name: 'journal' });
  } catch (err) {
    deleteError.value = errorMessage(err);
    deleting.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <RouterLink class="back" :to="{ name: 'journal' }">← Journal</RouterLink>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>

    <template v-else-if="log">
      <div class="page-header">
        <div>
          <h1>{{ log.bean.roasterName }} {{ log.bean.beanName }}</h1>
          <p class="muted">{{ formatWhen(log.timestamp) }}<template v-if="log.recipe"> · {{ log.recipe.name }}</template></p>
        </div>
      </div>

      <!-- Details -->
      <section v-if="!editing" class="card stack">
        <dl class="details">
          <div><dt>Dose → yield</dt><dd>{{ formatGrams(log.actualDoseGrams) }} g → {{ formatGrams(log.actualYieldGrams) }} g <span class="muted">({{ formatRatio(log.actualDoseGrams, log.actualYieldGrams) }})</span></dd></div>
          <div><dt>Time</dt><dd>{{ formatTime(log.actualTimeSec) }}</dd></div>
          <div><dt>Water</dt><dd>{{ log.actualTempC !== null ? `${log.actualTempC} °C` : '–' }}</dd></div>
          <div><dt>Grind</dt><dd>{{ log.actualGrindSetting ?? '–' }}<template v-if="log.grinder"> · {{ log.grinder.name }}</template></dd></div>
          <div><dt>Rating</dt><dd><RatingStars :rating="log.rating" /></dd></div>
          <div><dt>Brewed by</dt><dd>{{ log.brewer?.email ?? 'Deleted user' }}</dd></div>
        </dl>
        <div v-if="log.tastingNotes" class="notes">
          <h2>Tasting notes</h2>
          <p>{{ log.tastingNotes }}</p>
        </div>
        <div v-if="canModify" class="actions">
          <button class="btn-link" type="button" @click="startEdit">Edit</button>
          <button class="btn-link danger" type="button" @click="confirmingDelete = true">Delete</button>
        </div>
      </section>

      <!-- Edit -->
      <form v-else class="card stack" novalidate @submit.prevent="saveEdit">
        <h2>Edit brew</h2>
        <BrewFields v-model="draft" :errors="parsed.errors" :show-errors="submitted" :grinders="grinders" />
        <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
        <div class="buttons">
          <button class="btn btn-secondary" type="button" :disabled="saving" @click="editing = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
        </div>
      </form>

      <!-- AI analysis -->
      <section class="card stack">
        <h2>AI suggestion</h2>
        <AnalysisCard v-if="analysis" :analysis="analysis" />
        <p v-else-if="aiState !== 'waiting'" class="muted">Not analyzed yet.</p>
        <p v-if="aiState === 'waiting'" class="muted" aria-live="polite">Analyzing this brew… this usually takes a few seconds.</p>
        <p v-if="aiState === 'slow'" class="muted" aria-live="polite">Still working on it. Check back in a minute.</p>
        <p v-if="aiState === 'error'" class="form-error" role="alert">{{ aiError }}</p>
        <button
          v-if="workspaces.canEdit && aiState !== 'waiting'"
          class="btn btn-secondary"
          type="button"
          @click="analyze"
        >
          {{ analysis ? 'Analyze again' : 'Analyze this brew' }}
        </button>
      </section>
    </template>
  </main>

  <ConfirmDialog :open="confirmingDelete" title="Delete this brew?" @cancel="confirmingDelete = false">
    <p>This brew log and its AI suggestions will be permanently deleted.</p>
    <p v-if="deleteError" class="form-error" role="alert">{{ deleteError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="deleting" @click="remove">Delete brew</button>
      <button class="btn btn-secondary" type="button" :disabled="deleting" @click="confirmingDelete = false">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h1 {
  font-size: 1.4rem;
}
h2 {
  font-size: 1.05rem;
}
p {
  margin: 0;
}
.back {
  font-weight: 600;
  text-decoration: none;
  align-self: flex-start;
  min-height: var(--tap);
  display: inline-flex;
  align-items: center;
}
.details {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
  margin: 0;
}
.details dt {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-transform: uppercase;
}
.details dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.notes p {
  white-space: pre-wrap;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

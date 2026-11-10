<script setup lang="ts">
// A cold brew batch's stock and servings on its journal entry
// (docs/api/brew-servings.md §6c): what's left in the jar, Log a serving,
// the servings poured so far, and Batch finished / Reopen.
import { computed, onMounted, ref } from 'vue';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import { servingsApi, type BrewServingInput } from '../api/servings';
import type { BrewLog, BrewServing } from '../api/types';
import { jarGrams, jarRatio, overallRatio, stockLeft } from '../lib/batch';
import { formatGrams, formatWhen } from '../lib/format';
import { emptyServingDraft, ratioText, servingAmounts, servingDraftFrom, type ServingDraft } from '../lib/servingDraft';
import { useFlavorWheel } from '../composables/useFlavorWheel';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';
import ConfirmDialog from './ConfirmDialog.vue';
import RatingStars from './RatingStars.vue';
import ServingForm from './ServingForm.vue';

const props = defineProps<{
  log: BrewLog;
  canModifyBatch: boolean; // may edit the brew itself (to weigh its yield)
  yieldEstimate: number | null;
  startServing?: boolean; // open Log a serving straight away (from the Brew page's fridge card)
}>();
const emit = defineEmits<{ updated: [log: BrewLog] }>();

const workspaces = useWorkspaceStore();
const auth = useAuthStore();
const { wheel } = useFlavorWheel();
const flavorColor = (key: string) => wheel.value.node(key)?.color ?? 'var(--text-muted)';

const servings = ref<BrewServing[]>([]);
const loadError = ref('');
onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    servings.value = (await servingsApi.list(ws, props.log.id)).servings;
    if (props.startServing && canPour.value && !finished.value) startNew();
  } catch (err) {
    loadError.value = errorMessage(err);
  }
});

const finished = computed(() => props.log.batchFinishedAt !== null);
const yieldGrams = computed(() => props.log.actualYieldGrams ?? props.yieldEstimate);
const estimated = computed(() => props.log.actualYieldGrams === null);
const jar = computed(() => (yieldGrams.value === null ? null : jarGrams(yieldGrams.value, props.log.jarWaterGrams)));
const jarDilution = computed(() => (yieldGrams.value === null ? 0 : jarRatio(yieldGrams.value, props.log.jarWaterGrams)));
const poured = computed(() => props.log.pouredGrams);
const left = computed(() => (jar.value === null ? null : stockLeft(jar.value, poured.value)));
const approx = (g: number) => `${estimated.value ? '≈ ' : ''}${formatGrams(g)} g`;
const finishedDay = computed(() =>
  props.log.batchFinishedAt ? new Date(props.log.batchFinishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
);

const canPour = computed(() => workspaces.canEdit);
const mayChange = (s: BrewServing) => workspaces.current?.role === 'owner' || (workspaces.current?.role === 'barista' && !!auth.user && s.loggedBy?.id === auth.user.id);
const glassText = (s: BrewServing) => {
  const r = overallRatio(s.concentrateGrams, s.diluentGrams, jarDilution.value);
  return `${servingAmounts(s)} (${ratioText(r)})`;
};

// The form: a new serving (null id) or one being edited.
const form = ref<{ id: string | null; draft: ServingDraft } | null>(null);
const busy = ref(false);
const formError = ref('');
const actionError = ref('');
function startNew(): void {
  const draft = emptyServingDraft();
  if (props.log.dilutedWith) draft.dilutedWith = props.log.dilutedWith;
  form.value = { id: null, draft };
  formError.value = '';
}
function startEdit(s: BrewServing): void {
  form.value = { id: s.id, draft: servingDraftFrom(s) };
  formError.value = '';
}
const editingServing = computed(() => servings.value.find((s) => s.id === form.value?.id));

// The brew's counts, kept in step with the list without reloading it.
function emitCounts(list: BrewServing[], log: BrewLog = props.log): void {
  emit('updated', { ...log, servingCount: list.length, pouredGrams: Math.round(list.reduce((sum, s) => sum + s.concentrateGrams, 0) * 10) / 10 });
}

async function save(values: BrewServingInput, batchYieldGrams: number | null): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !form.value) return;
  busy.value = true;
  formError.value = '';
  try {
    let log = props.log;
    // An unweighed batch's yield goes on the brew first (docs/api/brew-logs.md §6).
    if (batchYieldGrams !== null) log = (await brewLogsApi.update(ws, log.id, { actualYieldGrams: batchYieldGrams })).brewLog;
    const id = form.value.id;
    const { serving } = id ? await servingsApi.update(ws, log.id, id, values) : await servingsApi.create(ws, log.id, values);
    const list = id ? servings.value.map((s) => (s.id === id ? serving : s)) : [...servings.value, serving];
    servings.value = list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    emitCounts(servings.value, { ...props.log, actualYieldGrams: log.actualYieldGrams });
    form.value = null;
  } catch (err) {
    formError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

// Deleting a serving: a plain confirm (nothing else uses it, CLAUDE.md rule 7).
const deletingServing = ref<BrewServing | null>(null);
async function remove(): Promise<void> {
  const ws = workspaces.current?.id;
  const s = deletingServing.value;
  if (!ws || !s) return;
  busy.value = true;
  actionError.value = '';
  try {
    await servingsApi.remove(ws, props.log.id, s.id);
    servings.value = servings.value.filter((x) => x.id !== s.id);
    emitCounts(servings.value);
    deletingServing.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

// Batch finished, or Reopen: no dialog, since Reopen undoes it.
async function setFinished(value: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  actionError.value = '';
  try {
    const { brewLog } = await servingsApi.finishBatch(ws, props.log.id, value);
    emit('updated', { ...props.log, batchFinishedAt: brewLog.batchFinishedAt });
    if (value) form.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card stack batch" aria-labelledby="batch-heading">
    <h2 id="batch-heading">The batch</h2>
    <p class="stock">
      <template v-if="yieldGrams !== null">Made {{ approx(yieldGrams) }}</template>
      <template v-if="log.jarWaterGrams"> · {{ formatGrams(log.jarWaterGrams) }} g water in the jar</template>
      · poured {{ formatGrams(poured) }} g
      <template v-if="finished"> · finished {{ finishedDay }}</template>
      <template v-else-if="left !== null"> · <strong>{{ approx(left) }} left</strong></template>
    </p>
    <p v-if="estimated && !canModifyBatch" class="muted small">The batch wasn't weighed, so what's left is estimated.</p>

    <ServingForm
      v-if="form"
      :key="form.id ?? 'new'"
      :initial="form.draft"
      :editing="form.id !== null"
      :served-ratio="log.dilutionRatio"
      :jar-ratio="jarDilution"
      :ask-yield="form.id === null && estimated && canModifyBatch"
      :yield-estimate="yieldEstimate"
      :saved-flavors="editingServing?.flavors"
      :busy="busy"
      :error="formError"
      @save="save"
      @cancel="form = null"
    />

    <p v-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
    <p v-else-if="servings.length === 0 && !form" class="muted">No servings yet.</p>
    <ul v-if="servings.length" class="servings">
      <li v-for="s in servings" :key="s.id" class="serving">
        <div class="serving-head">
          <span class="when">{{ formatWhen(s.timestamp) }}</span>
          <span v-if="s.loggedBy?.id !== auth.user?.id" class="muted small">{{ s.loggedBy?.email ?? 'Deleted user' }}</span>
        </div>
        <p>{{ glassText(s) }}</p>
        <RatingStars v-if="s.rating !== null" :rating="s.rating" />
        <ul v-if="s.flavors.length" class="flavor-chips">
          <li v-for="f in s.flavors" :key="f.key" class="badge"><span class="swatch" :style="{ background: flavorColor(f.key) }" aria-hidden="true" />{{ f.label }}</li>
        </ul>
        <p v-if="s.tastingNotes" class="notes">{{ s.tastingNotes }}</p>
        <div v-if="mayChange(s) && !form" class="row-actions">
          <button class="btn-link" type="button" @click="startEdit(s)">Edit</button>
          <button class="btn-link danger" type="button" @click="deletingServing = s">Delete</button>
        </div>
      </li>
    </ul>

    <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
    <div v-if="canPour && !form" class="actions">
      <template v-if="!finished">
        <button class="btn btn-primary" type="button" :disabled="busy" @click="startNew">Log a serving</button>
        <button class="btn-link" type="button" :disabled="busy" @click="setFinished(true)">Batch finished</button>
      </template>
      <button v-else class="btn-link" type="button" :disabled="busy" @click="setFinished(false)">Reopen</button>
    </div>
  </section>

  <ConfirmDialog :open="deletingServing !== null" title="Delete this serving?" @cancel="deletingServing = null">
    <p v-if="deletingServing">The serving poured {{ formatWhen(deletingServing.timestamp) }} ({{ servingAmounts(deletingServing) }}) will be deleted, and its coffee counted as still in the jar.</p>
    <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy" @click="remove">{{ busy ? 'Deleting…' : 'Delete serving' }}</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="deletingServing = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.05rem;
}
p {
  margin: 0;
}
.stock strong {
  color: var(--brand);
}
.servings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.serving {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border);
}
.serving-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.when {
  font-weight: 600;
}
.notes {
  white-space: pre-wrap;
}
.flavor-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.flavor-chips .badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 0.8rem;
}
.flavor-chips .swatch {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
}
.row-actions,
.actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-2);
}
.row-actions {
  margin: 0 calc(-1 * var(--space-2));
}
</style>

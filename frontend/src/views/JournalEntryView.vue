<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { brewLogsApi } from '../api/brews';
import { ApiError, errorMessage } from '../api/client';
import type { BrewLog, LlmAnalysis, Mark } from '../api/types';
import AnalysisCard from '../components/AnalysisCard.vue';
import { grindersApi } from '../api/grinders';
import type { Grinder, PrepTool, WaterProfile } from '../api/types';
import { waterProfilesApi } from '../api/waterProfiles';
import { prepToolsApi } from '../api/prepTools';
import AppHeader from '../components/AppHeader.vue';
import BrewFields from '../components/BrewFields.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import RatingStars from '../components/RatingStars.vue';
import { useAnalysis } from '../composables/useAnalysis';
import { draftFromLog, emptyDraft, parseBrewDraft } from '../lib/brewDraft';
import { extractionYield } from '../lib/extraction';
import { formatDoseLine, formatGrams, formatTime, formatWhen } from '../lib/format';
import { formatSize } from '../lib/servings';
import { formatTemp } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import { canModifyBrewLog } from '../lib/permissions';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';
import { formatMark } from '../lib/marks';

const props = defineProps<{ id: string }>();

const workspaces = useWorkspaceStore();
const auth = useAuthStore();
const { temperatureUnit } = usePreferences();
const router = useRouter();

const log = ref<BrewLog | null>(null);
const storedAnalysis = ref<LlmAnalysis | null>(null);
const grinders = ref<Grinder[]>([]);
const waterProfiles = ref<WaterProfile[]>([]);
const prepTools = ref<PrepTool[]>([]);
const loading = ref(true);
const loadError = ref('');

// "226 g (+6 vs ~220 expected)", or the expectation alone if not measured.
// Espresso compares the shot weight with the recipe's target.
// "1.38% · 20.2% extraction", or just the TDS when extraction can't be worked out.
function tdsText(l: BrewLog): string {
  if (l.tdsPercent === null) return '–';
  const ey = extractionYield({
    tdsPercent: l.tdsPercent,
    doseGrams: l.actualDoseGrams,
    yieldGrams: l.actualYieldGrams,
    waterGrams: l.actualWaterGrams,
    style: l.recipe?.style ?? null,
  });
  return ey === null ? `${l.tdsPercent}%` : `${l.tdsPercent}% · ${ey}% extraction`;
}

function yieldText(l: BrewLog): string {
  const expected = l.recipe?.expectedYieldGrams ?? null;
  const vs = l.recipe?.methodKind === 'espresso' ? (e: number) => `${formatGrams(e)} g target` : (e: number) => `~${formatGrams(e)} expected`;
  if (l.actualYieldGrams === null) return expected === null ? '–' : `Not measured (expected ~${formatGrams(expected)} g)`;
  if (expected === null) return `${formatGrams(l.actualYieldGrams)} g`;
  const diff = Math.round((l.actualYieldGrams - expected) * 10) / 10;
  return `${formatGrams(l.actualYieldGrams)} g (${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} vs ${vs(expected)})`;
}

const canModify = computed(() => !!log.value && canModifyBrewLog(log.value, workspaces.current?.role, auth.user?.id));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [{ brewLog }, g, w, t] = await Promise.all([
      brewLogsApi.get(ws, props.id),
      grindersApi.list(ws),
      waterProfilesApi.list(ws),
      prepToolsApi.list(ws),
    ]);
    prepTools.value = t.tools;
    grinders.value = g.grinders;
    waterProfiles.value = w.waterProfiles;
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
// The log's recipe kind decides water vs shot weight; a log without a recipe is a filter brew.
const espresso = computed(() => log.value?.recipe?.methodKind === 'espresso');
// A drink with ingredients is tasted twice: the brew (if tried on its own) and the drink.
const drinkTasting = computed(() => !!log.value?.drink?.hasIngredients);
const parsed = computed(() => parseBrewDraft(draft, log.value?.recipe?.methodKind ?? null, drinkTasting.value, temperatureUnit.value));
const submitted = ref(false);
const saving = ref(false);
const saveError = ref('');

function startEdit(): void {
  if (!log.value) return;
  Object.assign(draft, draftFromLog(log.value, temperatureUnit.value));
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
    // Espresso: the first drop is edited in the form; step times are kept.
    const marks = espresso.value
      ? [
          ...log.value.marks.filter((m) => m.kind === 'step_end'),
          ...(parsed.value.firstDropSec !== null ? [{ kind: 'first_drop' as const, stepOrder: null, atSec: parsed.value.firstDropSec }] : []),
        ]
      : undefined;
    log.value = (await brewLogsApi.update(ws, log.value.id, { ...values, ...(marks ? { marks } : {}) })).brewLog;
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
// "First drop" / "Step 2 ended" (the journal doesn't load the recipe's steps).
function markLabel(m: Mark): string {
  return m.kind === 'first_drop' ? 'First drop' : `Step ${m.stepOrder} ended`;
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
          <p class="muted">
            {{ formatWhen(log.timestamp) }}<template v-if="log.drink"> · {{ log.drink.name }}</template><template v-if="log.servingSize !== null && log.servingUnit"> · {{ formatSize({ size: log.servingSize, unit: log.servingUnit }) }}</template><template v-if="log.recipe"> · {{ log.recipe.name }}</template>
          </p>
        </div>
      </div>

      <!-- Details -->
      <section v-if="!editing" class="card stack">
        <dl class="details">
          <div><dt>{{ espresso ? 'Dose → shot' : 'Dose : water' }}</dt><dd>{{ formatDoseLine(log.actualDoseGrams, log.actualWaterGrams, log.actualYieldGrams) }}</dd></div>
          <div><dt>{{ espresso ? 'Shot weight' : 'Yield' }}</dt><dd>{{ yieldText(log) }}</dd></div>
          <div v-if="log.tdsPercent !== null"><dt>TDS</dt><dd>{{ tdsText(log) }}</dd></div>
          <div><dt>Time</dt><dd>{{ formatTime(log.actualTimeSec) }}</dd></div>
          <div><dt>Water</dt><dd>{{ log.actualTempC !== null ? formatTemp(log.actualTempC, temperatureUnit) : '–' }}</dd></div>
          <div><dt>Grind</dt><dd>{{ log.actualGrindSetting ?? '–' }}<template v-if="log.grinder"> · {{ log.grinder.name }}</template></dd></div>
          <div><dt>Brewer</dt><dd>{{ log.brewer?.name ?? '–' }}</dd></div>
          <div v-if="log.waterProfile"><dt>Water profile</dt><dd>{{ log.waterProfile.name }}</dd></div>
          <div v-if="log.tools.length"><dt>Prep</dt><dd>{{ log.tools.map((t) => t.name).join(' · ') }}</dd></div>
          <div v-for="m in log.marks" :key="`${m.kind}-${m.stepOrder}`"><dt>{{ markLabel(m) }}</dt><dd>{{ formatMark(m.atSec) }}</dd></div>
          <div><dt>{{ drinkTasting ? 'Brew rating' : 'Rating' }}</dt><dd><RatingStars :rating="log.rating" /></dd></div>
          <div v-if="drinkTasting"><dt>Drink rating</dt><dd><RatingStars :rating="log.drinkRating" /></dd></div>
          <div><dt>Brewed by</dt><dd>{{ log.brewedBy?.email ?? 'Deleted user' }}</dd></div>
        </dl>
        <div v-if="log.tastingNotes" class="notes">
          <h2>{{ drinkTasting ? 'The brew, tasted on its own' : 'Tasting notes' }}</h2>
          <p>{{ log.tastingNotes }}</p>
        </div>
        <div v-if="drinkTasting && log.drinkTastingNotes" class="notes">
          <h2>The drink</h2>
          <p>{{ log.drinkTastingNotes }}</p>
        </div>
        <div v-if="canModify" class="actions">
          <button class="btn-link" type="button" @click="startEdit">Edit</button>
          <button class="btn-link danger" type="button" @click="confirmingDelete = true">Delete</button>
        </div>
      </section>

      <!-- Edit -->
      <form v-else class="card stack" novalidate @submit.prevent="saveEdit">
        <h2>Edit brew</h2>
        <BrewFields v-model="draft" :errors="parsed.errors" :show-errors="submitted" :grinders="grinders" :water-profiles="waterProfiles" :prep-tools="prepTools" :method-kind="log.recipe?.methodKind ?? null" :expected-yield-grams="log.recipe?.expectedYieldGrams ?? null" :espresso="espresso" :drink-tasting="drinkTasting" :recipe-style="log.recipe?.style ?? null" />
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

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { analysisApi, brewLogsApi } from '../api/brews';
import { ApiError, errorMessage } from '../api/client';
import type { BrewLog, LlmAnalysis, Mark } from '../api/types';
import AiNoteField from '../components/AiNoteField.vue';
import AiRequestDialog from '../components/AiRequestDialog.vue';
import AnalysisCard from '../components/AnalysisCard.vue';
import { grindersApi } from '../api/grinders';
import type { BrewProblem, Grinder, PrepTool, WaterProfile } from '../api/types';
import { waterProfilesApi } from '../api/waterProfiles';
import { prepToolsApi } from '../api/prepTools';
import { brewProblemsApi } from '../api/brewProblems';
import AppHeader from '../components/AppHeader.vue';
import BrewFields from '../components/BrewFields.vue';
import FlavorWheel from '../components/FlavorWheel.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import RatingInput from '../components/RatingInput.vue';
import RatingStars from '../components/RatingStars.vue';
import { useAnalysis } from '../composables/useAnalysis';
import { formatClock } from '../lib/analysisStatus';
import { draftFromLog, emptyDraft, parseBrewDraft } from '../lib/brewDraft';
import { brewCaffeineMg, formatCaffeine } from '../lib/caffeine';
import { extractionYield } from '../lib/extraction';
import { grinderRetention } from '../lib/grinderRetention';
import { batchSuffix } from '../lib/beans';
import { formatDoseLine, formatGrams, formatGrind, formatTime, formatWhen, MAX_BREW_SEC } from '../lib/format';
import { formatFinishWindow } from '../lib/steps';
import { dilutionText, isColdStyle, STEEP_TEMPS, steepWindowText } from '../lib/coldBrew';
import { formatSize } from '../lib/servings';
import { formatTemp } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import { useFlavorWheel } from '../composables/useFlavorWheel';
import { canModifyBrewLog } from '../lib/permissions';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';
import { formatMark, heldSec } from '../lib/marks';

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
const problems = ref<BrewProblem[]>([]);
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
    style: l.recipe?.style?.brewsLike ?? null, // custom styles count as what they brew like
  });
  return ey === null ? `${l.tdsPercent}%` : `${l.tdsPercent}% · ${ey}% extraction`;
}

// "18.2 g in → 17.9 g out · 0.3 g retained (1.6%)", or whichever was weighed.
function grinderWeightsText(l: BrewLog): string {
  const parts = [l.beanWeightInGrams !== null ? `${formatGrams(l.beanWeightInGrams)} g in` : '', l.groundWeightOutGrams !== null ? `${formatGrams(l.groundWeightOutGrams)} g out` : ''];
  const r = grinderRetention(l.beanWeightInGrams, l.groundWeightOutGrams);
  return parts.filter(Boolean).join(' → ') + (r ? ` · ${r.grams} g retained (${r.percent}%)` : '');
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
    const [{ brewLog }, g, w, t, bp] = await Promise.all([
      brewLogsApi.get(ws, props.id),
      grindersApi.list(ws),
      waterProfilesApi.list(ws),
      prepToolsApi.list(ws),
      brewProblemsApi.list(ws).catch(() => ({ problems: [] })),
    ]);
    prepTools.value = t.tools;
    problems.value = bp.problems;
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
const { analysis: freshAnalysis, state: aiState, error: aiError, request, awaitAuto } = useAnalysis();
const analysis = computed(() => freshAnalysis.value ?? storedAnalysis.value);
// What analyzing would send, without analyzing (docs/api/analysis.md §8d).
const previewing = ref(false);
const loadPreview = async () => (log.value ? (await analysisApi.preview(log.value.id, aiNote.value.trim() || undefined)).request : null);
const aiNote = ref(''); // this time only (docs/api/auth.md §1c)

function analyze(): void {
  const ws = workspaces.current?.id;
  if (ws && log.value) void request(ws, log.value.id, analysis.value, aiNote.value.trim() || undefined);
}
// An automatic analysis on its way (auto-analyze, docs/api/analysis.md §8),
// e.g. queued by rating it here: show it when it lands.
watch(
  () => log.value?.analysisDueAt,
  (due) => {
    const ws = workspaces.current?.id;
    if (ws && log.value && due && aiState.value !== 'waiting') awaitAuto(ws, log.value.id, analysis.value, due);
  },
  { immediate: true },
);
const aiButtonLabel = computed(() => {
  if (aiState.value === 'queued') return 'Analyze now';
  if (log.value?.analysisError && aiState.value === 'idle') return 'Try again';
  return analysis.value ? 'Analyze again' : 'Analyze this brew';
});

// Edit
const editing = ref(false);
const draft = reactive(emptyDraft());
// The log's recipe kind decides water vs shot weight; a log without a recipe is a filter brew.
const espresso = computed(() => log.value?.recipe?.methodKind === 'espresso');
// A drink with ingredients is tasted twice: the brew (if tried on its own) and the drink.
const drinkTasting = computed(() => !!log.value?.drink?.hasIngredients);
const parsed = computed(() =>
  parseBrewDraft(draft, log.value?.recipe?.methodKind ?? null, drinkTasting.value, temperatureUnit.value, grinders.value.find((g) => g.id === draft.grinderId) ?? null),
);
const submitted = ref(false);
const saving = ref(false);
const saveError = ref('');

// The windows the brew aimed for, set when it started ("12–18 h", "10:00–12:00").
const steepWindow = computed(() => steepWindowText(log.value?.steepMinHours ?? null, log.value?.steepMaxHours ?? null));
const finishWindow = computed(() => formatFinishWindow(log.value?.expectedFinishMinSec ?? null, log.value?.expectedFinishMaxSec ?? null));
// A long cold brew still steeping is finished through the edit form: the
// steep time so far is filled in, and saving marks it finished.
const finishing = ref(false);
function startFinish(): void {
  if (!log.value) return;
  startEdit();
  draft.time = formatTime(Math.min(MAX_BREW_SEC, Math.max(0, Math.round((Date.now() - new Date(log.value.timestamp).getTime()) / 1000))));
  finishing.value = true;
}
function startEdit(): void {
  if (!log.value) return;
  finishing.value = false;
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
    // Espresso: the first drop is edited in the form; step times and holds are kept.
    const marks = espresso.value
      ? [
          ...log.value.marks.filter((m) => m.kind !== 'first_drop'),
          ...(parsed.value.firstDropSec !== null ? [{ kind: 'first_drop' as const, stepOrder: null, atSec: parsed.value.firstDropSec }] : []),
        ]
      : undefined;
    log.value = (await brewLogsApi.update(ws, log.value.id, { ...values, ...(marks ? { marks } : {}), ...(finishing.value ? { steeping: false } : {}) })).brewLog;
    editing.value = false;
    finishing.value = false;
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

// Quick rating (docs/api/notifications.md §1b): a brew saved without a rating
// (e.g. "Save, rate later", whose reminder links here) is rated in place.
// The AI suggestion waits for it, then is offered.
const unrated = computed(() => !!log.value && !log.value.steeping && log.value.rating === null && log.value.drinkRating === null);
const quick = reactive({ rating: null as number | null, flavors: [] as string[], notes: '', drinkRating: null as number | null, drinkNotes: '' });
// The wheel starts from any flavors already picked (Settings → Fields can hide it).
const { show } = useFieldVisibility();
// Chips in the workspace's wheel colours (grey for a flavor it no longer has).
const { wheel } = useFlavorWheel();
const flavorColor = (key: string) => wheel.value.node(key)?.color ?? 'var(--text-muted)';
watch(
  () => log.value?.id,
  () => (quick.flavors = (log.value?.flavors ?? []).map((f) => f.key)),
);
const rating = ref(false);
const rateError = ref('');
const justRated = ref(false);
async function saveRating(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !log.value) return;
  rating.value = true;
  rateError.value = '';
  try {
    log.value = (
      await brewLogsApi.update(ws, log.value.id, {
        rating: quick.rating,
        flavors: quick.flavors,
        tastingNotes: quick.notes.trim() || log.value.tastingNotes,
        ...(drinkTasting.value ? { drinkRating: quick.drinkRating, drinkTastingNotes: quick.drinkNotes.trim() || log.value.drinkTastingNotes } : {}),
      })
    ).brewLog;
    justRated.value = true;
  } catch (err) {
    rateError.value = errorMessage(err);
  } finally {
    rating.value = false;
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
// "First drop 0:07.4" / "Step 2 ended 0:52.0" / "Step 3 held 0:12" (the
// journal doesn't load the recipe's steps); a step's holds as one total, at
// its first.
const markRows = computed(() => {
  const l = log.value;
  if (!l) return [];
  return l.marks.flatMap((m: Mark) => {
    const key = `${m.kind}-${m.stepOrder}-${m.atSec}`;
    if (m.kind === 'first_drop') return [{ key, label: 'First drop', value: formatMark(m.atSec) }];
    if (m.kind === 'step_end') return [{ key, label: `Step ${m.stepOrder} ended`, value: formatMark(m.atSec) }];
    if (m.kind === 'step_hold' && m === l.marks.find((h) => h.kind === 'step_hold' && h.stepOrder === m.stepOrder)) {
      return [{ key, label: `Step ${m.stepOrder} held`, value: formatTime(Math.floor(heldSec(l.marks, m.stepOrder ?? 0, l.actualTimeSec))) }];
    }
    return [];
  });
});
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
          <h1>{{ log.bean.roasterName }} {{ log.bean.beanName }}{{ batchSuffix(log.bean) }}</h1>
          <p class="muted">
            {{ formatWhen(log.timestamp) }}<template v-if="log.drink"> · {{ log.drink.name }}</template><template v-if="log.servingSize !== null && log.servingUnit"> · {{ formatSize({ size: log.servingSize, unit: log.servingUnit }) }}</template><template v-if="log.recipe"> · {{ log.recipe.name }}</template>
          </p>
          <p v-if="log.steeping" class="steeping-note">
            Steeping since {{ formatWhen(log.timestamp) }}<template v-if="log.steepTemp"> ({{ STEEP_TEMPS[log.steepTemp].toLowerCase() }})</template>.
            <template v-if="steepWindow"> Steep for {{ steepWindow }}.</template> Tap Finish when it's done.
          </p>
        </div>
      </div>

      <!-- Quick rating for a brew saved without one -->
      <form v-if="!editing && unrated && canModify" class="card stack quick-rate" novalidate @submit.prevent="saveRating">
        <h2>Rate this brew</h2>
        <fieldset v-if="drinkTasting" class="tasting">
          <legend>The brew <span class="muted">(if you tasted it on its own)</span></legend>
          <RatingInput v-model="quick.rating" name="quick-rating" label="Brew rating" />
          <FlavorWheel v-if="show('brew.flavors') || quick.flavors.length" v-model="quick.flavors" :saved="log.flavors" label="Brew flavors" />
          <div class="field">
            <label for="quick-notes">Brew notes</label>
            <textarea id="quick-notes" v-model="quick.notes" rows="2" maxlength="5000" />
          </div>
        </fieldset>
        <template v-else>
          <RatingInput v-model="quick.rating" name="quick-rating" label="Rating" />
          <FlavorWheel v-if="show('brew.flavors') || quick.flavors.length" v-model="quick.flavors" :saved="log.flavors" />
          <div class="field">
            <label for="quick-notes">Tasting notes</label>
            <textarea id="quick-notes" v-model="quick.notes" rows="3" maxlength="5000" placeholder="e.g. Sweet, round, a bit flat at the end" />
          </div>
        </template>
        <fieldset v-if="drinkTasting" class="tasting">
          <legend>The drink</legend>
          <RatingInput v-model="quick.drinkRating" name="quick-drink-rating" label="Drink rating" />
          <div class="field">
            <label for="quick-drink-notes">Drink notes</label>
            <textarea id="quick-drink-notes" v-model="quick.drinkNotes" rows="2" maxlength="5000" />
          </div>
        </fieldset>
        <p v-if="rateError" class="form-error" role="alert">{{ rateError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="rating || (quick.rating === null && quick.drinkRating === null)">
          {{ rating ? 'Saving…' : 'Save rating' }}
        </button>
      </form>
      <section v-else-if="justRated && !analysis && workspaces.canEdit" class="card stack">
        <p v-if="log.analysisDueAt">Rated, thanks. Your AI suggestion for next time is on its way.</p>
        <template v-else>
          <p>Rated, thanks. Want an AI suggestion for next time?</p>
          <button v-if="aiState !== 'waiting'" class="btn btn-primary" type="button" @click="analyze(); justRated = false">Get AI suggestion</button>
        </template>
      </section>

      <!-- Details -->
      <section v-if="!editing" class="card stack">
        <dl class="details">
          <div><dt>{{ espresso ? 'Dose → shot' : log.actualIceGrams !== null ? 'Dose : water + ice' : 'Dose : water' }}</dt><dd>{{ formatDoseLine(log.actualDoseGrams, log.actualWaterGrams, log.actualYieldGrams, log.actualIceGrams) }}</dd></div>
          <div><dt>{{ espresso ? 'Shot weight' : 'Yield' }}</dt><dd>{{ yieldText(log) }}</dd></div>
          <div v-if="log.tdsPercent !== null"><dt>{{ log.dilutionRatio !== null && !isColdStyle(log.recipe?.style?.brewsLike) ? 'Concentrate TDS' : 'TDS' }}</dt><dd>{{ tdsText(log) }}</dd></div>
          <div v-if="!log.steeping"><dt>Caffeine</dt><dd>{{ formatCaffeine(brewCaffeineMg({ doseGrams: log.actualDoseGrams, waterGrams: log.actualWaterGrams }, log.bean)) }}</dd></div>
          <div v-if="log.steepTemp"><dt>Steeped in</dt><dd>{{ STEEP_TEMPS[log.steepTemp] }}</dd></div>
          <div v-if="log.dilutionRatio !== null"><dt>Served</dt><dd>Diluted {{ dilutionText(log.dilutionRatio, log.dilutedWith) }}</dd></div>
          <div><dt>Time</dt><dd>{{ formatTime(log.actualTimeSec) }}<template v-if="steepWindow && !log.steeping"> (steep for {{ steepWindow }})</template><template v-else-if="finishWindow"> (target {{ finishWindow }})</template></dd></div>
          <div><dt>Water</dt><dd>{{ log.actualTempC !== null ? formatTemp(log.actualTempC, temperatureUnit) : '–' }}</dd></div>
          <div><dt>Grind</dt><dd>{{ log.actualGrindSetting !== null ? formatGrind(log.actualGrindSetting) : '–' }}<template v-if="log.grindRpm !== null"> at {{ log.grindRpm }} RPM</template><template v-if="log.grinder"> · {{ log.grinder.name }}</template></dd></div>
          <div v-if="log.beanWeightInGrams !== null || log.groundWeightOutGrams !== null"><dt>Grinder weights</dt><dd>{{ grinderWeightsText(log) }}</dd></div>
          <div><dt>Brewer</dt><dd>{{ log.brewer?.name ?? '–' }}</dd></div>
          <div v-if="log.waterProfile"><dt>Water profile</dt><dd>{{ log.waterProfile.name }}</dd></div>
          <div v-if="log.tools.length"><dt>Prep</dt><dd>{{ log.tools.map((t) => t.name).join(' · ') }}</dd></div>
          <div v-if="log.problems.length"><dt>Problems</dt><dd>{{ log.problems.map((p) => p.name).join(' · ') }}</dd></div>
          <div v-for="row in markRows" :key="row.key"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
          <div><dt>{{ drinkTasting ? 'Brew rating' : 'Rating' }}</dt><dd><RatingStars :rating="log.rating" /></dd></div>
          <div v-if="drinkTasting"><dt>Drink rating</dt><dd><RatingStars :rating="log.drinkRating" /></dd></div>
          <div v-if="log.flavors.length">
            <dt>{{ drinkTasting ? 'Brew flavors' : 'Flavors' }}</dt>
            <dd>
              <ul class="flavor-chips">
                <li v-for="f in log.flavors" :key="f.key" class="badge" :title="wheel.place(f.key) || undefined">
                  <span class="swatch" :style="{ background: flavorColor(f.key) }" aria-hidden="true" />{{ f.label }}
                </li>
              </ul>
            </dd>
          </div>
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
        <div v-if="workspaces.canEdit" class="actions">
          <button v-if="log.steeping && canModify" class="btn btn-primary" type="button" @click="startFinish">Finish</button>
          <RouterLink class="btn-link" :to="{ name: 'brew', query: { repeat: log.id } }">Brew again</RouterLink>
          <template v-if="canModify">
            <button class="btn-link" type="button" @click="startEdit">Edit</button>
            <button class="btn-link danger" type="button" @click="confirmingDelete = true">Delete</button>
          </template>
        </div>
      </section>

      <!-- Edit -->
      <form v-else class="card stack" novalidate @submit.prevent="saveEdit">
        <h2>Edit brew</h2>
        <BrewFields v-model="draft" :errors="parsed.errors" :show-errors="submitted" :grinders="grinders" :water-profiles="waterProfiles" :prep-tools="prepTools" :problems="problems" :method-kind="log.recipe?.methodKind ?? null" :brewer-id="log.brewer?.id ?? null" :expected-yield-grams="log.recipe?.expectedYieldGrams ?? null" :espresso="espresso" :drink-tasting="drinkTasting" :recipe-style="log.recipe?.style?.brewsLike ?? null" :iced="log.actualIceGrams !== null" :saved-flavors="log.flavors" />
        <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
        <div class="buttons">
          <button class="btn btn-secondary" type="button" :disabled="saving" @click="editing = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : finishing ? 'Finish brew' : 'Save changes' }}</button>
        </div>
      </form>

      <!-- AI analysis -->
      <section class="card stack">
        <h2>AI suggestion</h2>
        <AnalysisCard v-if="analysis" :analysis="analysis" :can-rate="workspaces.canEdit" />
        <p v-else-if="aiState !== 'waiting' && aiState !== 'queued'" class="muted">Not analyzed yet.</p>
        <p v-if="aiState === 'queued' && log.analysisDueAt" class="muted" aria-live="polite">
          An automatic suggestion is on its way at {{ formatClock(log.analysisDueAt) }}.
        </p>
        <p v-if="aiState === 'idle' && log.analysisError" class="form-error" role="alert">{{ log.analysisError }}</p>
        <p v-if="aiState === 'waiting'" class="muted" aria-live="polite">Analyzing this brew… this usually takes a few seconds.</p>
        <p v-if="aiState === 'slow'" class="muted" aria-live="polite">Still working on it. Check back in a minute.</p>
        <p v-if="aiState === 'error'" class="form-error" role="alert">{{ aiError }}</p>
        <p v-if="log.steeping" class="muted small">Still steeping: finish it first.</p>
        <p v-else-if="unrated && !analysis" class="muted small">Rate the brew first: the suggestion works from how it tasted.</p>
        <AiNoteField v-if="workspaces.canEdit && aiState !== 'waiting' && !unrated && !log.steeping" id="analysis-note" v-model="aiNote" />
        <button
          v-if="workspaces.canEdit && aiState !== 'waiting' && !unrated && !log.steeping"
          class="btn btn-secondary"
          type="button"
          @click="analyze"
        >
          {{ aiButtonLabel }}
        </button>
        <button
          v-if="workspaces.canEdit && aiState !== 'waiting' && !unrated && !log.steeping"
          class="btn-link small preview-link"
          type="button"
          @click="previewing = true"
        >
          Preview what's sent
        </button>
        <AiRequestDialog :open="previewing" :load="loadPreview" preview @close="previewing = false" />
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
.preview-link {
  align-self: flex-start;
}
.steeping-note {
  margin: var(--space-1) 0 0;
  color: var(--brand);
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
.quick-rate h2 {
  font-size: 1.15rem;
  margin: 0;
}
.quick-rate .tasting {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
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

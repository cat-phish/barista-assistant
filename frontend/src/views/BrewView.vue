<script setup lang="ts">
// The brew flow: set up (bean, recipe, AI starting point) -> timer -> log -> saved
// (+ optional AI suggestion for next time). docs/api_spec.md §6/§8,
// docs/timer_architecture.md.
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { beansApi } from '../api/beans';
import { brewLogsApi, suggestionsApi } from '../api/brews';
import { ApiError, errorMessage } from '../api/client';
import { recipesApi } from '../api/recipes';
import type { Bean, Recipe } from '../api/types';
import AnalysisCard from '../components/AnalysisCard.vue';
import { grindersApi } from '../api/grinders';
import type { Grinder } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import BrewFields from '../components/BrewFields.vue';
import PourOverTimer from '../components/PourOverTimer.vue';
import { useAnalysis } from '../composables/useAnalysis';
import { emptyDraft, parseBrewDraft } from '../lib/brewDraft';
import { formatDay, formatGrams, formatRatio, formatTime } from '../lib/format';
import { chooseGrind, startingParameters, suggestionFitsGrinder, type GrindSource, type StartingParameters } from '../lib/suggest';
import { useWorkspaceStore } from '../stores/workspace';

type Stage = 'setup' | 'timing' | 'log' | 'saved';

const workspaces = useWorkspaceStore();
const stage = ref<Stage>('setup');
const loading = ref(true);
const loadError = ref('');
const beans = ref<Bean[]>([]);
const recipes = ref<Recipe[]>([]);
const grinders = ref<Grinder[]>([]);

// Setup
const beanId = ref('');
const recipeId = ref('');
const bean = computed(() => beans.value.find((b) => b.id === beanId.value) ?? null);
const recipe = computed(() => recipes.value.find((r) => r.id === recipeId.value) ?? null);
const suggestion = ref<StartingParameters | null>(null);
const suggestionState = ref<'idle' | 'loading' | 'none' | 'error'>('idle');

// Brew details: pre-filled from the recipe / suggestion, edited in the log form.
const draft = reactive(emptyDraft());
const parsed = computed(() => parseBrewDraft(draft));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, r, g] = await Promise.all([beansApi.list(ws), recipesApi.list(ws), grindersApi.list(ws)]);
    beans.value = b.beans;
    recipes.value = r.recipes;
    grinders.value = g.grinders;
    if (beans.value.length === 1) beanId.value = beans.value[0]?.id ?? '';
    const saved = readSavedGrinder();
    if (saved && activeGrinders.value.some((x) => x.id === saved)) draft.grinderId = saved;
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

// Recipe targets are the default starting point. Recipes are grinder-neutral,
// so their grind target is only a placeholder; the grind comes from chooseGrind.
watch(recipe, (r) => {
  draft.dose = r ? formatGrams(r.targetDoseGrams) : '';
  draft.water = r ? formatGrams(r.targetWaterGrams) : '';
  draft.yieldGrams = ''; // measured after brewing
  draft.temp = r?.targetTempC != null ? String(r.targetTempC) : '';
  if (suggestion.value) applySuggestion(suggestion.value);
});

// Grinders: pick from active ones, add inline, remember the last one per workspace.
const NEW_GRINDER = '__new__';
const activeGrinders = computed(() => grinders.value.filter((x) => !x.retiredAt));
const grinder = computed(() => grinders.value.find((x) => x.id === draft.grinderId) ?? null);
const grinderKey = () => `brewlog.grinderId.${workspaces.current?.id ?? ''}`;
function readSavedGrinder(): string | null {
  try {
    return localStorage.getItem(grinderKey());
  } catch {
    return null;
  }
}
function saveGrinder(id: string): void {
  try {
    if (id) localStorage.setItem(grinderKey(), id);
  } catch {
    // Not remembering is fine.
  }
}

const newGrinderName = ref('');
const addingGrinder = ref(false);
const grinderError = ref('');
const newGrinderInput = ref<HTMLInputElement | null>(null);
async function onGrinderChange(): Promise<void> {
  if (draft.grinderId !== NEW_GRINDER) return;
  grinderError.value = '';
  await nextTick();
  newGrinderInput.value?.focus();
}
async function addGrinder(): Promise<void> {
  const ws = workspaces.current?.id;
  const name = newGrinderName.value.trim();
  if (!ws || !name) return;
  addingGrinder.value = true;
  grinderError.value = '';
  try {
    const { grinder: created } = await grindersApi.create(ws, name);
    grinders.value = [...grinders.value, created].sort((a, b) => a.name.localeCompare(b.name));
    draft.grinderId = created.id;
    newGrinderName.value = '';
  } catch (err) {
    grinderError.value =
      err instanceof ApiError && err.status === 409 ? 'That grinder already exists. Pick it from the list.' : errorMessage(err);
  } finally {
    addingGrinder.value = false;
  }
}

// Grind pre-fill: last setting for this grinder + recipe, else the suggestion's
// (same grinder only), else empty. Re-run whenever recipe or grinder changes.
const lastSetting = ref<{ grindSetting: string; timestamp: string } | null>(null);
const grindSource = ref<GrindSource>('none');
let grindRequest = 0;
async function refreshGrind(): Promise<void> {
  const ws = workspaces.current?.id;
  const request = ++grindRequest; // ignore answers to superseded choices
  const grinderId = draft.grinderId === NEW_GRINDER ? '' : draft.grinderId;
  let last: { grindSetting: string; timestamp: string } | null = null;
  if (ws && grinderId && recipeId.value) {
    try {
      last = (await grindersApi.lastSetting(ws, grinderId, recipeId.value)).lastSetting;
    } catch {
      last = null; // pre-fill is a convenience; fall through
    }
  }
  if (request !== grindRequest) return;
  lastSetting.value = last;
  const choice = chooseGrind({ lastSetting: last?.grindSetting ?? null, suggestion: suggestion.value, grinderId, recipe: recipe.value });
  draft.grind = choice.value;
  grindSource.value = choice.source;
}
watch([recipeId, () => draft.grinderId], () => {
  if (draft.grinderId !== NEW_GRINDER) void refreshGrind();
});
const grindPlaceholder = computed(() =>
  'e.g. 20',
);
const suggestionGrinderMismatch = computed(
  () => !!suggestion.value && !suggestionFitsGrinder(suggestion.value, draft.grinderId === NEW_GRINDER ? '' : draft.grinderId),
);
watch(beanId, () => {
  suggestion.value = null;
  suggestionState.value = 'idle';
});

async function suggest(): Promise<void> {
  if (!bean.value) return;
  suggestionState.value = 'loading';
  try {
    const params = startingParameters(await suggestionsApi.forBean(bean.value.id), recipe.value);
    suggestion.value = params;
    suggestionState.value = params ? 'idle' : 'none';
    if (params) applySuggestion(params);
  } catch {
    suggestionState.value = 'error';
  }
}

function applySuggestion(p: StartingParameters): void {
  if (p.tempC !== null) draft.temp = String(p.tempC);
  void refreshGrind(); // the suggestion may now supply the grind
}

const timerSteps = computed(() => recipe.value?.steps ?? []);
const timerDose = computed(() => parsed.value.values?.actualDoseGrams ?? recipe.value?.targetDoseGrams ?? 0);

// An unfinished "add a new grinder" counts as no grinder once setup is done.
function leaveSetup(next: Stage): void {
  if (draft.grinderId === NEW_GRINDER) draft.grinderId = '';
  stage.value = next;
}
function logWithoutTimer(): void {
  draft.time = '';
  leaveSetup('log');
}
function onTimerComplete(seconds: number): void {
  draft.time = formatTime(seconds);
  stage.value = 'log';
}

// Leaving mid-brew loses the timing.
onBeforeRouteLeave(() => stage.value !== 'timing' || window.confirm('Leave the brew in progress? The timer will be lost.'));

// Log form
const saving = ref(false);
const saveError = ref('');
const submitted = ref(false);
const savedLogId = ref<string | null>(null);

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const values = parsed.value.values;
  if (!ws || !bean.value || !values) return;
  saving.value = true;
  saveError.value = '';
  try {
    const { brewLog } = await brewLogsApi.create(ws, { beanId: bean.value.id, recipeId: recipe.value?.id ?? null, ...values });
    if (values.grinderId) saveGrinder(values.grinderId);
    savedLogId.value = brewLog.id;
    stage.value = 'saved';
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

// AI suggestion for next time
const { analysis, state: aiState, error: aiError, request: requestAi, reset: resetAi } = useAnalysis();
function requestAnalysis(): void {
  const ws = workspaces.current?.id;
  if (ws && savedLogId.value) void requestAi(ws, savedLogId.value, null);
}

function brewAgain(): void {
  resetAi();
  stage.value = 'setup';
  savedLogId.value = null;
  draft.rating = null;
  draft.notes = '';
  submitted.value = false;
  suggestion.value = null;
  suggestionState.value = 'idle';
  void refreshGrind(); // the brew just saved is now the "last setting"
}

const beanLabel = computed(() => (bean.value ? `${bean.value.roasterName} ${bean.value.beanName}` : ''));
</script>

<template>
  <AppHeader />
  <main class="page">
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>

    <div v-else-if="beans.length === 0" class="card empty">
      <p>Add a bean first, then come back to brew.</p>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'bean-new' }">Add bean</RouterLink>
    </div>

    <p v-else-if="!workspaces.canEdit" class="card muted">Viewers can't log brews. Ask an owner to make you a barista.</p>

    <!-- 1. Setup -->
    <template v-else-if="stage === 'setup'">
      <h1>New brew</h1>
      <section class="card stack">
        <div class="field">
          <label for="bean">Bean</label>
          <select id="bean" v-model="beanId">
            <option value="" disabled>Choose a bean…</option>
            <option v-for="b in beans" :key="b.id" :value="b.id">{{ b.roasterName }} – {{ b.beanName }}</option>
          </select>
        </div>
        <div class="field">
          <label for="recipe">Recipe <span class="muted">(optional)</span></label>
          <select id="recipe" v-model="recipeId">
            <option value="">No recipe</option>
            <option v-for="r in recipes" :key="r.id" :value="r.id">{{ r.name }} ({{ r.method.name }})</option>
          </select>
        </div>
        <div class="field">
          <label for="grinder">
            Grinder <span class="muted">(optional)</span>
            <RouterLink class="manage" :to="{ name: 'grinders' }">Manage</RouterLink>
          </label>
          <select id="grinder" v-model="draft.grinderId" @change="onGrinderChange">
            <option value="">No grinder</option>
            <option v-for="g in activeGrinders" :key="g.id" :value="g.id">{{ g.name }}</option>
            <option v-if="workspaces.canEdit" :value="NEW_GRINDER">+ Add a new grinder…</option>
          </select>
        </div>
        <div v-if="draft.grinderId === NEW_GRINDER" class="new-grinder">
          <div class="field grow">
            <label for="new-grinder">New grinder name</label>
            <input id="new-grinder" ref="newGrinderInput" v-model="newGrinderName" maxlength="100" placeholder="e.g. Comandante C40" @keydown.enter.prevent="addGrinder" />
          </div>
          <button class="btn btn-secondary" type="button" :disabled="addingGrinder || !newGrinderName.trim()" @click="addGrinder">Add</button>
          <span v-if="grinderError" class="field-error full">{{ grinderError }}</span>
        </div>
        <p v-if="recipe" class="muted recipe-summary">
          {{ formatGrams(recipe.targetDoseGrams) }} g : {{ formatGrams(recipe.targetWaterGrams) }} g ({{ formatRatio(recipe.targetDoseGrams, recipe.targetWaterGrams) }})
          <template v-if="recipe.targetTempC !== null"> · {{ recipe.targetTempC }} °C</template>
          <template v-if="recipe.steps.length"> · {{ recipe.steps.length }} steps</template>
        </p>
      </section>

      <section v-if="bean" class="card stack">
        <div class="suggest-head">
          <h2>Starting point</h2>
          <button class="btn btn-secondary" type="button" :disabled="suggestionState === 'loading'" @click="suggest">
            {{ suggestionState === 'loading' ? 'Loading…' : 'Suggest parameters' }}
          </button>
        </div>
        <p v-if="suggestionState === 'none'" class="muted">
          No AI analysis for this bean yet. Brew, then ask for a suggestion after saving.
        </p>
        <p v-else-if="suggestionState === 'error'" class="form-error">Couldn't load suggestions. Try again.</p>
        <template v-else-if="suggestion">
          <p class="reasoning">“{{ suggestion.reasoning }}”</p>
          <ul class="advice">
            <li>
              <strong>{{ suggestion.grindAdvice }}</strong><template v-if="suggestion.grindBase"> than {{ suggestion.grindBase }}</template><template v-if="suggestion.grinder"> ({{ suggestion.grinder.name }})</template>
            </li>
            <li><strong>{{ suggestion.tempAdvice }}</strong><template v-if="suggestion.tempC !== null"> → {{ suggestion.tempC }} °C</template></li>
          </ul>
          <p v-if="suggestionGrinderMismatch" class="note small">
            That brew was on {{ suggestion.grinder?.name ?? 'no recorded grinder' }}, so its grind setting isn't copied. Adjust for {{ grinder?.name ?? 'your grinder' }}.
          </p>
          <p class="muted small">
            Based on your brew from {{ formatDay(suggestion.basedOn.timestamp) }}<template v-if="!suggestion.basedOn.isLatestBrew"> (you've brewed since then)</template>.
          </p>
        </template>
        <div class="form-row">
          <div class="field">
            <label for="setup-temp">Water temp (°C)</label>
            <input id="setup-temp" v-model="draft.temp" inputmode="decimal" placeholder="e.g. 94" />
          </div>
          <div class="field">
            <label for="setup-grind">Grind setting</label>
            <input id="setup-grind" v-model="draft.grind" maxlength="100" :placeholder="grindPlaceholder" @input="grindSource = 'none'" />
          </div>
        </div>
        <p v-if="grindSource === 'last' && lastSetting" class="muted small grind-hint">
          Last time with {{ grinder?.name }} on {{ recipe?.name }}: {{ lastSetting.grindSetting }} ({{ formatDay(lastSetting.timestamp) }})
        </p>
        <p v-else-if="grindSource === 'suggestion'" class="muted small grind-hint">Grind from the analyzed brew; adjust as suggested.</p>
        <p v-else-if="grindSource === 'recipe'" class="muted small grind-hint">
          The recipe's approximate starting point for {{ grinder?.name }}. Adjust to taste; next time your own setting is used.
        </p>
      </section>

      <div class="stack">
        <button class="btn btn-primary btn-block" type="button" :disabled="!bean" @click="leaveSetup('timing')">
          {{ timerSteps.length ? 'Start timer' : 'Start stopwatch' }}
        </button>
        <button class="btn btn-secondary btn-block" type="button" :disabled="!bean" @click="logWithoutTimer">
          Log a brew without the timer
        </button>
      </div>
    </template>

    <!-- 2. Timer -->
    <template v-else-if="stage === 'timing'">
      <button class="btn-link cancel" type="button" @click="stage = 'setup'">← Cancel brew</button>
      <PourOverTimer
        :recipe-name="recipe?.name ?? 'Brew'"
        :bean-name="beanLabel"
        :target-dose="timerDose"
        :expected-finish-min-sec="recipe?.expectedFinishMinSec ?? null"
        :expected-finish-max-sec="recipe?.expectedFinishMaxSec ?? null"
        :steps="timerSteps"
        @complete="onTimerComplete"
      />
    </template>

    <!-- 3. Log -->
    <form v-else-if="stage === 'log'" class="stack" novalidate @submit.prevent="save">
      <h1>How was it?</h1>
      <p class="muted">{{ beanLabel }}<template v-if="recipe"> · {{ recipe.name }}</template></p>
      <section class="card">
        <BrewFields v-model="draft" :errors="parsed.errors" :show-errors="submitted" :grinders="grinders" :expected-yield-grams="recipe?.expectedYieldGrams ?? null" />
      </section>
      <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
      <button class="btn btn-primary btn-block" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save brew' }}</button>
    </form>

    <!-- 4. Saved -->
    <template v-else>
      <section class="card stack saved">
        <h1>Brew saved ✓</h1>
        <p class="muted">Want a suggestion for your next brew of {{ beanLabel }}?</p>
        <button v-if="aiState === 'idle' || aiState === 'error'" class="btn btn-primary" type="button" @click="requestAnalysis">
          Get AI suggestion
        </button>
        <p v-if="aiState === 'error'" class="form-error" role="alert">{{ aiError }}</p>
        <p v-if="aiState === 'waiting'" class="muted" aria-live="polite">Analyzing your brew… this usually takes a few seconds.</p>
        <p v-if="aiState === 'slow'" class="muted" aria-live="polite">
          Still working on it. It'll show up in the journal, and next time you tap “Suggest parameters” for this bean.
        </p>
        <AnalysisCard v-if="analysis" :analysis="analysis" />
      </section>
      <div class="stack">
        <button class="btn btn-secondary btn-block" type="button" @click="brewAgain">Brew again</button>
        <RouterLink v-if="savedLogId" class="btn btn-secondary btn-block" :to="{ name: 'journal-entry', params: { id: savedLogId } }">
          View in journal
        </RouterLink>
      </div>
    </template>
  </main>
</template>

<style scoped>
h1 {
  font-size: 1.5rem;
}
h2 {
  font-size: 1.1rem;
}
p {
  margin: 0;
}
.recipe-summary {
  font-size: 0.9rem;
  margin-top: calc(-1 * var(--space-2));
}
.suggest-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.reasoning {
  font-style: italic;
}
.advice {
  margin: 0;
  padding-left: 1.2rem;
}
.small {
  font-size: 0.85rem;
}
.cancel {
  align-self: flex-start;
  margin: calc(-1 * var(--space-2)) 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
.manage {
  float: right;
  font-weight: 600;
  font-size: 0.85rem;
}
.new-grinder {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.grow {
  flex: 1;
  min-width: 10rem;
}
.full {
  flex-basis: 100%;
}
.note {
  color: var(--brand);
  background: var(--brand-tint);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
}
.grind-hint {
  margin-top: calc(-1 * var(--space-2));
}
.saved h1 {
  color: var(--success);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
</style>

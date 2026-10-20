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
import { machinesApi } from '../api/machines';
import { drinksApi } from '../api/drinks';
import { componentLine } from '../lib/drinks';
import { decodeWhat, drinkChoices, encodeDrinks, encodeMethod, recipeChoices as recipesFor, validWhat, whatOptions } from '../lib/brewChoice';
import type { Drink, Grinder, Machine, Mark } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import BrewFields from '../components/BrewFields.vue';
import BrewTimer from '../components/BrewTimer.vue';
import { formatMark } from '../lib/marks';
import { stepTitle } from '../lib/steps';
import { useAnalysis } from '../composables/useAnalysis';
import { emptyDraft, parseBrewDraft } from '../lib/brewDraft';
import { formatDay, formatDoseLine, formatGrams, formatTime } from '../lib/format';
import { chooseGrind, startingParameters, suggestionFitsGrinder, type GrindSource, type StartingParameters } from '../lib/suggest';
import { useWorkspaceStore } from '../stores/workspace';
import { brewRetention, ROAST_LEVELS, scaleBatch, scaleShot, scaleSteps, type MeasuredBrew, type ScaleField } from '../lib/scale';

type Stage = 'setup' | 'timing' | 'log' | 'saved';

const workspaces = useWorkspaceStore();
const stage = ref<Stage>('setup');
const loading = ref(true);
const loadError = ref('');
const beans = ref<Bean[]>([]);
const recipes = ref<Recipe[]>([]);
const grinders = ref<Grinder[]>([]);
const machines = ref<Machine[]>([]);

// Setup
const beanId = ref('');
const recipeId = ref('');
// "What are you making?" (lib/brewChoice.ts): a brew method (only its
// recipes), a drink category (its drinks, then the drink's recipes, default
// preselected; docs/api_spec.md §5c), or anything.
const drinks = ref<Drink[]>([]);
const drinkId = ref('');
const drink = computed(() => drinks.value.find((d) => d.id === drinkId.value) ?? null);
const what = ref('any');
const whatChoice = computed(() => decodeWhat(what.value));
const whatList = computed(() => whatOptions(recipes.value, drinks.value));
const drinkList = computed(() => drinkChoices(whatChoice.value, drinks.value));
const recipeChoices = computed(() => recipesFor(whatChoice.value, recipes.value, drink.value));
watch(what, (value) => {
  remember('brewWhat', value);
  const w = decodeWhat(value);
  if (w.kind !== 'drinks') drinkId.value = ''; // a method has no drink; "anything" starts without one
  if (w.kind === 'drinks' && !drinkList.value.some((d) => d.id === drinkId.value)) drinkId.value = drinkList.value[0]?.id ?? '';
  // Keep the recipe if it still fits; a method always has one picked.
  if (!recipeChoices.value.some((r) => r.id === recipeId.value)) recipeId.value = w.kind === 'method' ? (recipeChoices.value[0]?.id ?? '') : '';
});
watch(drink, (d) => {
  if (!d || d.recipes.some((x) => x.id === recipeId.value)) return;
  recipeId.value = d.defaultRecipeId ?? d.recipes[0]?.id ?? '';
});
const bean = computed(() => beans.value.find((b) => b.id === beanId.value) ?? null);
const recipe = computed(() => recipes.value.find((r) => r.id === recipeId.value) ?? null);
const suggestion = ref<StartingParameters | null>(null);
const suggestionState = ref<'idle' | 'loading' | 'none' | 'error'>('idle');

// Espresso recipes record dose → shot weight instead of water (docs/api_spec.md §6).
const espresso = computed(() => recipe.value?.method.kind === 'espresso');
// The recipe as a filter recipe (it has water), for batch scaling.
const filterRecipe = computed(() => {
  const r = recipe.value;
  return r && r.targetWaterGrams !== null
    ? { targetDoseGrams: r.targetDoseGrams, targetWaterGrams: r.targetWaterGrams, expectedYieldGrams: r.expectedYieldGrams }
    : null;
});
// ...or as an espresso recipe (it has a target shot weight).
const shotRecipe = computed(() => {
  const r = recipe.value;
  return r && espresso.value && r.expectedYieldGrams !== null
    ? { targetDoseGrams: r.targetDoseGrams, expectedYieldGrams: r.expectedYieldGrams }
    : null;
});

// Brew details: pre-filled from the recipe / suggestion, edited in the log form.
const draft = reactive(emptyDraft());
const parsed = computed(() => parseBrewDraft(draft, recipe.value?.method.kind ?? null));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, r, g, m, d] = await Promise.all([
      beansApi.list(ws),
      recipesApi.list(ws),
      grindersApi.list(ws),
      machinesApi.list(ws),
      drinksApi.list(ws),
    ]);
    drinks.value = d.drinks.filter((x) => x.recipes.length > 0); // a drink needs a recipe to brew
    beans.value = b.beans;
    recipes.value = r.recipes;
    grinders.value = g.grinders;
    machines.value = m.machines;
    if (beans.value.length === 1) beanId.value = beans.value[0]?.id ?? '';
    const saved = recall('grinderId');
    if (saved && activeGrinders.value.some((x) => x.id === saved)) draft.grinderId = saved;
    // Machine: the last one used, or the only one there is.
    const savedMachine = recall('machineId');
    const machine = activeMachines.value.find((x) => x.id === savedMachine) ?? (activeMachines.value.length === 1 ? activeMachines.value[0] : undefined);
    if (machine) draft.machineId = machine.id;
    what.value = validWhat(recall('brewWhat'), whatList.value); // the last choice, if it still exists
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
  draft.water = r?.targetWaterGrams != null ? formatGrams(r.targetWaterGrams) : '';
  draft.yieldGrams = ''; // measured after brewing
  draft.temp = r?.targetTempC != null ? String(r.targetTempC) : '';
  resetBatch();
  // The recipe's default grinder, if it's still in use; else keep the current
  // (last used) one.
  const preferred = r?.defaultGrinderId;
  if (preferred && activeGrinders.value.some((x) => x.id === preferred)) draft.grinderId = preferred;
  if (suggestion.value) applySuggestion(suggestion.value);
});

// Batch size: type a dose, water or yield (g or fl oz) and the others follow
// (docs/features.md). The ratio defaults to the recipe's and can be changed;
// whatever was typed last is held. Pour targets scale with the water.
// Espresso uses the same inputs for dose, ratio (1:2) and shot weight.
const lead = ref<{ field: ScaleField; text: string }>({ field: 'dose', text: '' });
const ratioText = ref<string | null>(null); // null = the recipe's ratio
function resetBatch(): void {
  lead.value = { field: 'dose', text: recipe.value ? formatGrams(recipe.value.targetDoseGrams) : '' };
  ratioText.value = null;
}
function setLead(field: ScaleField, event: Event): void {
  lead.value = { field, text: (event.target as HTMLInputElement).value };
}
function setRatio(event: Event): void {
  ratioText.value = (event.target as HTMLInputElement).value;
}
// A positive decimal, allowing a trailing "." while typing.
function amount(text: string): number {
  const t = text.trim().replace(',', '.');
  return t && /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : Number.NaN;
}

// Your measured yields for this bean + recipe give the best retention figure.
const measured = ref<MeasuredBrew[]>([]);
let measuredRequest = 0;
async function loadMeasured(): Promise<void> {
  const ws = workspaces.current?.id;
  const request = ++measuredRequest; // ignore answers to superseded choices
  let list: MeasuredBrew[] = [];
  if (ws && beanId.value && recipeId.value) {
    try {
      const { brewLogs } = await brewLogsApi.list(ws, { beanId: beanId.value, limit: 50 });
      list = brewLogs
        .filter((l) => l.recipe?.id === recipeId.value)
        .flatMap((l) =>
          l.actualWaterGrams !== null && l.actualYieldGrams !== null
            ? [{ actualDoseGrams: l.actualDoseGrams, actualWaterGrams: l.actualWaterGrams, actualYieldGrams: l.actualYieldGrams }]
            : [],
        )
        .slice(0, 10);
    } catch {
      list = []; // the estimate falls back to roast level
    }
  }
  if (request === measuredRequest) measured.value = list;
}
watch([beanId, recipeId], () => void loadMeasured());

const retention = computed(() => brewRetention({ roastLevel: bean.value?.roastLevel ?? null, recipe: filterRecipe.value, measured: measured.value }));
const customRatio = computed(() => (ratioText.value === null ? undefined : amount(ratioText.value)));
const batch = computed(() => {
  if (!filterRecipe.value) return null;
  return scaleBatch(filterRecipe.value, { field: lead.value.field, value: amount(lead.value.text) }, retention.value.retention, customRatio.value);
});
const shot = computed(() => {
  const field = lead.value.field;
  if (!shotRecipe.value || (field !== 'dose' && field !== 'yield')) return null;
  return scaleShot(shotRecipe.value, { field, value: amount(lead.value.text) }, customRatio.value);
});
watch(batch, (b) => {
  if (!b) return;
  draft.dose = formatGrams(b.dose);
  draft.water = formatGrams(b.water);
});
watch(shot, (s) => {
  if (s) draft.dose = formatGrams(s.dose);
});
// Setup can continue once the batch (or shot) makes sense.
const setupReady = computed(() => !recipe.value || (espresso.value ? !!shot.value : !!batch.value));
function batchText(field: ScaleField): string {
  if (lead.value.field === field) return lead.value.text;
  if (espresso.value) return shot.value && (field === 'dose' || field === 'yield') ? formatGrams(shot.value[field]) : '';
  return batch.value ? formatGrams(batch.value[field]) : '';
}
const ratioShown = computed(() => {
  if (ratioText.value !== null) return ratioText.value;
  const r = filterRecipe.value ?? shotRecipe.value;
  if (!r) return '';
  const out = 'targetWaterGrams' in r ? r.targetWaterGrams : r.expectedYieldGrams;
  return String(Math.round((out / r.targetDoseGrams) * 10) / 10);
});
const scaled = computed(() => {
  const r = recipe.value;
  if (!r) return false;
  if (espresso.value) {
    const s = shot.value;
    return !!s && (Math.abs(s.dose - r.targetDoseGrams) > 1e-9 || Math.abs(s.yield - (r.expectedYieldGrams ?? 0)) > 1e-9);
  }
  const b = batch.value;
  return !!b && (Math.abs(b.factor - 1) > 1e-9 || Math.abs(b.dose - r.targetDoseGrams) > 1e-9);
});
const retentionNote = computed(() => {
  const s = retention.value.source;
  if (s.kind === 'measured') return `from ${s.count === 1 ? 'your measured brew' : `${s.count} of your measured brews`} of this bean with this recipe`;
  const roast = bean.value?.roastLevel
    ? `a ${ROAST_LEVELS[s.roastLevel].label.toLowerCase()} roast`
    : "a light roast (set the bean's roast level for a closer estimate)";
  return s.kind === 'recipe' ? `from the recipe's expected yield, adjusted for ${roast}` : `for ${roast}`;
});
// A deeper or shallower bed (more or less coffee) drains at a different speed.
const grindNote = computed(() => {
  if (espresso.value) return null; // a basket's dose range is narrow; dial in by taste instead
  const f = batch.value && recipe.value ? batch.value.dose / recipe.value.targetDoseGrams : 1;
  if (f >= 1.25) return 'Bigger batch than the recipe: a slightly coarser grind helps keep the brew time on target.';
  if (f <= 0.8) return 'Smaller batch than the recipe: a slightly finer grind helps keep the brew time on target.';
  return null;
});

// Grinders: pick from active ones, add inline, remember the last one per workspace.
const NEW_GRINDER = '__new__';
const activeGrinders = computed(() => grinders.value.filter((x) => !x.retiredAt));
const grinder = computed(() => grinders.value.find((x) => x.id === draft.grinderId) ?? null);
// Espresso brews also record a machine (picked like the grinder, no inline add).
const activeMachines = computed(() => machines.value.filter((x) => !x.retiredAt));
// The last grinder / machine used, remembered per workspace.
type Remembered = 'grinderId' | 'machineId' | 'brewWhat';
const savedKey = (what: Remembered) => `brewlog.${what}.${workspaces.current?.id ?? ''}`;
function recall(what: Remembered): string | null {
  try {
    return localStorage.getItem(savedKey(what));
  } catch {
    return null;
  }
}
function remember(what: Remembered, id: string): void {
  try {
    if (id) localStorage.setItem(savedKey(what), id);
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

const timerSteps = computed(() => scaleSteps(recipe.value?.steps ?? [], batch.value?.factor ?? 1));
const timerDose = computed(() => (espresso.value ? shot.value?.dose : batch.value?.dose) ?? recipe.value?.targetDoseGrams ?? 0);
// What the log form compares the measured yield / shot weight with.
const expectedYield = computed(() => (espresso.value ? shot.value?.yield : batch.value?.yield) ?? recipe.value?.expectedYieldGrams ?? null);

// The timer: the chosen machine (espresso, for "can't set pressure" notes),
// the header line, the first-drop window, and the marks it records.
const machine = computed(() => (espresso.value ? (machines.value.find((x) => x.id === draft.machineId) ?? null) : null));
const timerSubtitle = computed(() =>
  espresso.value && shot.value
    ? `${beanLabel.value} • ${formatGrams(shot.value.dose)} g → ${formatGrams(shot.value.yield)} g`
    : `${beanLabel.value} • ${formatGrams(timerDose.value)}g dose`,
);
const firstDropWindow = computed(() => {
  const r = recipe.value;
  return r && r.firstDropMinSec !== null && r.firstDropMaxSec !== null ? { min: r.firstDropMinSec, max: r.firstDropMaxSec } : null;
});
const marks = ref<Mark[]>([]);
// "Bloom ended 0:52 · Pour logged 1:30": the steps' real times, shown on the log form.
const stepMarksLine = computed(() =>
  marks.value
    .filter((m) => m.kind === 'step_end' && m.stepOrder !== null)
    .map((m) => {
      const step = recipe.value?.steps[(m.stepOrder ?? 0) - 1];
      const name = step ? stepTitle(step) : `Step ${m.stepOrder}`;
      return `${name} ${step?.advance === 'auto_log' ? 'logged' : 'ended'} ${formatMark(m.atSec)}`;
    })
    .join(' · '),
);

// An unfinished "add a new grinder" counts as no grinder once setup is done.
function leaveSetup(next: Stage): void {
  if (draft.grinderId === NEW_GRINDER) draft.grinderId = '';
  marks.value = [];
  stage.value = next;
}
function logWithoutTimer(): void {
  draft.time = '';
  leaveSetup('log');
}
function onTimerComplete(seconds: number, timerMarks: Mark[] = []): void {
  draft.time = formatTime(seconds);
  marks.value = timerMarks;
  // The first drop goes in the log's field, where it can be fixed or typed in.
  const drop = timerMarks.find((m) => m.kind === 'first_drop');
  draft.firstDrop = drop ? String(drop.atSec) : '';
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
    const { brewLog } = await brewLogsApi.create(ws, {
      beanId: bean.value.id,
      recipeId: recipe.value?.id ?? null,
      drinkId: drink.value?.id ?? null,
      ...values,
      // The steps' real times, plus the first drop from the log's field. A time
      // typed shorter than a tap drops that tap.
      marks: [
        ...(recipe.value ? marks.value.filter((m) => m.kind === 'step_end' && m.atSec <= values.actualTimeSec) : []),
        ...(parsed.value.firstDropSec !== null ? [{ kind: 'first_drop' as const, stepOrder: null, atSec: parsed.value.firstDropSec }] : []),
      ],
    });
    if (values.grinderId) remember('grinderId', values.grinderId);
    if (values.machineId) remember('machineId', values.machineId);
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
          <label for="what">What are you making?</label>
          <select id="what" v-model="what">
            <option value="any">Anything (all recipes)</option>
            <optgroup v-if="whatList.methods.length" label="Brew methods">
              <option v-for="m in whatList.methods" :key="m.id" :value="encodeMethod(m.id)">{{ m.name }}</option>
            </optgroup>
            <optgroup v-if="whatList.categories.length" label="Drinks">
              <option v-for="c in whatList.categories" :key="c ?? ''" :value="encodeDrinks(c)">{{ c ?? 'Other drinks' }}</option>
            </optgroup>
          </select>
        </div>
        <div v-if="whatChoice.kind === 'drinks' || (whatChoice.kind === 'any' && drinkList.length)" class="field">
          <label for="drink">Drink <span v-if="whatChoice.kind === 'any'" class="muted">(optional)</span></label>
          <select id="drink" v-model="drinkId">
            <option v-if="whatChoice.kind === 'any'" value="">None: just a recipe</option>
            <option v-for="d in drinkList" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>
        <div class="field">
          <label for="recipe">Recipe <span class="muted">{{ drink ? `(${drink.name}'s)` : whatChoice.kind === 'any' ? '(optional)' : '' }}</span></label>
          <select id="recipe" v-model="recipeId">
            <option v-if="whatChoice.kind === 'any' && !drink" value="">No recipe</option>
            <option v-for="r in recipeChoices" :key="r.id" :value="r.id">{{ r.name }}<template v-if="whatChoice.kind !== 'method'"> ({{ r.method.name }})</template></option>
          </select>
        </div>
        <div v-if="drink && drink.components.length" class="finish-with" aria-label="Finish with">
          <span class="batch-label">Finish with</span>
          <ul>
            <li v-for="c in drink.components" :key="c.componentId">{{ componentLine(c) }}</li>
          </ul>
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
        <div v-if="espresso" class="field">
          <label for="machine">
            Machine <span class="muted">(optional)</span>
            <RouterLink class="manage" :to="{ name: 'machines' }">{{ activeMachines.length ? 'Manage' : 'Add one' }}</RouterLink>
          </label>
          <select id="machine" v-model="draft.machineId">
            <option value="">No machine</option>
            <option v-for="x in activeMachines" :key="x.id" :value="x.id">{{ x.name }}</option>
          </select>
        </div>
        <p v-if="recipe" class="muted recipe-summary">
          {{ formatDoseLine(recipe.targetDoseGrams, recipe.targetWaterGrams, recipe.expectedYieldGrams) }}
          <template v-if="recipe.targetTempC !== null"> · {{ recipe.targetTempC }} °C</template>
          <template v-if="recipe.steps.length"> · {{ recipe.steps.length }} step{{ recipe.steps.length === 1 ? '' : 's' }}</template>
        </p>
        <div v-if="shotRecipe" class="batch" role="group" aria-labelledby="shot-label">
          <span id="shot-label" class="batch-label">Shot</span>
          <div class="batch-row">
            <div class="field">
              <label for="batch-dose">Dose (g)</label>
              <input id="batch-dose" inputmode="decimal" :value="batchText('dose')" @input="setLead('dose', $event)" />
            </div>
            <div class="field">
              <label for="batch-ratio">Ratio</label>
              <div class="ratio-input">
                <span aria-hidden="true">1 :</span>
                <input id="batch-ratio" inputmode="decimal" :value="ratioShown" aria-label="Shot weight per gram of coffee" @input="setRatio" />
              </div>
            </div>
            <div class="field">
              <label for="batch-yield">Shot (g)</label>
              <input id="batch-yield" inputmode="decimal" :value="batchText('yield')" @input="setLead('yield', $event)" />
            </div>
          </div>
          <p v-if="!shot" class="field-error">Enter positive amounts.</p>
          <button v-if="scaled" class="btn-link small batch-reset" type="button" @click="resetBatch">Reset to recipe</button>
        </div>
        <div v-else-if="filterRecipe" class="batch" role="group" aria-labelledby="batch-label">
          <span id="batch-label" class="batch-label">Batch size</span>
          <div class="batch-row">
            <div class="field">
              <label for="batch-dose">Dose (g)</label>
              <input id="batch-dose" inputmode="decimal" :value="batchText('dose')" @input="setLead('dose', $event)" />
            </div>
            <div class="field">
              <label for="batch-water">Water (g)</label>
              <input id="batch-water" inputmode="decimal" :value="batchText('water')" @input="setLead('water', $event)" />
            </div>
            <div class="field">
              <label for="batch-ratio">Ratio</label>
              <div class="ratio-input">
                <span aria-hidden="true">1 :</span>
                <input id="batch-ratio" inputmode="decimal" :value="ratioShown" aria-label="Water per gram of coffee" @input="setRatio" />
              </div>
            </div>
          </div>
          <div class="batch-row two">
            <div class="field">
              <label for="batch-yield">Yield ≈ (g)</label>
              <input id="batch-yield" inputmode="decimal" :value="batchText('yield')" @input="setLead('yield', $event)" />
            </div>
            <div class="field">
              <label for="batch-yield-oz">Yield ≈ (fl oz)</label>
              <input id="batch-yield-oz" inputmode="decimal" :value="batchText('yieldOz')" @input="setLead('yieldOz', $event)" />
            </div>
          </div>
          <p v-if="!batch" class="field-error">Enter positive amounts (the ratio must leave some coffee in the cup).</p>
          <p v-else class="muted small">
            Yield estimated {{ retentionNote }}.
            <template v-if="scaled">Pours scale ×{{ Math.round(batch.factor * 100) / 100 }} with the water; step times stay the same.</template>
          </p>
          <button v-if="scaled" class="btn-link small batch-reset" type="button" @click="resetBatch">Reset to recipe</button>
          <p v-if="grindNote" class="note small">{{ grindNote }}</p>
        </div>
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
        <button class="btn btn-primary btn-block" type="button" :disabled="!bean || !setupReady" @click="leaveSetup('timing')">
          {{ espresso ? 'Start shot timer' : timerSteps.length ? 'Start timer' : 'Start stopwatch' }}
        </button>
        <button class="btn btn-secondary btn-block" type="button" :disabled="!bean || !setupReady" @click="logWithoutTimer">
          Log a brew without the timer
        </button>
      </div>
    </template>

    <!-- 2. Timer -->
    <template v-else-if="stage === 'timing'">
      <button class="btn-link cancel" type="button" @click="stage = 'setup'">← Cancel brew</button>
      <BrewTimer
        :recipe-name="recipe?.name ?? 'Brew'"
        :subtitle="timerSubtitle"
        :steps="timerSteps"
        :espresso="espresso"
        :flow-unit="recipe?.flowUnit ?? 'g_s'"
        :expected-finish-min-sec="recipe?.expectedFinishMinSec ?? null"
        :expected-finish-max-sec="recipe?.expectedFinishMaxSec ?? null"
        :first-drop-window="firstDropWindow"
        :machine="machine"
        @complete="onTimerComplete"
      />
    </template>

    <!-- 3. Log -->
    <form v-else-if="stage === 'log'" class="stack" novalidate @submit.prevent="save">
      <h1>How was it?</h1>
      <p class="muted">
        {{ beanLabel }}<template v-if="drink"> · {{ drink.name }}</template><template v-if="recipe"> · {{ recipe.name }}</template>
      </p>
      <p v-if="drink && drink.components.length" class="note small">Finish with {{ drink.components.map(componentLine).join(', ') }}</p>
      <section class="card">
        <p v-if="stepMarksLine" class="muted small marks-line">{{ stepMarksLine }}</p>
        <BrewFields v-model="draft" :errors="parsed.errors" :show-errors="submitted" :grinders="grinders" :expected-yield-grams="expectedYield" :espresso="espresso" :machines="machines" />
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
.batch {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.batch p {
  margin: 0;
}
.batch-reset {
  align-self: flex-start;
  margin: calc(-1 * var(--space-2)) 0 0 calc(-1 * var(--space-2));
}
.finish-with ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
}
.batch-label {
  font-weight: 600;
}
.batch-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}
.batch-row.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.batch-row input {
  width: 100%;
  min-width: 0;
}
.ratio-input {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.ratio-input span {
  color: var(--text-muted);
  white-space: nowrap;
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

<script setup lang="ts">
// Recipe editor (docs/api_spec.md §5): dose + water (live ratio), optional
// expected yield / finish time / temperature, per-grinder grind starting
// points, and typed, timed steps. Espresso methods instead take dose + target
// shot weight (ratio dose:yield), a shot-time and first-drop window, and an
// optional pre-infusion time (saved as a "preinfusion" step from 0:00).
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { grindersApi } from '../api/grinders';
import { brewMethodsApi, recipesApi, type RecipeInput } from '../api/recipes';
import type { BrewMethod, Grinder, MethodKind, StepType } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { formatGrams, formatRatio, formatTime, parseDecimal } from '../lib/format';
import { VueDraggable } from 'vue-draggable-plus';
import {
  FIRST_DROP_DEFAULT_SPREAD_SEC,
  formatFinishWindow,
  insertStepAfter,
  moveStep,
  newStepKey,
  parseFinishWindow,
  parseSteps,
  pourAmounts,
  recipeWarnings,
  STEP_TYPE_ORDER,
  STEP_TYPES,
  type StepDraft,
} from '../lib/steps';
import { useWorkspaceStore } from '../stores/workspace';
import { estimateYield, RECIPE_ROAST_LEVEL, ROAST_LEVELS } from '../lib/scale';
import { METHOD_KINDS } from '../lib/equipment';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const NEW_METHOD = '__new__';

const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const methods = ref<BrewMethod[]>([]);
const grinders = ref<Grinder[]>([]);
const name = ref('');
const methodId = ref('');
const dose = ref('');
const water = ref('');
const expectedYield = ref('');
// Expected yield follows a light-roast estimate until typed over.
const yieldCustom = ref(false);
const finishFrom = ref('');
const finishTo = ref('');
const firstDropFrom = ref(''); // espresso only
const firstDropTo = ref('');
const preinfusion = ref(''); // espresso only: seconds
const temp = ref('');
const showOnPublicMenu = ref(true);
const grindRows = ref<Array<{ grinderId: string; setting: string }>>([]);
const steps = ref<StepDraft[]>([]);

// Inline "add a new brew method" (methods are a per-workspace list, §3).
const newMethodName = ref('');
const newMethodKind = ref<MethodKind>('pour_over');
const addingMethod = ref(false);
const methodError = ref('');
const newMethodInput = ref<HTMLInputElement | null>(null);

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const submitted = ref(false);

// The chosen method's kind decides the fields (docs/api_spec.md §5).
const kind = computed<MethodKind | null>(() => methods.value.find((m) => m.id === methodId.value)?.kind ?? null);
const espresso = computed(() => kind.value === 'espresso');

const grams = { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true } as const;
const parsed = computed(() => ({
  dose: parseDecimal(dose.value, { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true }),
  water: espresso.value ? ({ ok: true, value: null } as const) : parseDecimal(water.value, grams),
  expectedYield: expectedYield.value.trim()
    ? parseDecimal(expectedYield.value, grams)
    : espresso.value
      ? ({ ok: false, error: 'Enter the target shot weight' } as const)
      : null,
  finish: parseFinishWindow(finishFrom.value, finishTo.value),
  firstDrop: espresso.value ? parseFinishWindow(firstDropFrom.value, firstDropTo.value, FIRST_DROP_DEFAULT_SPREAD_SEC) : ({ ok: true, value: null } as const),
  preinfusion: espresso.value && preinfusion.value.trim() ? parseDecimal(preinfusion.value, { scale: 0, min: 1, max: 120 }) : null,
  temp: temp.value.trim() ? parseDecimal(temp.value, { scale: 1, min: 0, max: 100 }) : null,
}));
const stepsParsed = computed(() => parseSteps(steps.value));
// "+X g" next to each pour-to, from whatever has been typed so far (even if
// another field in that row still has an error).
const amounts = computed(() =>
  pourAmounts(
    steps.value.map((d) => {
      if (STEP_TYPES[d.stepType].water === 'none') return { targetWaterGrams: null };
      const w = parseDecimal(d.water, grams);
      return { targetWaterGrams: w.ok ? w.value : null };
    }),
  ),
);

const grindErrors = computed(() =>
  grindRows.value.map((row, i) => {
    if (!row.grinderId) return 'Choose a grinder';
    if (!row.setting.trim()) return 'Enter a setting';
    if (grindRows.value.findIndex((r) => r.grinderId === row.grinderId) !== i) return 'This grinder is already listed';
    return '';
  }),
);

const fieldErrors = computed(() => {
  const p = parsed.value;
  return {
    name: name.value.trim() ? '' : 'Required',
    method: methodId.value && methodId.value !== NEW_METHOD ? '' : 'Choose a brew method',
    dose: p.dose.ok ? '' : p.dose.error,
    water: p.water.ok ? '' : p.water.error,
    expectedYield: p.expectedYield && !p.expectedYield.ok ? p.expectedYield.error : '',
    finish: p.finish.ok ? '' : p.finish.error,
    firstDrop: p.firstDrop.ok ? '' : p.firstDrop.error,
    preinfusion: p.preinfusion && !p.preinfusion.ok ? p.preinfusion.error : '',
    temp: p.temp && !p.temp.ok ? p.temp.error : '',
  };
});
const valid = computed(
  () =>
    Object.values(fieldErrors.value).every((e) => !e) &&
    grindErrors.value.every((e) => !e) &&
    (espresso.value || Object.keys(stepsParsed.value.errors).length === 0),
);
// Coffee:water, or for espresso coffee:shot weight.
const ratio = computed(() => {
  const p = parsed.value;
  if (!p.dose.ok) return null;
  const out = espresso.value ? (p.expectedYield?.ok ? p.expectedYield.value : null) : p.water.ok ? p.water.value : null;
  return out === null ? null : formatRatio(p.dose.value, out);
});
// Pour-over/immersion only: espresso's yield is a target, not an estimate.
const yieldEstimate = computed(() =>
  !espresso.value && parsed.value.dose.ok && parsed.value.water.ok && parsed.value.water.value !== null
    ? estimateYield(parsed.value.dose.value, parsed.value.water.value, ROAST_LEVELS[RECIPE_ROAST_LEVEL].retention)
    : null,
);
const expectedYieldValue = computed(() => (parsed.value.expectedYield?.ok ? parsed.value.expectedYield.value : null));
watch(yieldEstimate, (est) => {
  if (!yieldCustom.value) expectedYield.value = est === null ? '' : formatGrams(est);
}, { immediate: true });
watch(yieldCustom, (custom) => {
  if (!custom) expectedYield.value = yieldEstimate.value === null ? '' : formatGrams(yieldEstimate.value);
});
// Pour checks don't apply to espresso (no water, no steps yet).
const warnings = computed(() =>
  espresso.value
    ? []
    : recipeWarnings({
        waterGrams: parsed.value.water.ok ? parsed.value.water.value : null,
        finishMaxSec: parsed.value.finish.ok ? (parsed.value.finish.value?.max ?? null) : null,
        steps: stepsParsed.value.steps,
      }),
);

// Grinder choices for a row: active grinders, plus whatever this row already uses.
function grinderOptions(rowIndex: number): Grinder[] {
  const used = new Set(grindRows.value.filter((_, i) => i !== rowIndex).map((r) => r.grinderId));
  const current = grindRows.value[rowIndex]?.grinderId;
  return grinders.value.filter((g) => (!g.retiredAt || g.id === current) && !used.has(g.id));
}
const canAddGrindRow = computed(() => grinders.value.some((g) => !g.retiredAt && !grindRows.value.some((r) => r.grinderId === g.id)));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [methodList, grinderList, recipeList] = await Promise.all([
      brewMethodsApi.list(ws),
      grindersApi.list(ws),
      editing.value ? recipesApi.list(ws) : Promise.resolve(null),
    ]);
    methods.value = methodList.brewMethods;
    grinders.value = grinderList.grinders;
    if (!editing.value) return;
    const recipe = recipeList?.recipes.find((r) => r.id === props.id);
    if (!recipe) {
      error.value = 'This recipe no longer exists.';
      return;
    }
    name.value = recipe.name;
    methodId.value = recipe.method.id;
    dose.value = formatGrams(recipe.targetDoseGrams);
    water.value = recipe.targetWaterGrams === null ? '' : formatGrams(recipe.targetWaterGrams);
    expectedYield.value = recipe.expectedYieldGrams === null ? '' : formatGrams(recipe.expectedYieldGrams);
    // A saved yield that isn't the estimate was typed by someone: keep it.
    yieldCustom.value = recipe.expectedYieldGrams !== null && recipe.expectedYieldGrams !== yieldEstimate.value;
    finishFrom.value = recipe.expectedFinishMinSec === null ? '' : formatTime(recipe.expectedFinishMinSec);
    finishTo.value = recipe.expectedFinishMaxSec === null ? '' : formatTime(recipe.expectedFinishMaxSec);
    firstDropFrom.value = recipe.firstDropMinSec === null ? '' : formatTime(recipe.firstDropMinSec);
    firstDropTo.value = recipe.firstDropMaxSec === null ? '' : formatTime(recipe.firstDropMaxSec);
    temp.value = recipe.targetTempC === null ? '' : String(recipe.targetTempC);
    showOnPublicMenu.value = recipe.showOnPublicMenu;
    grindRows.value = recipe.grindSettings.map((g) => ({ grinderId: g.grinderId, setting: g.setting }));
    // Espresso's pre-infusion step has its own field.
    const pi = recipe.steps.find((s) => s.stepType === 'preinfusion');
    preinfusion.value = pi ? String(pi.endSec - pi.startSec) : '';
    steps.value = recipe.steps.filter((s) => s.stepType !== 'preinfusion').map((s) => ({
      key: newStepKey(),
      stepType: s.stepType,
      label: s.label ?? '',
      start: formatTime(s.startSec),
      end: formatTime(s.endSec),
      water: s.targetWaterGrams === null ? '' : formatGrams(s.targetWaterGrams),
    }));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function onMethodChange(): Promise<void> {
  if (methodId.value !== NEW_METHOD) return;
  methodError.value = '';
  await nextTick();
  newMethodInput.value?.focus();
}

async function addMethod(): Promise<void> {
  const ws = workspaces.current?.id;
  const trimmed = newMethodName.value.trim();
  if (!ws || !trimmed) return;
  addingMethod.value = true;
  methodError.value = '';
  try {
    const { brewMethod } = await brewMethodsApi.create(ws, trimmed, newMethodKind.value);
    methods.value = [...methods.value, brewMethod].sort((a, b) => a.name.localeCompare(b.name));
    methodId.value = brewMethod.id;
    newMethodName.value = '';
  } catch (err) {
    methodError.value =
      err instanceof ApiError && err.status === 409 ? 'That method already exists. Pick it from the list.' : errorMessage(err);
  } finally {
    addingMethod.value = false;
  }
}

function addGrindRow(): void {
  const next = grinders.value.find((g) => !g.retiredAt && !grindRows.value.some((r) => r.grinderId === g.id));
  grindRows.value.push({ grinderId: next?.id ?? '', setting: '' });
}

// New steps continue from the previous one: start where it ended, 30 s long,
// and (for water steps) pour to the same total until edited.
function addStep(): void {
  const last = stepsParsed.value.steps[stepsParsed.value.steps.length - 1];
  const lastWater = [...stepsParsed.value.steps].reverse().find((s) => s.targetWaterGrams !== null)?.targetWaterGrams;
  const doseValue = parsed.value.dose.ok ? parsed.value.dose.value : null;
  const first = steps.value.length === 0;
  const startSec = last?.endSec ?? 0;
  const type: StepType = first ? 'bloom' : 'pour';
  steps.value.push({
    key: newStepKey(),
    stepType: type,
    label: '',
    start: formatTime(startSec),
    end: formatTime(startSec + (first ? 10 : 30)),
    // A bloom is commonly 2-3x the dose in water.
    water: first ? (doseValue ? formatGrams(Math.round(doseValue * 3)) : '') : lastWater != null ? formatGrams(lastWater) : '',
  });
}

// "+ Add step here" between steps: see insertStepAfter for how times fit.
async function insertAfter(index: number): Promise<void> {
  const result = insertStepAfter(steps.value, index, newStepKey());
  if (result.index < 0) return;
  steps.value = result.steps;
  moveAnnouncement.value = `Step added at position ${result.index + 1} of ${steps.value.length}`;
  await nextTick();
  document.getElementById(`step-type-${result.index}`)?.focus();
}

function removeStep(index: number): void {
  steps.value.splice(index, 1);
}

// Drag and drop (touch-friendly, via SortableJS) and keyboard both go through
// moveStep, which re-times the steps to fit their new order.
function onDragUpdate(event: { oldIndex?: number; newIndex?: number }): void {
  if (event.oldIndex === undefined || event.newIndex === undefined) return;
  steps.value = moveStep(steps.value, event.oldIndex, event.newIndex);
}
// A text field that still has focus stops SortableJS from picking a step up
// on touch screens (found in testing: type a time, then try to drag). Pressing
// the handle releases the field first, which also hides the phone keyboard.
function releaseFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) active.blur();
}
const moveAnnouncement = ref('');
async function moveByKey(index: number, delta: -1 | 1): Promise<void> {
  const to = index + delta;
  if (to < 0 || to >= steps.value.length) return;
  steps.value = moveStep(steps.value, index, to);
  moveAnnouncement.value = `Step moved to position ${to + 1} of ${steps.value.length}`;
  await nextTick();
  (document.querySelector(`[data-handle-index="${to}"]`) as HTMLElement | null)?.focus();
}

// What the finish window will be saved as, when only one end is typed.
const finishHint = computed(() => {
  const w = parsed.value.finish;
  if (!w.ok || !w.value) return '';
  const oneEnd = !finishFrom.value.trim() || !finishTo.value.trim();
  return oneEnd ? `Saved as ${formatFinishWindow(w.value.min, w.value.max)} (±15 s)` : '';
});
const firstDropHint = computed(() => {
  const w = parsed.value.firstDrop;
  if (!w.ok || !w.value) return '';
  const oneEnd = !firstDropFrom.value.trim() || !firstDropTo.value.trim();
  return oneEnd ? `Saved as ${formatFinishWindow(w.value.min, w.value.max)} (±${FIRST_DROP_DEFAULT_SPREAD_SEC} s)` : '';
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const p = parsed.value;
  if (!valid.value || !ws || !p.dose.ok || !p.water.ok) return;
  const input: RecipeInput = {
    name: name.value.trim(),
    methodId: methodId.value,
    targetDoseGrams: p.dose.value,
    targetWaterGrams: p.water.value,
    expectedYieldGrams: p.expectedYield?.ok ? p.expectedYield.value : null,
    expectedFinishMinSec: p.finish.ok ? (p.finish.value?.min ?? null) : null,
    expectedFinishMaxSec: p.finish.ok ? (p.finish.value?.max ?? null) : null,
    firstDropMinSec: p.firstDrop.ok ? (p.firstDrop.value?.min ?? null) : null,
    firstDropMaxSec: p.firstDrop.ok ? (p.firstDrop.value?.max ?? null) : null,
    targetTempC: p.temp?.ok ? p.temp.value : null,
    showOnPublicMenu: showOnPublicMenu.value,
    grindSettings: grindRows.value.map((r) => ({ grinderId: r.grinderId, setting: r.setting.trim() })),
    // Espresso: just the pre-infusion, from the start of the shot.
    steps: espresso.value
      ? p.preinfusion?.ok
        ? [{ stepType: 'preinfusion', label: null, startSec: 0, endSec: p.preinfusion.value, targetWaterGrams: null }]
        : []
      : stepsParsed.value.steps,
  };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await recipesApi.update(ws, props.id, input);
    else await recipesApi.create(ws, input);
    await router.push({ name: 'recipes' });
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit recipe' : 'Add recipe' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="name" maxlength="255" placeholder="e.g. House V60" :aria-invalid="submitted && !!fieldErrors.name" />
          <span v-if="submitted && fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </div>

        <div class="field">
          <label for="method">Brew method</label>
          <select id="method" v-model="methodId" :aria-invalid="submitted && !!fieldErrors.method" @change="onMethodChange">
            <option value="" disabled>Choose…</option>
            <option v-for="m in methods" :key="m.id" :value="m.id">{{ m.name }}</option>
            <option :value="NEW_METHOD">+ Add a new method…</option>
          </select>
          <span v-if="submitted && fieldErrors.method" class="field-error">{{ fieldErrors.method }}</span>
        </div>
        <div v-if="methodId === NEW_METHOD" class="inline-add">
          <div class="field grow">
            <label for="new-method">New method name</label>
            <input id="new-method" ref="newMethodInput" v-model="newMethodName" maxlength="100" placeholder="e.g. Chemex" @keydown.enter.prevent="addMethod" />
          </div>
          <div class="field">
            <label for="new-method-kind">Kind</label>
            <select id="new-method-kind" v-model="newMethodKind">
              <option v-for="(k, key) in METHOD_KINDS" :key="key" :value="key">{{ k.label }}</option>
            </select>
          </div>
          <button class="btn btn-secondary" type="button" :disabled="addingMethod || !newMethodName.trim()" @click="addMethod">Add</button>
          <span v-if="methodError" class="field-error full">{{ methodError }}</span>
        </div>

        <div class="form-row">
          <div class="field">
            <label for="dose">Dose (g)</label>
            <input id="dose" v-model="dose" inputmode="decimal" placeholder="15" :aria-invalid="submitted && !!fieldErrors.dose" />
            <span v-if="submitted && fieldErrors.dose" class="field-error">{{ fieldErrors.dose }}</span>
          </div>
          <div v-if="espresso" class="field">
            <label for="expected-yield">Shot weight (g)</label>
            <input id="expected-yield" v-model="expectedYield" inputmode="decimal" placeholder="36" :aria-invalid="submitted && !!fieldErrors.expectedYield" @input="yieldCustom = true" />
            <span v-if="submitted && fieldErrors.expectedYield" class="field-error">{{ fieldErrors.expectedYield }}</span>
          </div>
          <div v-else class="field">
            <label for="water">Water (g)</label>
            <input id="water" v-model="water" inputmode="decimal" placeholder="250" :aria-invalid="submitted && !!fieldErrors.water" />
            <span v-if="submitted && fieldErrors.water" class="field-error">{{ fieldErrors.water }}</span>
          </div>
        </div>
        <p class="ratio" aria-live="polite">
          {{ espresso ? 'Coffee : shot' : 'Coffee : water' }} <strong>{{ ratio ?? '–' }}</strong>
        </p>

        <div class="form-row">
          <div v-if="!espresso" class="field">
            <label for="expected-yield">Expected yield (g)</label>
            <input id="expected-yield" v-model="expectedYield" inputmode="decimal" placeholder="e.g. 220" :aria-invalid="submitted && !!fieldErrors.expectedYield" @input="yieldCustom = true" />
            <span v-if="submitted && fieldErrors.expectedYield" class="field-error">{{ fieldErrors.expectedYield }}</span>
            <span v-else-if="!yieldCustom && yieldEstimate !== null" class="muted small">Estimated for a {{ ROAST_LEVELS[RECIPE_ROAST_LEVEL].label.toLowerCase() }} roast</span>
            <button v-else-if="yieldCustom && yieldEstimate !== null && expectedYieldValue !== yieldEstimate" class="btn-link small yield-reset" type="button" @click="yieldCustom = false">
              Use estimate ({{ formatGrams(yieldEstimate) }} g)
            </button>
          </div>
          <div v-if="espresso" class="field">
            <label for="preinfusion">Pre-infusion (s) <span class="muted">(optional)</span></label>
            <input id="preinfusion" v-model="preinfusion" inputmode="numeric" placeholder="e.g. 8" :aria-invalid="submitted && !!fieldErrors.preinfusion" />
            <span v-if="submitted && fieldErrors.preinfusion" class="field-error">{{ fieldErrors.preinfusion }}</span>
            <span v-else class="hint">The shot timer cues it, or follows the machine.</span>
          </div>
          <div class="field">
            <label for="temp">Water temp (°C) <span class="muted">(optional)</span></label>
            <input id="temp" v-model="temp" inputmode="decimal" placeholder="94" :aria-invalid="submitted && !!fieldErrors.temp" />
            <span v-if="submitted && fieldErrors.temp" class="field-error">{{ fieldErrors.temp }}</span>
          </div>
        </div>
        <fieldset class="finish">
          <legend>{{ espresso ? 'Target shot time' : 'Target finish' }} <span class="muted">(optional)</span></legend>
          <div class="finish-row">
            <div class="field">
              <label for="finish-from">From</label>
              <input id="finish-from" v-model="finishFrom" inputmode="numeric" placeholder="m:ss" :aria-invalid="submitted && !!fieldErrors.finish" />
            </div>
            <span class="dash" aria-hidden="true">–</span>
            <div class="field">
              <label for="finish-to">To</label>
              <input id="finish-to" v-model="finishTo" inputmode="numeric" placeholder="m:ss" :aria-invalid="submitted && !!fieldErrors.finish" />
            </div>
          </div>
          <!-- Shown live once both ends are filled: a backwards range is unambiguous. -->
          <span v-if="fieldErrors.finish && (submitted || (finishFrom.trim() && finishTo.trim()))" class="field-error">{{ fieldErrors.finish }}</span>
          <span v-else-if="finishHint" class="hint">{{ finishHint }}</span>
        </fieldset>
        <fieldset v-if="espresso" class="finish">
          <legend>First drop <span class="muted">(optional)</span></legend>
          <div class="finish-row">
            <div class="field">
              <label for="drop-from">From</label>
              <input id="drop-from" v-model="firstDropFrom" inputmode="numeric" placeholder="m:ss" :aria-invalid="submitted && !!fieldErrors.firstDrop" />
            </div>
            <span class="dash" aria-hidden="true">–</span>
            <div class="field">
              <label for="drop-to">To</label>
              <input id="drop-to" v-model="firstDropTo" inputmode="numeric" placeholder="m:ss" :aria-invalid="submitted && !!fieldErrors.firstDrop" />
            </div>
          </div>
          <span v-if="fieldErrors.firstDrop && (submitted || (firstDropFrom.trim() && firstDropTo.trim()))" class="field-error">{{ fieldErrors.firstDrop }}</span>
          <span v-else-if="firstDropHint" class="hint">{{ firstDropHint }}</span>
        </fieldset>
        <p v-if="espresso && steps.length" class="note small">
          Espresso recipes only use a pre-infusion time, so this recipe's {{ steps.length }} other step{{ steps.length === 1 ? '' : 's' }} will be removed when you save.
        </p>
        <label class="checkbox">
          <input v-model="showOnPublicMenu" type="checkbox" />
          Show on the public menu
        </label>
      </section>

      <section class="card stack">
        <div>
          <h2>Grind starting points</h2>
          <p class="muted small">
            An approximate setting to start from on each grinder. When brewing, your last actual setting with that grinder and recipe takes priority.
          </p>
        </div>
        <p v-if="grinders.length === 0" class="muted small">
          No grinders yet. <RouterLink :to="{ name: 'grinders' }">Add one</RouterLink> to save a starting point for it.
        </p>
        <ul v-if="grindRows.length" class="grind-rows">
          <li v-for="(row, i) in grindRows" :key="i" class="grind-row">
            <div class="field">
              <label :for="`grind-grinder-${i}`" class="visually-hidden">Grinder {{ i + 1 }}</label>
              <select :id="`grind-grinder-${i}`" v-model="row.grinderId">
                <option value="" disabled>Grinder…</option>
                <option v-for="g in grinderOptions(i)" :key="g.id" :value="g.id">{{ g.name }}{{ g.retiredAt ? ' (retired)' : '' }}</option>
              </select>
            </div>
            <div class="field">
              <label :for="`grind-setting-${i}`" class="visually-hidden">Starting setting for grinder {{ i + 1 }}</label>
              <input :id="`grind-setting-${i}`" v-model="row.setting" maxlength="100" placeholder="≈ setting" />
            </div>
            <button class="btn-link danger" type="button" :aria-label="`Remove starting point ${i + 1}`" @click="grindRows.splice(i, 1)">✕</button>
            <span v-if="submitted && grindErrors[i]" class="field-error full">{{ grindErrors[i] }}</span>
          </li>
        </ul>
        <button v-if="grinders.length" class="btn btn-secondary" type="button" :disabled="!canAddGrindRow" @click="addGrindRow">Add starting point</button>
      </section>

      <section v-if="!espresso" class="card stack">
        <div class="steps-head">
          <h2>Recipe steps</h2>
          <span class="muted small">Times from the start of the brew. Gaps between steps are waiting time.</span>
        </div>
        <p v-if="steps.length === 0" class="muted">No steps: the timer works as a stopwatch.</p>
        <p v-if="steps.length > 1" class="muted small">Drag ⠿ to reorder; times shift to fit, keeping each step's length and the wait before it.</p>
        <span class="visually-hidden" aria-live="polite">{{ moveAnnouncement }}</span>
        <VueDraggable
          v-if="steps.length"
          :model-value="steps"
          tag="ol"
          class="steps"
          handle=".drag-handle"
          :animation="150"
          ghost-class="drag-ghost"
          :custom-update="onDragUpdate"
        >
          <li v-for="(step, i) in steps" :key="step.key" class="step">
            <div class="step-side">
              <span class="num" aria-hidden="true">{{ i + 1 }}</span>
              <button
                class="drag-handle"
                type="button"
                :data-handle-index="i"
                @pointerdown="releaseFocus"
                :aria-label="`Move step ${i + 1}. Use the up and down arrow keys.`"
                @keydown.up.prevent="moveByKey(i, -1)"
                @keydown.down.prevent="moveByKey(i, 1)"
              >⠿</button>
            </div>
            <div class="step-fields">
              <div class="field">
                <label :for="`step-type-${i}`">Type</label>
                <select :id="`step-type-${i}`" v-model="step.stepType">
                  <option v-for="t in STEP_TYPE_ORDER" :key="t" :value="t">{{ STEP_TYPES[t].label }}</option>
                </select>
              </div>
              <div class="field">
                <label :for="`step-label-${i}`">Label <span class="muted">(optional)</span></label>
                <input :id="`step-label-${i}`" v-model="step.label" maxlength="255" :placeholder="STEP_TYPES[step.stepType].label" />
              </div>
              <div class="field">
                <label :for="`step-start-${i}`">Start</label>
                <input :id="`step-start-${i}`" v-model="step.start" inputmode="numeric" placeholder="m:ss" />
              </div>
              <div class="field">
                <label :for="`step-end-${i}`">End</label>
                <input :id="`step-end-${i}`" v-model="step.end" inputmode="numeric" placeholder="m:ss" />
              </div>
              <div v-if="STEP_TYPES[step.stepType].water !== 'none'" class="field pour-to">
                <label :for="`step-water-${i}`">
                  Pour to (g)<span v-if="STEP_TYPES[step.stepType].water === 'optional'" class="muted"> (optional)</span>
                </label>
                <div class="pour-row">
                  <input :id="`step-water-${i}`" v-model="step.water" inputmode="decimal" />
                  <span v-if="amounts[i] != null" class="amount" :aria-label="`adds ${amounts[i]} grams`">+{{ formatGrams(amounts[i]!) }} g</span>
                </div>
              </div>
              <span v-if="stepsParsed.errors[i]" class="field-error full">{{ stepsParsed.errors[i] }}</span>
            </div>
            <button class="btn-link danger" type="button" :aria-label="`Remove step ${i + 1}`" @click="removeStep(i)">✕</button>
            <!-- Inside the row (not a list item of its own) so drag indexes stay right. -->
            <button
              v-if="i < steps.length - 1"
              class="insert-here"
              type="button"
              :disabled="steps.length >= 20"
              :aria-label="`Add a step between steps ${i + 1} and ${i + 2}`"
              @click="insertAfter(i)"
            >
              <span>+ Add step here</span>
            </button>
          </li>
        </VueDraggable>
        <button class="btn btn-secondary" type="button" :disabled="steps.length >= 20" @click="addStep">Add step</button>
      </section>

      <ul v-if="warnings.length" class="warnings" aria-live="polite">
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !valid" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'recipes' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save recipe' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
}
p {
  margin: 0;
}
.note {
  margin: 0;
  color: var(--brand);
  background: var(--brand-tint);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
}
.small {
  font-size: 0.85rem;
}
.ratio {
  margin-top: calc(-1 * var(--space-2));
  color: var(--text-muted);
}
.ratio strong {
  color: var(--brand);
  font-size: 1.1rem;
}
.inline-add {
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
  grid-column: 1 / -1;
}
.grind-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.grind-row {
  display: grid;
  /* Grinder names are long; settings are short ("20", "4.2"). */
  grid-template-columns: minmax(0, 1fr) 5.5rem auto;
  align-items: center;
  gap: var(--space-2);
}
.steps-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2);
}
.step-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  margin-top: 1.6rem;
}
.drag-handle {
  width: var(--tap);
  height: var(--tap);
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 1.4rem;
  line-height: 1;
  cursor: grab;
  /* Stop the browser scrolling instead of dragging on touch screens. */
  touch-action: none;
}
.drag-handle:active {
  cursor: grabbing;
}
.insert-here {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap);
  margin-bottom: calc(-1 * var(--space-3));
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
/* A dashed rule on each side of the label, like a divider between steps. */
.insert-here::before,
.insert-here::after {
  content: '';
  flex: 1;
  border-top: 1px dashed var(--border);
}
.insert-here:hover:not(:disabled),
.insert-here:focus-visible {
  color: var(--brand);
}
.insert-here:hover:not(:disabled)::before,
.insert-here:hover:not(:disabled)::after {
  border-top-color: var(--brand);
}
.insert-here:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.drag-ghost {
  opacity: 0.4;
  background: var(--brand-tint);
  border-radius: var(--radius);
}
.finish {
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.finish legend {
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0;
  margin-bottom: var(--space-1);
}
.finish-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: var(--space-2);
}
.dash {
  padding-bottom: 0.6rem;
  color: var(--text-muted);
}
.num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
}
.step-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
.step-fields label {
  font-size: 0.8rem;
}
.pour-to {
  grid-column: 1 / -1;
}
.pour-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.pour-row input {
  flex: 1;
}
.amount {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--brand);
  font-variant-numeric: tabular-nums;
}
.warnings {
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5);
  border-radius: var(--radius);
  background: #fff8e1;
  color: #8d6e00;
  font-size: 0.95rem;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

<script setup lang="ts">
// Recipe editor (docs/api/recipes.md §5): dose + water (live ratio), optional
// expected yield / finish time / temperature, per-grinder grind starting
// points, and typed steps that run back to back (each with a time and how it
// moves on). Espresso brewers instead take dose + target shot weight (ratio
// dose:yield), a shot-time and first-drop window, and a shot profile
// (pre-infusion / soak / pressure / flow steps).
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { grindersApi } from '../api/grinders';
import { brewersApi } from '../api/brewers';
import { recipesApi, type RecipeInput } from '../api/recipes';
import type { Brewer, DilutionWith, FlowUnit, Grinder, MethodKind, Recipe, RecipeStyleItem, SteepTemp } from '../api/types';
import { DILUTION_WITH, isColdStyle, isLongStyle, STEEP_TEMPS } from '../lib/coldBrew';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import { formatGrams, formatGrind, formatRatio, formatTime, GRIND_SETTING, parseDecimal, parseTime, type Parsed } from '../lib/format';
import { VueDraggable } from 'vue-draggable-plus';
import {
  ADVANCE,
  advancesFor,
  FIRST_DROP_DEFAULT_SPREAD_SEC,
  FLOW_UNITS,
  formatFinishWindow,
  insertStepAfter,
  moveStep,
  newStepKey,
  parseFinishWindow,
  parseSteps,
  plannedStarts,
  pourAmounts,
  recipeWarnings,
  stepDraft,
  stepRules,
  STEP_TYPES,
  stepTypesFor,
  type StepDraft,
} from '../lib/steps';
import { useWorkspaceStore } from '../stores/workspace';
import { estimateYield, ratioWater, ROAST_LEVELS } from '../lib/scale';
import { parseTemp, tempText, TEMPERATURE_LABELS } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import { METHOD_KINDS, pickCopyBrewer } from '../lib/equipment';
import { recipeStylesApi } from '../api/recipeStyles';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const NEW_METHOD = '__new__';

const workspaces = useWorkspaceStore();
const { temperatureUnit, recipeRoastLevel } = usePreferences();
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => recipesApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => recipesApi.remove(workspaces.current?.id ?? '', props.id ?? '');
const route = useRoute();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const methods = ref<Brewer[]>([]);
// Active brewers, plus the recipe's own even if it's since been archived.
const brewerOptions = computed(() => methods.value.filter((m) => !m.archivedAt || m.id === brewerId.value));
const grinders = ref<Grinder[]>([]);
const name = ref('');
const brewerId = ref('');
const dose = ref('');
const water = ref('');
const ice = ref(''); // flash chilled: ice in the server (docs/api/recipes.md §5)
const expectedYield = ref('');
// Expected yield follows a light-roast estimate until typed over.
const yieldCustom = ref(false);
const finishFrom = ref('');
const finishTo = ref('');
const firstDropFrom = ref(''); // espresso only
const firstDropTo = ref('');
const flowUnit = ref<FlowUnit>('g_s'); // espresso flow steps
const style = ref(''); // a styleId: how the cup is brewed; '' = not set
const styles = ref<RecipeStyleItem[]>([]); // docs/api/recipe-styles.md §5e
const temp = ref('');
// Cold styles (lib/coldBrew.ts): steep window in hours, fridge or room, dilution.
const steepFrom = ref('');
const steepTo = ref('');
const steepTemp = ref<SteepTemp | ''>('');
const dilutionRatio = ref('');
const dilutionWith = ref<DilutionWith | ''>('');
const defaultGrinderId = ref(''); // '' = none: brewing uses the last grinder
const grindRows = ref<Array<{ grinderId: string; setting: string }>>([]);
const steps = ref<StepDraft[]>([]);

// Inline "add a brewer" (brewers are per-workspace equipment, §3).
const newMethodName = ref('');
const newMethodKind = ref<MethodKind>('filter');
const addingMethod = ref(false);
const methodError = ref('');
const newMethodInput = ref<HTMLInputElement | null>(null);

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const submitted = ref(false);

// The chosen brewer's kind decides the fields (docs/api/recipes.md §5).
const kind = computed<MethodKind | null>(() => methods.value.find((m) => m.id === brewerId.value)?.kind ?? null);
const espresso = computed(() => kind.value === 'espresso');
// The workspace's styles for the brewer's method: the visible ones, plus the
// recipe's own if it's hidden. A style that no longer fits is cleared.
const styleChoices = computed(() => styles.value.filter((s) => s.kind === kind.value && (!s.hidden || s.id === style.value)));
watch(kind, () => {
  if (style.value && styles.value.length && !styleChoices.value.some((s) => s.id === style.value)) style.value = '';
});
// What the chosen style brews like: long styles (cold brew, Kyoto drip) steep
// for hours with steps as a checklist; every cold style can be served diluted.
const brewsLike = computed(() => styles.value.find((s) => s.id === style.value)?.brewsLike ?? null);
const longStyle = computed(() => isLongStyle(brewsLike.value));
const coldStyle = computed(() => isColdStyle(brewsLike.value));

const grams = { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true } as const;
const STEEP_HOURS = { scale: 1, min: 0.5, max: 72 } as const;
const parsed = computed(() => ({
  dose: parseDecimal(dose.value, { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true }),
  water: espresso.value ? ({ ok: true, value: null } as const) : parseDecimal(water.value, grams),
  ice: !espresso.value && ice.value.trim() ? parseDecimal(ice.value, grams) : null,
  expectedYield: expectedYield.value.trim()
    ? parseDecimal(expectedYield.value, grams)
    : espresso.value
      ? ({ ok: false, error: 'Enter the target shot weight' } as const)
      : null,
  finish: parseFinishWindow(finishFrom.value, finishTo.value),
  firstDrop: espresso.value ? parseFinishWindow(firstDropFrom.value, firstDropTo.value, FIRST_DROP_DEFAULT_SPREAD_SEC) : ({ ok: true, value: null } as const),
  temp: temp.value.trim() ? parseTemp(temp.value, temperatureUnit.value) : null,
  steepMin: steepFrom.value.trim() ? parseDecimal(steepFrom.value, STEEP_HOURS) : null,
  steepMax: steepTo.value.trim() ? parseDecimal(steepTo.value, STEEP_HOURS) : null,
  dilution: dilutionRatio.value.trim() ? parseDecimal(dilutionRatio.value, { scale: 1, min: 0, max: 10, exclusiveMin: true }) : null,
}));
// A long style's steps are a checklist: no times, each waits for you.
const stepsParsed = computed(() =>
  parseSteps(longStyle.value ? steps.value.map((d) => ({ ...d, advance: 'tap' as const, duration: '' })) : steps.value, kind.value, temperatureUnit.value),
);
// "+X g" next to each pour-to, from whatever has been typed so far (even if
// another field in that row still has an error).
const amounts = computed(() =>
  pourAmounts(
    steps.value.map((d) => {
      if (stepRules(d.stepType, kind.value).water === 'none') return { targetWaterGrams: null };
      const w = parseDecimal(d.water, grams);
      return { targetWaterGrams: w.ok ? w.value : null };
    }),
  ),
);

const grindErrors = computed(() =>
  grindRows.value.map((row, i) => {
    if (!row.grinderId) return 'Choose a grinder';
    if (!row.setting.trim()) return 'Enter a setting';
    const setting = parseDecimal(row.setting, GRIND_SETTING);
    if (!setting.ok) return setting.error;
    if (grindRows.value.findIndex((r) => r.grinderId === row.grinderId) !== i) return 'This grinder is already listed';
    return '';
  }),
);

const fieldErrors = computed(() => {
  const p = parsed.value;
  return {
    name: name.value.trim() ? '' : 'Required',
    brewer: brewerId.value && brewerId.value !== NEW_METHOD ? '' : 'Choose a brewer',
    dose: p.dose.ok ? '' : p.dose.error,
    water: p.water.ok ? '' : p.water.error,
    ice: p.ice && !p.ice.ok ? p.ice.error : '',
    expectedYield: p.expectedYield && !p.expectedYield.ok ? p.expectedYield.error : '',
    finish: p.finish.ok ? '' : p.finish.error,
    firstDrop: p.firstDrop.ok ? '' : p.firstDrop.error,
    temp: p.temp && !p.temp.ok ? p.temp.error : '',
    steep: steepError(p.steepMin, p.steepMax),
    dilution: p.dilution && !p.dilution.ok ? p.dilution.error : '',
  };
});
function steepError(min: Parsed<number> | null, max: Parsed<number> | null): string {
  if (!longStyle.value) return '';
  if (min && !min.ok) return `From: ${min.error}`;
  if (max && !max.ok) return `To: ${max.error}`;
  if (!min !== !max) return 'Enter both ends, or neither';
  if (min?.ok && max?.ok && min.value > max.value) return '"To" must not be less than "from"';
  return '';
}
const valid = computed(
  () =>
    Object.values(fieldErrors.value).every((e) => !e) &&
    grindErrors.value.every((e) => !e) &&
    Object.keys(stepsParsed.value.errors).length === 0,
);
// The ice typed (flash chilled), 0 without; the ratio and the yield count it.
const iceGrams = computed(() => (parsed.value.ice?.ok ? parsed.value.ice.value : 0));
const liquid = computed(() => (parsed.value.water.ok && parsed.value.water.value !== null ? ratioWater(parsed.value.water.value, iceGrams.value) : null));
// Coffee:water (and ice), or for espresso coffee:shot weight.
const ratio = computed(() => {
  const p = parsed.value;
  if (!p.dose.ok) return null;
  const out = espresso.value ? (p.expectedYield?.ok ? p.expectedYield.value : null) : liquid.value;
  return out === null ? null : formatRatio(p.dose.value, out);
});
// Filter only: espresso's yield is a target, not an estimate.
const yieldEstimate = computed(() =>
  !espresso.value && parsed.value.dose.ok && liquid.value !== null
    ? estimateYield(parsed.value.dose.value, liquid.value, ROAST_LEVELS[recipeRoastLevel.value].retention)
    : null,
);
const expectedYieldValue = computed(() => (parsed.value.expectedYield?.ok ? parsed.value.expectedYield.value : null));
watch(yieldEstimate, (est) => {
  if (!yieldCustom.value) expectedYield.value = est === null ? '' : formatGrams(est);
}, { immediate: true });
watch(yieldCustom, (custom) => {
  if (!custom) expectedYield.value = yieldEstimate.value === null ? '' : formatGrams(yieldEstimate.value);
});
// Pour checks don't apply to espresso (no water).
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
  return grinders.value.filter((g) => (!g.archivedAt || g.id === current) && !used.has(g.id));
}
const canAddGrindRow = computed(() => grinders.value.some((g) => !g.archivedAt && !grindRows.value.some((r) => r.grinderId === g.id)));

// Duplicating: the original's name, for the heading.
const copyOf = ref<string | null>(null);

// Optional fields the workspace hides (Settings → Fields); ones this recipe
// already sets stay shown. A filter recipe's expected yield is estimated
// when hidden, so only one typed by hand reveals it.
const { show, reveal } = useFieldVisibility();

function fill(recipe: Recipe): void {
  name.value = recipe.name;
  brewerId.value = recipe.brewer.id;
  dose.value = formatGrams(recipe.targetDoseGrams);
  water.value = recipe.targetWaterGrams === null ? '' : formatGrams(recipe.targetWaterGrams);
  ice.value = recipe.targetIceGrams === null ? '' : formatGrams(recipe.targetIceGrams);
  expectedYield.value = recipe.expectedYieldGrams === null ? '' : formatGrams(recipe.expectedYieldGrams);
  // A saved yield that isn't the estimate was typed by someone: keep it.
  yieldCustom.value = recipe.expectedYieldGrams !== null && recipe.expectedYieldGrams !== yieldEstimate.value;
  finishFrom.value = recipe.expectedFinishMinSec === null ? '' : formatTime(recipe.expectedFinishMinSec);
  finishTo.value = recipe.expectedFinishMaxSec === null ? '' : formatTime(recipe.expectedFinishMaxSec);
  firstDropFrom.value = recipe.firstDropMinSec === null ? '' : formatTime(recipe.firstDropMinSec);
  firstDropTo.value = recipe.firstDropMaxSec === null ? '' : formatTime(recipe.firstDropMaxSec);
  temp.value = tempText(recipe.targetTempC, temperatureUnit.value);
  defaultGrinderId.value = recipe.defaultGrinderId ?? '';
  grindRows.value = recipe.grindSettings.map((g) => ({ grinderId: g.grinderId, setting: formatGrind(g.setting) }));
  flowUnit.value = recipe.flowUnit;
  style.value = recipe.style?.id ?? '';
  steepFrom.value = recipe.steepMinHours === null ? '' : String(recipe.steepMinHours);
  steepTo.value = recipe.steepMaxHours === null ? '' : String(recipe.steepMaxHours);
  steepTemp.value = recipe.steepTemp ?? '';
  dilutionRatio.value = recipe.dilutionRatio === null ? '' : String(recipe.dilutionRatio);
  dilutionWith.value = recipe.dilutionWith ?? '';
  steps.value = recipe.steps.map((s) => stepDraft(newStepKey(), s, temperatureUnit.value));
  reveal({
    'recipe.style': recipe.style,
    'recipe.ice': recipe.targetIceGrams,
    'recipe.expectedYield': recipe.targetWaterGrams !== null && yieldCustom.value,
    'recipe.temp': recipe.targetTempC,
    'recipe.finishWindow': recipe.expectedFinishMinSec,
    'recipe.firstDropWindow': recipe.firstDropMinSec,
    'recipe.defaultGrinder': recipe.defaultGrinderId,
    'recipe.grindSettings': recipe.grindSettings,
    'recipe.flowUnit': recipe.flowUnit !== 'g_s',
    'recipe.stepTemp': recipe.steps.some((s) => s.targetTempC !== null),
    'recipe.steepWindow': recipe.steepMinHours,
    'recipe.steepTemp': recipe.steepTemp,
    'recipe.dilution': recipe.dilutionRatio,
  });
}

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [methodList, grinderList, recipeList, styleList] = await Promise.all([
      brewersApi.list(ws),
      grindersApi.list(ws),
      editing.value || route.query.from ? recipesApi.list(ws) : Promise.resolve(null),
      recipeStylesApi.list(ws),
    ]);
    styles.value = styleList.styles;
    methods.value = methodList.brewers;
    grinders.value = grinderList.grinders;
    if (editing.value) {
      const recipe = recipeList?.recipes.find((r) => r.id === props.id);
      if (!recipe) {
        error.value = 'This recipe no longer exists.';
        return;
      }
      saved.value = { name: recipe.name, archived: !!recipe.archivedAt };
      fill(recipe);
      return;
    }
    // Duplicate: a copy of that recipe, starting on another brewer of the same
    // kind if there is one (e.g. a second espresso machine).
    const from = recipeList?.recipes.find((r) => r.id === route.query.from);
    if (from) {
      fill(from);
      name.value = `${from.name} (copy)`;
      brewerId.value = pickCopyBrewer(methods.value, from.brewer);
      copyOf.value = from.name;
    }
    // From brew setup's "add a recipe" for a brewer that has none.
    const brewer = methods.value.find((m) => m.id === route.query.brewer && !m.archivedAt);
    if (!from && brewer) brewerId.value = brewer.id;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function onMethodChange(): Promise<void> {
  if (brewerId.value !== NEW_METHOD) return;
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
    const { brewer } = await brewersApi.create(ws, { name: trimmed, kind: newMethodKind.value });
    methods.value = [...methods.value, brewer].sort((a, b) => a.name.localeCompare(b.name));
    brewerId.value = brewer.id;
    newMethodName.value = '';
  } catch (err) {
    methodError.value =
      err instanceof ApiError && err.status === 409 ? 'That brewer already exists. Pick it from the list.' : errorMessage(err);
  } finally {
    addingMethod.value = false;
  }
}

function addGrindRow(): void {
  const next = grinders.value.find((g) => !g.archivedAt && !grindRows.value.some((r) => r.grinderId === g.id));
  grindRows.value.push({ grinderId: next?.id ?? '', setting: '' });
}

// New steps at the end. Pour over: a 30 s bloom first (2-3x the dose in
// water), then 30 s pours to the running total. Espresso: full pressure until
// first drop first, then a 10 s soak.
function addStep(): void {
  const key = newStepKey();
  const first = steps.value.length === 0;
  if (espresso.value) {
    steps.value.push(
      first
        ? stepDraft(key, { stepType: 'pressure', pressureBar: 9, advance: 'first_drop', durationSec: null })
        : stepDraft(key, { stepType: 'soak', durationSec: 10 }),
    );
    return;
  }
  const lastWater = [...stepsParsed.value.steps].reverse().find((s) => s.targetWaterGrams !== null)?.targetWaterGrams ?? null;
  const doseValue = parsed.value.dose.ok ? parsed.value.dose.value : null;
  steps.value.push(
    first
      ? stepDraft(key, { stepType: 'bloom', durationSec: 30, targetWaterGrams: doseValue ? Math.round(doseValue * 3) : null })
      : stepDraft(key, { stepType: 'pour', durationSec: 30, targetWaterGrams: lastWater }),
  );
}

// When each row is planned to start, from the times typed so far.
const starts = computed(() =>
  plannedStarts(
    steps.value.map((d) => {
      const t = d.duration.trim() ? parseTime(d.duration) : null;
      return { durationSec: t?.ok ? t.value : null, advance: d.advance };
    }),
  ),
);
function startsText(i: number): string {
  if (i === 0) return 'Starts at 0:00';
  const at = starts.value[i];
  return at ? `Starts ${at.exact ? 'at' : '≈'} ${formatTime(at.at)}` : `Starts after step ${i}`;
}
// The time field means a length, or only a guide for steps that wait.
function timeLabel(step: StepDraft): string {
  return step.advance === 'tap' || step.advance === 'first_drop' ? 'About' : 'Time';
}
// A step's time is needed unless it's a guide (tap, first drop) or the last
// auto step ("until done").
function timeRequired(step: StepDraft, i: number): boolean {
  return !(step.advance === 'tap' || step.advance === 'first_drop' || (step.advance === 'auto' && i === steps.value.length - 1));
}

// "+ Add step here" between steps (nothing needs re-timing: steps run back to back).
async function insertAfter(index: number): Promise<void> {
  const result = insertStepAfter(steps.value, index, newStepKey(), kind.value);
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
// moveStep (steps run back to back, so only the order changes).
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
    brewerId: brewerId.value,
    targetDoseGrams: p.dose.value,
    targetWaterGrams: p.water.value,
    targetIceGrams: p.ice?.ok ? p.ice.value : null,
    expectedYieldGrams: p.expectedYield?.ok ? p.expectedYield.value : null,
    expectedFinishMinSec: p.finish.ok ? (p.finish.value?.min ?? null) : null,
    expectedFinishMaxSec: p.finish.ok ? (p.finish.value?.max ?? null) : null,
    firstDropMinSec: p.firstDrop.ok ? (p.firstDrop.value?.min ?? null) : null,
    firstDropMaxSec: p.firstDrop.ok ? (p.firstDrop.value?.max ?? null) : null,
    // A long steep has no water temperature or finish in minutes, but a window in hours.
    ...(longStyle.value ? { targetTempC: null, expectedFinishMinSec: null, expectedFinishMaxSec: null } : { targetTempC: p.temp?.ok ? p.temp.value : null }),
    steepMinHours: longStyle.value && p.steepMin?.ok ? p.steepMin.value : null,
    steepMaxHours: longStyle.value && p.steepMax?.ok ? p.steepMax.value : null,
    steepTemp: longStyle.value ? steepTemp.value || null : null,
    dilutionRatio: coldStyle.value && p.dilution?.ok ? p.dilution.value : null,
    dilutionWith: coldStyle.value && p.dilution?.ok ? dilutionWith.value || null : null,
    defaultGrinderId: defaultGrinderId.value || null,
    // grindErrors has checked every row parses.
    grindSettings: grindRows.value.map((r) => {
      const setting = parseDecimal(r.setting, GRIND_SETTING);
      return { grinderId: r.grinderId, setting: setting.ok ? setting.value : 0 };
    }),
    flowUnit: flowUnit.value,
    styleId: style.value || null,
    steps: stepsParsed.value.steps,
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
      <h1>{{ editing ? 'Edit recipe' : copyOf ? 'Duplicate recipe' : 'Add recipe' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="name" aria-required="true" v-model="name" maxlength="255" placeholder="e.g. House V60" :aria-invalid="submitted && !!fieldErrors.name" />
          <span v-if="submitted && fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </div>

        <div class="field">
          <label for="method">Brewer<span class="req" aria-hidden="true">*</span></label>
          <select id="method" aria-required="true" v-model="brewerId" :aria-invalid="submitted && !!fieldErrors.brewer" @change="onMethodChange">
            <option value="" disabled>Choose…</option>
            <option v-for="m in brewerOptions" :key="m.id" :value="m.id">{{ m.name }}{{ m.archivedAt ? ' (archived)' : '' }}</option>
            <option :value="NEW_METHOD">+ Add a brewer…</option>
          </select>
          <span v-if="copyOf" class="hint">A copy of {{ copyOf }}. Pick the brewer for the copy; the original stays as it is.</span>
          <span v-if="submitted && fieldErrors.brewer" class="field-error">{{ fieldErrors.brewer }}</span>
        </div>
        <div v-if="styleChoices.length && show('recipe.style')" class="field">
          <label for="style">Style</label>
          <select id="style" v-model="style">
            <option value="">Not set</option>
            <option v-for="st in styleChoices" :key="st.id" :value="st.id">{{ st.name }}</option>
          </select>
          <span class="hint">How this recipe brews ({{ kind === 'espresso' ? 'a standard shot or a soup shot' : 'pour over, immersion, cold brew…' }}), for your lists and the AI.</span>
        </div>
        <div v-if="brewerId === NEW_METHOD" class="inline-add">
          <div class="field grow">
            <label for="new-method">New brewer name<span class="req" aria-hidden="true">*</span></label>
            <input id="new-method" aria-required="true" ref="newMethodInput" v-model="newMethodName" maxlength="100" placeholder="e.g. Chemex" @keydown.enter.prevent="addMethod" />
          </div>
          <div class="field">
            <label for="new-method-kind">Brew method<span class="req" aria-hidden="true">*</span></label>
            <select id="new-method-kind" aria-required="true" v-model="newMethodKind">
              <option v-for="(k, key) in METHOD_KINDS" :key="key" :value="key">{{ k.label }}</option>
            </select>
          </div>
          <button class="btn btn-secondary" type="button" :disabled="addingMethod || !newMethodName.trim()" @click="addMethod">Add</button>
          <span v-if="methodError" class="field-error full">{{ methodError }}</span>
        </div>

        <div class="form-row">
          <div class="field">
            <label for="dose">Dose (g)<span class="req" aria-hidden="true">*</span></label>
            <input id="dose" aria-required="true" v-model="dose" inputmode="decimal" placeholder="15" :aria-invalid="submitted && !!fieldErrors.dose" />
            <span v-if="submitted && fieldErrors.dose" class="field-error">{{ fieldErrors.dose }}</span>
          </div>
          <div v-if="espresso" class="field">
            <label for="expected-yield">Shot weight (g)<span class="req" aria-hidden="true">*</span></label>
            <input id="expected-yield" aria-required="true" v-model="expectedYield" inputmode="decimal" placeholder="36" :aria-invalid="submitted && !!fieldErrors.expectedYield" @input="yieldCustom = true" />
            <span v-if="submitted && fieldErrors.expectedYield" class="field-error">{{ fieldErrors.expectedYield }}</span>
          </div>
          <div v-else class="field">
            <label for="water">{{ iceGrams > 0 ? 'Hot water (g)' : 'Water (g)' }}<span class="req" aria-hidden="true">*</span></label>
            <input id="water" aria-required="true" v-model="water" inputmode="decimal" placeholder="250" :aria-invalid="submitted && !!fieldErrors.water" />
            <span v-if="submitted && fieldErrors.water" class="field-error">{{ fieldErrors.water }}</span>
          </div>
          <div v-if="!espresso && show('recipe.ice')" class="field">
            <label for="ice">Ice (g)</label>
            <input id="ice" v-model="ice" inputmode="decimal" placeholder="none" :aria-invalid="submitted && !!fieldErrors.ice" />
            <span v-if="submitted && fieldErrors.ice" class="field-error">{{ fieldErrors.ice }}</span>
            <span v-else class="hint">Flash chilled: in the server, brewed onto</span>
          </div>
        </div>
        <p class="ratio" aria-live="polite">
          {{ espresso ? 'Coffee : shot' : iceGrams > 0 ? 'Coffee : water + ice' : 'Coffee : water' }} <strong>{{ ratio ?? '–' }}</strong>
          <span v-if="iceGrams > 0 && liquid !== null" class="muted small">({{ formatGrams(liquid) }} g; the pours count the hot water only)</span>
        </p>

        <div v-if="(!espresso && show('recipe.expectedYield')) || (show('recipe.temp') && !longStyle)" class="form-row">
          <div v-if="!espresso && show('recipe.expectedYield')" class="field">
            <label for="expected-yield">Expected yield (g)</label>
            <input id="expected-yield" v-model="expectedYield" inputmode="decimal" placeholder="e.g. 220" :aria-invalid="submitted && !!fieldErrors.expectedYield" @input="yieldCustom = true" />
            <span v-if="submitted && fieldErrors.expectedYield" class="field-error">{{ fieldErrors.expectedYield }}</span>
            <span v-else-if="!yieldCustom && yieldEstimate !== null" class="muted small">Estimated for a {{ ROAST_LEVELS[recipeRoastLevel].label.toLowerCase() }} roast</span>
            <button v-else-if="yieldCustom && yieldEstimate !== null && expectedYieldValue !== yieldEstimate" class="btn-link small yield-reset" type="button" @click="yieldCustom = false">
              Use estimate ({{ formatGrams(yieldEstimate) }} g)
            </button>
          </div>
          <div v-if="show('recipe.temp') && !longStyle" class="field">
            <label for="temp">Water temp ({{ TEMPERATURE_LABELS[temperatureUnit] }})</label>
            <input id="temp" v-model="temp" inputmode="decimal" :placeholder="temperatureUnit === 'f' ? '201' : '94'" :aria-invalid="submitted && !!fieldErrors.temp" />
            <span v-if="submitted && fieldErrors.temp" class="field-error">{{ fieldErrors.temp }}</span>
          </div>
        </div>
        <!-- Long cold styles steep for hours (lib/coldBrew.ts): a window in hours and fridge or room. -->
        <fieldset v-if="longStyle && show('recipe.steepWindow')" class="finish">
          <legend>Steep for</legend>
          <div class="finish-row">
            <div class="field">
              <label for="steep-from">From (h)</label>
              <input id="steep-from" v-model="steepFrom" inputmode="decimal" placeholder="12" :aria-invalid="submitted && !!fieldErrors.steep" />
            </div>
            <span class="dash" aria-hidden="true">–</span>
            <div class="field">
              <label for="steep-to">To (h)</label>
              <input id="steep-to" v-model="steepTo" inputmode="decimal" placeholder="18" :aria-invalid="submitted && !!fieldErrors.steep" />
            </div>
          </div>
          <span v-if="fieldErrors.steep && (submitted || (steepFrom.trim() && steepTo.trim()))" class="field-error">{{ fieldErrors.steep }}</span>
          <span v-else class="hint">You get a reminder when it opens (Settings → Notifications).</span>
        </fieldset>
        <div v-if="longStyle && show('recipe.steepTemp')" class="field">
          <label for="steep-temp">Steep in</label>
          <select id="steep-temp" v-model="steepTemp">
            <option value="">Not set</option>
            <option v-for="(label, key) in STEEP_TEMPS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <fieldset v-if="coldStyle && show('recipe.dilution')" class="finish">
          <legend>Serve diluted</legend>
          <div class="finish-row">
            <div class="field">
              <label for="dilution-ratio">1 :</label>
              <input id="dilution-ratio" v-model="dilutionRatio" inputmode="decimal" placeholder="1" :aria-invalid="submitted && !!fieldErrors.dilution" />
            </div>
            <div class="field">
              <label for="dilution-with">with</label>
              <select id="dilution-with" v-model="dilutionWith">
                <option value="">Not set</option>
                <option v-for="(label, key) in DILUTION_WITH" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
          </div>
          <span v-if="fieldErrors.dilution" class="field-error">{{ fieldErrors.dilution }}</span>
          <span v-else class="hint">Parts added per part of concentrate, e.g. 1 for half and half. Leave empty if it's served as it is.</span>
        </fieldset>
        <fieldset v-if="show('recipe.finishWindow') && !longStyle" class="finish">
          <legend>{{ espresso ? 'Target shot time' : 'Target finish' }}</legend>
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
        <fieldset v-if="espresso && show('recipe.firstDropWindow')" class="finish">
          <legend>First drop</legend>
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
      </section>

      <section v-if="show('recipe.defaultGrinder') || show('recipe.grindSettings')" class="card stack">
        <div>
          <h2>{{ show('recipe.grindSettings') ? 'Grind starting points' : 'Grinder' }}</h2>
          <p v-if="show('recipe.grindSettings')" class="muted small">
            An approximate setting to start from on each grinder. When brewing, your last actual setting with that grinder and recipe takes priority.
          </p>
        </div>
        <p v-if="grinders.length === 0" class="muted small">
          No grinders yet. <RouterLink :to="{ name: 'grinder-new' }">Add one</RouterLink> to save a starting point for it.
        </p>
        <div v-else-if="show('recipe.defaultGrinder')" class="field">
          <label for="default-grinder">Default grinder</label>
          <select id="default-grinder" v-model="defaultGrinderId">
            <option value="">None: use the last grinder</option>
            <option v-for="g in grinders.filter((x) => !x.archivedAt || x.id === defaultGrinderId)" :key="g.id" :value="g.id">
              {{ g.name }}{{ g.archivedAt ? ' (archived)' : '' }}
            </option>
          </select>
          <span class="hint">Selected for you when you brew this recipe.</span>
        </div>
        <ul v-if="grindRows.length && show('recipe.grindSettings')" class="grind-rows">
          <li v-for="(row, i) in grindRows" :key="i" class="grind-row">
            <div class="field">
              <label :for="`grind-grinder-${i}`" class="visually-hidden">Grinder {{ i + 1 }}</label>
              <select :id="`grind-grinder-${i}`" v-model="row.grinderId">
                <option value="" disabled>Grinder…</option>
                <option v-for="g in grinderOptions(i)" :key="g.id" :value="g.id">{{ g.name }}{{ g.archivedAt ? ' (archived)' : '' }}</option>
              </select>
            </div>
            <div class="field">
              <label :for="`grind-setting-${i}`" class="visually-hidden">Starting setting for grinder {{ i + 1 }}</label>
              <input :id="`grind-setting-${i}`" v-model="row.setting" inputmode="decimal" placeholder="≈ setting" />
            </div>
            <button class="btn-link danger" type="button" :aria-label="`Remove starting point ${i + 1}`" @click="grindRows.splice(i, 1)">✕</button>
            <span v-if="submitted && grindErrors[i]" class="field-error full">{{ grindErrors[i] }}</span>
          </li>
        </ul>
        <button v-if="grinders.length && show('recipe.grindSettings')" class="btn btn-secondary" type="button" :disabled="!canAddGrindRow" @click="addGrindRow">Add starting point</button>
      </section>

      <section class="card stack">
        <div class="steps-head">
          <h2>{{ espresso ? 'Shot profile' : 'Recipe steps' }}</h2>
          <span v-if="longStyle" class="muted small">A checklist for starting and finishing the steep (no timer): stir, cover, filter twice…</span>
          <span v-else class="muted small">
            Steps run one after another. Each moves on by itself after its time, or waits for your tap{{ espresso ? ' or the first drop' : '' }}.
          </span>
        </div>
        <div v-if="espresso && show('recipe.flowUnit')" class="field flow-unit">
          <label for="flow-unit">Flow unit</label>
          <select id="flow-unit" v-model="flowUnit">
            <option value="g_s">g/s (scale)</option>
            <option value="ml_s">ml/s (flow meter)</option>
          </select>
        </div>
        <p v-if="steps.length === 0" class="muted">
          {{ espresso ? 'No steps: the shot timer just times the shot and records the first drop.' : 'No steps: the timer works as a stopwatch.' }}
        </p>
        <p v-if="steps.length > 1" class="muted small">Drag ⠿ to reorder.</p>
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
              <div class="field full">
                <label :for="`step-type-${i}`">Type<span class="req" aria-hidden="true">*</span></label>
                <select :id="`step-type-${i}`" aria-required="true" v-model="step.stepType">
                  <option v-for="t in stepTypesFor(kind)" :key="t" :value="t">{{ STEP_TYPES[t].label }}</option>
                  <option v-if="!stepTypesFor(kind).includes(step.stepType)" :value="step.stepType" disabled>{{ STEP_TYPES[step.stepType].label }}</option>
                </select>
              </div>
              <div v-if="!longStyle" class="field">
                <label :for="`step-time-${i}`">{{ timeLabel(step) }}<span v-if="timeRequired(step, i)" class="req" aria-hidden="true">*</span></label>
                <input :id="`step-time-${i}`" :aria-required="timeRequired(step, i)" v-model="step.duration" inputmode="numeric" :placeholder="step.advance === 'auto' && i === steps.length - 1 ? 'until done' : 'm:ss'" />
              </div>
              <div v-if="!longStyle" class="field">
                <label :for="`step-advance-${i}`">Moves on</label>
                <select :id="`step-advance-${i}`" v-model="step.advance">
                  <option v-for="a in advancesFor(kind)" :key="a" :value="a">{{ ADVANCE[a].label }}</option>
                </select>
              </div>
              <p v-if="!longStyle" class="step-when muted full">{{ startsText(i) }} · {{ ADVANCE[step.advance].hint }}</p>
              <div v-if="stepRules(step.stepType, kind).water !== 'none'" class="field">
                <label :for="`step-water-${i}`">
                  Pour to (g)<span v-if="stepRules(step.stepType, kind).water === 'required'" class="req" aria-hidden="true">*</span>
                </label>
                <div class="pour-row">
                  <input :id="`step-water-${i}`" :aria-required="stepRules(step.stepType, kind).water === 'required'" v-model="step.water" inputmode="decimal" />
                  <span v-if="amounts[i] != null" class="amount" :aria-label="`adds ${amounts[i]} grams`">+{{ formatGrams(amounts[i]!) }} g</span>
                </div>
              </div>
              <template v-if="stepRules(step.stepType, kind).pressure !== 'none'">
                <div class="field">
                  <label :for="`step-pressure-${i}`">Pressure (bar)<span v-if="stepRules(step.stepType, kind).pressure === 'required'" class="req" aria-hidden="true">*</span></label>
                  <input :id="`step-pressure-${i}`" :aria-required="stepRules(step.stepType, kind).pressure === 'required'" v-model="step.pressure" inputmode="decimal" placeholder="e.g. 9" />
                </div>
                <div class="field">
                  <label :for="`step-pressure-end-${i}`">Ramp to</label>
                  <input :id="`step-pressure-end-${i}`" v-model="step.pressureEnd" inputmode="decimal" placeholder="e.g. 6" />
                </div>
              </template>
              <template v-if="stepRules(step.stepType, kind).flow !== 'none'">
                <div class="field">
                  <label :for="`step-flow-${i}`">Flow ({{ FLOW_UNITS[flowUnit] }})<span v-if="stepRules(step.stepType, kind).flow === 'required'" class="req" aria-hidden="true">*</span></label>
                  <input :id="`step-flow-${i}`" :aria-required="stepRules(step.stepType, kind).flow === 'required'" v-model="step.flow" inputmode="decimal" placeholder="e.g. 4" />
                </div>
                <div class="field">
                  <label :for="`step-flow-end-${i}`">Ramp to</label>
                  <input :id="`step-flow-end-${i}`" v-model="step.flowEnd" inputmode="decimal" placeholder="e.g. 2" />
                </div>
              </template>
              <div class="field">
                <label :for="`step-label-${i}`">Label</label>
                <input :id="`step-label-${i}`" v-model="step.label" maxlength="255" :placeholder="STEP_TYPES[step.stepType].label" />
              </div>
              <div v-if="show('recipe.stepTemp')" class="field">
                <label :for="`step-temp-${i}`">Temp ({{ TEMPERATURE_LABELS[temperatureUnit] }})</label>
                <input :id="`step-temp-${i}`" v-model="step.temp" inputmode="decimal" :placeholder="temperatureUnit === 'f' ? 'e.g. 199' : 'e.g. 93'" />
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
    <DeleteSection
      v-if="props.id && saved && workspaces.canEdit"
      kind="recipe"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'recipes' }"
    />
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
.step-when {
  margin: calc(-1 * var(--space-1)) 0 0;
  font-size: 0.8rem;
}
.full {
  grid-column: 1 / -1;
}
.flow-unit {
  max-width: 14rem;
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
  color: var(--on-brand);
  font-size: 0.85rem;
  font-weight: 700;
}
/* Right column a bit wider: "Moves on" options like "First drop" fit on a phone. */
.step-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
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
  background: var(--warning-tint);
  color: var(--warning);
  font-size: 0.95rem;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

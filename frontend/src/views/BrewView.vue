<script setup lang="ts">
// The brew flow: set up (bean, recipe, AI starting point) -> timer -> log -> saved
// (+ optional AI suggestion for next time). docs/api/README.md §6/§8,
// docs/timer_architecture.md.
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { beansApi } from '../api/beans';
import { brewLogsApi, suggestionsApi } from '../api/brews';
import { ApiError, errorMessage } from '../api/client';
import { recipesApi } from '../api/recipes';
import type { Bean, BrewLog, Recipe, BrewerMethod } from '../api/types';
import AnalysisCard from '../components/AnalysisCard.vue';
import RepeatBrewPicker from '../components/RepeatBrewPicker.vue';
import { recentByMade, repeatLabel, repeatPlan } from '../lib/repeatBrew';
import { grindersApi } from '../api/grinders';
import { waterProfilesApi } from '../api/waterProfiles';
import { prepToolsApi } from '../api/prepTools';
import { brewProblemsApi } from '../api/brewProblems';
import { defaultWaterProfileId } from '../lib/water';
import { brewerMethodsApi } from '../api/brewerMethods';
import { brewersApi } from '../api/brewers';
import { drinksApi } from '../api/drinks';
import { drinkCategoriesApi } from '../api/drinkCategories';
import { ingredientLine } from '../lib/drinks';
import {
  brewable,
  brewerOptions,
  decodeItem,
  decodeWhat,
  encodeDrink,
  itemOptions,
  itemValues,
  NO_RECIPE,
  pickBrewer,
  pickRecipe,
  recipeOptions,
  validItem,
  validWhat,
  whatOptions,
  methodKind,
} from '../lib/brewChoice';
import type { Brewer, BrewProblem, Drink, DrinkCategory, Grinder, Mark, MethodKind, NotificationChannel, PrepTool, ServingUnit, WaterProfile } from '../api/types';
import { METHOD_KINDS } from '../lib/equipment';
import { convertSize, defaultSize, formatSize, SERVING_UNITS, sizeFactor, type Size } from '../lib/servings';
import AppHeader from '../components/AppHeader.vue';
import BrewFields from '../components/BrewFields.vue';
import BrewTimer from '../components/BrewTimer.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import FinishDrinkCard from '../components/FinishDrinkCard.vue';
import { useBrewSessionStore } from '../stores/brewSession';
import { formatMark } from '../lib/marks';
import { formatFinishWindow, parseFinishWindow, stepTitle } from '../lib/steps';
import { useAnalysis } from '../composables/useAnalysis';
import { emptyDraft, parseBrewDraft } from '../lib/brewDraft';
import { hoursText, isColdStyle, isLongStyle, parseSteepWindow, STEEP_TEMPS, steepWindowText } from '../lib/coldBrew';
import type { BrewLogInput, Reminder } from '../api/brews';
import { notificationsApi } from '../api/notifications';
import { canRemind, formatDelay } from '../lib/notifications';
import { useAuthStore } from '../stores/auth';
import { DEFAULT_PREFERENCES } from '../composables/usePreferences';
import { grinderRetentionText } from '../lib/grinderRetention';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import { batchSuffix, beanLabel as pickerLabel } from '../lib/beans';
import { formatDay, formatDoseLine, formatGrams, formatGrind, formatTime, formatWhen } from '../lib/format';
import { chooseGrind, startingParameters, suggestionFitsGrinder, type GrindSource, type StartingParameters } from '../lib/suggest';
import { useWorkspaceStore } from '../stores/workspace';
import { brewRetention, linkRatio, ratioText as formatRatio, ROAST_LEVELS, scaleBatch, scaleShot, scaleSteps, type MeasuredBrew, type ScaleField } from '../lib/scale';
import { formatTemp, formatTempChange, tempText, TEMPERATURE_LABELS, VOLUME_LABELS, volumeUnits } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';

// 'steep': starting a long cold brew (a checklist, then it's saved steeping).
type Stage = 'setup' | 'timing' | 'log' | 'steep' | 'saved';

const workspaces = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const { prefs, temperatureUnit, recipeRoastLevel } = usePreferences();
const stage = ref<Stage>('setup');
const loading = ref(true);
const loadError = ref('');
const beans = ref<Bean[]>([]);
const recipes = ref<Recipe[]>([]);
const grinders = ref<Grinder[]>([]);
const waterProfiles = ref<WaterProfile[]>([]);
const prepTools = ref<PrepTool[]>([]);
const problems = ref<BrewProblem[]>([]);
const brewers = ref<Brewer[]>([]);

// Setup
const beanId = ref('');
const recipeId = ref('');
// Category → Drink → Brewer → Recipe (lib/brewChoice.ts): e.g. Specialty
// Drinks → The Atlas → V60 or Chemex, or Pour Over → Just pour over → V60;
// then one of the brewer's recipes (a drink's default preselected;
// docs/api/drinks.md §5c). Or no recipe.
const drinks = ref<Drink[]>([]);
const categories = ref<DrinkCategory[]>([]);
const methods = ref<BrewerMethod[]>([]); // names and order for "What are you making?"
const what = ref(NO_RECIPE); // a brew method or a drink category
const item = ref(''); // a drink, or the method's plain brew (set by itself)
const brewerId = ref('');
const options = computed(() => brewable(brewers.value, drinks.value));
const whatList = computed(() => whatOptions(options.value, categories.value, methods.value));
const whatChoice = computed(() => decodeWhat(what.value));
const items = computed(() => itemOptions(options.value, whatChoice.value));
// The chosen drink category (null for a method or "Something else").
const chosenCategory = computed(() => (whatChoice.value?.kind === 'category' ? (whatList.value.find((x) => x.value === what.value) ?? null) : null));
const chosen = computed(() => decodeItem(item.value));
const drink = computed(() => {
  const c = chosen.value;
  return c?.kind === 'drink' ? (drinks.value.find((d) => d.id === c.id) ?? null) : null;
});
// The kind of coffee being made: the plain brew's, or the drink's.
const itemKind = computed<MethodKind | null>(() => (chosen.value?.kind === 'plain' ? methodKind(options.value, chosen.value.method) : (drink.value?.kind ?? null)));
const brewerList = computed(() => brewerOptions(options.value, chosen.value, drinks.value));
const recipeChoices = computed(() => recipeOptions(brewerId.value || null, recipes.value));
// Drinks name their kind when a category mixes them ("The Atlas · pour over").
const mixedKinds = computed(() => new Set(items.value.drinks.map((d) => d.drink.kind)).size > 1);
const drinkLabel = (d: Drink) => (mixedKinds.value ? `${d.name} · ${METHOD_KINDS[d.kind].label.toLowerCase()}` : d.name);
watch(what, (value) => {
  remember('brewWhat', value);
  item.value = validItem(item.value || recall('brewItem'), itemValues(items.value)); // the last one, else the first
});
watch(item, (value) => {
  remember('brewItem', value);
  const kind = itemKind.value;
  brewerId.value = pickBrewer(brewerList.value, drink.value, recipes.value, kind ? recall(`brewBrewer.${kind}`) : null, brewerId.value);
  recipeId.value = pickRecipe(recipeChoices.value, drink.value, recipeId.value);
});
watch(brewerId, (id) => {
  const kind = itemKind.value;
  if (id && kind) remember(`brewBrewer.${kind}`, id); // the last brewer used for this kind
  recipeId.value = pickRecipe(recipeChoices.value, drink.value, recipeId.value);
});
// Drink size (lib/servings.ts): starts at the drink's default; a bigger or
// smaller one scales the ingredients and, on a filter method, the batch. An
// espresso shot stays as the recipe says.
const baseSize = computed(() => defaultSize(drink.value));
const sizeText = ref('');
const sizeUnit = ref<ServingUnit>('fl_oz');
const madeSize = computed<Size | null>(() => {
  const n = amount(sizeText.value);
  return baseSize.value && n > 0 && n <= 2000 ? { size: Math.round(n * 10) / 10, unit: sizeUnit.value } : null;
});
const sizeScale = computed(() => sizeFactor(madeSize.value, baseSize.value));
function resetSize(): void {
  const b = baseSize.value;
  sizeText.value = b ? formatGrams(b.size) : '';
  sizeUnit.value = b?.unit ?? 'fl_oz';
}
watch(baseSize, () => {
  resetSize();
  sizeToBatch();
});
function setSize(event: Event): void {
  sizeText.value = (event.target as HTMLInputElement).value;
  sizeToBatch();
}
function setSizeUnit(unit: ServingUnit): void {
  const s = madeSize.value;
  if (s) sizeText.value = formatGrams(convertSize(s, unit).size);
  sizeUnit.value = unit;
}
// A filter batch follows the size: water = the recipe's water × the factor.
function sizeToBatch(): void {
  const r = recipe.value;
  if (!r || espresso.value || r.targetWaterGrams === null) return;
  if (sizeScale.value === 1) resetBatch();
  else lead.value = { field: 'water', text: formatGrams(Math.round(r.targetWaterGrams * sizeScale.value)) };
}
const bean = computed(() => beans.value.find((b) => b.id === beanId.value) ?? null);
const recipe = computed(() => recipes.value.find((r) => r.id === recipeId.value) ?? null);
const suggestion = ref<StartingParameters | null>(null);
const suggestionState = ref<'idle' | 'loading' | 'none' | 'error'>('idle');

// Espresso recipes record dose → shot weight instead of water (docs/api/brew-logs.md §6).
const espresso = computed(() => recipe.value?.brewer.kind === 'espresso');
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
// A drink with ingredients is tasted twice: the brew (if tried on its own) and the drink.
const drinkTasting = computed(() => !!drink.value?.ingredients.length);
const parsed = computed(() =>
  parseBrewDraft(draft, recipe.value?.brewer.kind ?? null, drinkTasting.value, temperatureUnit.value, grinders.value.find((g) => g.id === draft.grinderId) ?? null),
);

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, r, g, m, d, c, w, t, bm, bp] = await Promise.all([
      beansApi.list(ws),
      recipesApi.list(ws),
      grindersApi.list(ws),
      brewersApi.list(ws),
      drinksApi.list(ws),
      drinkCategoriesApi.list(ws),
      waterProfilesApi.list(ws),
      prepToolsApi.list(ws),
      brewerMethodsApi.list(ws).catch(() => ({ methods: [] })), // brewers then group by kind
      brewProblemsApi.list(ws).catch(() => ({ problems: [] })), // without it, no problems checklist
    ]);
    problems.value = bp.problems;
    methods.value = bm.methods;
    drinks.value = d.drinks;
    categories.value = c.categories;
    beans.value = b.beans.filter((x) => !x.archivedAt); // archived beans can't be brewed (§4)
    recipes.value = r.recipes;
    grinders.value = g.grinders;
    waterProfiles.value = w.waterProfiles;
    prepTools.value = t.tools;
    draft.waterProfileId = defaultWaterProfileId(w.waterProfiles); // new brews start on the default (§3c)
    brewers.value = m.brewers;
    if (beans.value.length === 1) beanId.value = beans.value[0]?.id ?? '';
    const saved = recall('grinderId');
    if (saved && activeGrinders.value.some((x) => x.id === saved)) draft.grinderId = saved;
    what.value = validWhat(recall('brewWhat'), whatList.value); // the last choice, if it's still offered
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
  void loadRecent();
  // "Brew again" from the journal: /brew?repeat=<id>, filled once the
  // remembered choices above have settled. The query is dropped after.
  const repeatId = typeof route.query.repeat === 'string' ? route.query.repeat : null;
  if (repeatId && !loadError.value) {
    await nextTick();
    try {
      await applyRepeat((await brewLogsApi.get(ws, repeatId)).brewLog);
    } catch (err) {
      repeatError.value = `Couldn't load that brew to repeat: ${errorMessage(err)}`;
    }
    void router.replace({ name: 'brew' });
  }
});

// Recipe targets are the default starting point. Recipes are grinder-neutral,
// so their grind target is only a placeholder; the grind comes from chooseGrind.
watch(recipe, (r) => {
  draft.dose = r ? formatGrams(r.targetDoseGrams) : '';
  draft.water = r?.targetWaterGrams != null ? formatGrams(r.targetWaterGrams) : '';
  draft.yieldGrams = ''; // measured after brewing
  draft.temp = tempText(r?.targetTempC, temperatureUnit.value);
  // Cold styles: where it steeps and how it's served, as the recipe says.
  draft.steepTemp = r?.steepTemp ?? '';
  draft.dilution = r?.dilutionRatio != null ? String(r.dilutionRatio) : '';
  draft.dilutedWith = r?.dilutionWith ?? '';
  resetWindow(r);
  resetBatch();
  sizeToBatch(); // a resized drink keeps its size with the new recipe
  // The recipe's default grinder, if it's still in use; else keep the current
  // (last used) one.
  const preferred = r?.defaultGrinderId;
  if (preferred && activeGrinders.value.some((x) => x.id === preferred)) draft.grinderId = preferred;
  if (suggestion.value) applySuggestion(suggestion.value);
});

// Batch size (docs/features.md): the ratio defaults to the recipe's.
// - Filter: typing the dose or the water keeps the other and changes the
//   ratio; typing the ratio changes the water (the dose stays); a yield
//   (g or fl oz) sets both at the ratio.
// - Espresso: the dose moves the shot weight at the ratio; the shot weight
//   changes the ratio (the dose stays); the ratio moves the shot weight.
// Whatever was typed last is held. Pour targets scale with the water.
const lead = ref<{ field: ScaleField; text: string }>({ field: 'dose', text: '' });
// null = the recipe's ratio. value is exact; text is what the box shows.
const ratio = ref<{ text: string; value: number } | null>(null);
function resetBatch(): void {
  lead.value = { field: 'dose', text: recipe.value ? formatGrams(recipe.value.targetDoseGrams) : '' };
  ratio.value = null;
}
function setLead(field: ScaleField, event: Event): void {
  setLeadText(field, (event.target as HTMLInputElement).value);
}
function setLeadText(field: ScaleField, text: string): void {
  // The amount held is the last valid one (draft follows the batch/shot).
  const linked =
    !espresso.value && (field === 'dose' || field === 'water')
      ? linkRatio(field, amount(text), field === 'dose' ? num(draft.water) : num(draft.dose))
      : espresso.value && field === 'yield'
        ? linkRatio('yield', amount(text), num(draft.dose))
        : null;
  if (linked !== null) ratio.value = { text: formatRatio(linked), value: linked };
  lead.value = { field, text };
}
function setRatio(event: Event): void {
  const text = (event.target as HTMLInputElement).value;
  ratio.value = { text, value: amount(text) };
}
const num = (text: string): number | null => {
  const n = amount(text);
  return Number.isFinite(n) ? n : null;
};
// Weighed before the timer: the grounds out are the dose, so they fill it in
// (as a typed dose: the water stays and the ratio changes). Without a
// recipe there's no batch, so the dose is set directly.
function setGroundOut(event: Event): void {
  const text = (event.target as HTMLInputElement).value;
  draft.groundOut = text;
  if (num(text) === null) return;
  if (filterRecipe.value || shotRecipe.value) setLeadText('dose', text);
  else draft.dose = text;
}
// Optional setup fields the workspace hides (Settings → Fields). Setup is
// always a new brew, so nothing recorded needs revealing.
const { show } = useFieldVisibility();
// Shown while typing, except mid-number ("2.").
const setupGrindError = computed(() => (draft.grind.trim().endsWith('.') ? '' : (parsed.value.errors.grind ?? '')));
const setupRetention = computed(() => grinderRetentionText(num(draft.beanIn), num(draft.groundOut)));
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

const retention = computed(() => brewRetention({ roastLevel: bean.value?.roastLevel ?? null, recipeRoastLevel: recipeRoastLevel.value, recipe: filterRecipe.value, measured: measured.value }));
const customRatio = computed(() => ratio.value?.value);
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
const setupReady = computed(
  // An empty category has nothing to brew yet ("Something else" logs without a recipe).
  () =>
    !chosenCategory.value?.empty &&
    !(brewerId.value && !recipeChoices.value.length) &&
    (!baseSize.value || !!madeSize.value) &&
    (!recipe.value || (espresso.value ? !!shot.value : !!batch.value)) &&
    !(rapidCold.value && windowError.value.finish) &&
    !(longStyle.value && windowError.value.steep),
);
// The yield estimate in the person's volume unit(s) (fl oz, ml or both).
const yieldFields = computed(() =>
  volumeUnits(prefs.value.volumeUnit, prefs.value.showBothVolumes).map((u) => ({ field: (u === 'ml' ? 'yieldMl' : 'yieldOz') as ScaleField, label: VOLUME_LABELS[u] })),
);
function batchText(field: ScaleField): string {
  if (lead.value.field === field) return lead.value.text;
  if (espresso.value) return shot.value && (field === 'dose' || field === 'yield') ? formatGrams(shot.value[field]) : '';
  return batch.value ? formatGrams(batch.value[field]) : '';
}
const ratioShown = computed(() => {
  if (ratio.value !== null) return ratio.value.text;
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
const activeGrinders = computed(() => grinders.value.filter((x) => !x.archivedAt));
const grinder = computed(() => grinders.value.find((x) => x.id === draft.grinderId) ?? null);
// The last grinder and brew choice, remembered per workspace.
type Remembered = 'grinderId' | 'brewWhat' | 'brewItem' | `brewBrewer.${MethodKind}`;
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
const lastSetting = ref<{ grindSetting: number; grindRpm: number | null; timestamp: string } | null>(null);
// The grind of the brew being repeated, with the grinder and recipe it goes with.
const repeatGrind = ref<{ grinderId: string; recipeId: string; grind: string; rpm: string } | null>(null);
const grindSource = ref<GrindSource>('none');
let grindRequest = 0;
async function refreshGrind(): Promise<void> {
  const ws = workspaces.current?.id;
  const request = ++grindRequest; // ignore answers to superseded choices
  const grinderId = draft.grinderId === NEW_GRINDER ? '' : draft.grinderId;
  let last: { grindSetting: number; grindRpm: number | null; timestamp: string } | null = null;
  if (ws && grinderId && recipeId.value) {
    try {
      last = (await grindersApi.lastSetting(ws, grinderId, recipeId.value)).lastSetting;
    } catch {
      last = null; // pre-fill is a convenience; fall through
    }
  }
  if (request !== grindRequest) return;
  lastSetting.value = last;
  // A repeat keeps its brew's grind while its grinder and recipe are chosen.
  const kept = repeatGrind.value;
  if (kept && kept.grinderId === grinderId && kept.recipeId === recipeId.value) {
    draft.grind = kept.grind;
    draft.rpm = kept.rpm;
    grindSource.value = 'repeat';
    return;
  }
  const choice = chooseGrind({ lastSetting: last?.grindSetting ?? null, suggestion: suggestion.value, grinderId, recipe: recipe.value });
  draft.grind = choice.value;
  grindSource.value = choice.source;
  // The speed goes with the last setting it was used at (variable-speed grinders).
  draft.rpm = choice.source === 'last' && last?.grindRpm != null ? String(last.grindRpm) : '';
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
  if (p.tempC !== null) draft.temp = tempText(p.tempC, temperatureUnit.value);
  void refreshGrind(); // the suggestion may now supply the grind
}

const timerSteps = computed(() => scaleSteps(recipe.value?.steps ?? [], batch.value?.factor ?? 1));
const timerDose = computed(() => (espresso.value ? shot.value?.dose : batch.value?.dose) ?? recipe.value?.targetDoseGrams ?? 0);
// What the log form compares the measured yield / shot weight with.
const expectedYield = computed(() => (espresso.value ? shot.value?.yield : batch.value?.yield) ?? recipe.value?.expectedYieldGrams ?? null);

// The timer: the espresso brewer's controls (for "can't set pressure" notes),
// the header line, the first-drop window, and the marks it records.
const machine = computed(() => (espresso.value ? (brewers.value.find((x) => x.id === recipe.value?.brewer.id) ?? null) : null));
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
// Long cold styles (lib/coldBrew.ts) have no timer: Start steep saves the brew
// as steeping, to finish from the journal when it's done.
const longStyle = computed(() => isLongStyle(recipe.value?.style?.brewsLike));
const coldStyle = computed(() => isColdStyle(recipe.value?.style?.brewsLike));
const steepStarted = ref<{ at: string; reminder: Reminder | null; minHours: number | null; window: string } | null>(null); // the steep just started
// "Sat, Oct 25, 8:00 AM", when the steep window opens.
const readyFrom = computed(() => {
  const s = steepStarted.value;
  return s && s.minHours !== null ? formatWhen(new Date(new Date(s.at).getTime() + s.minHours * 3_600_000).toISOString()) : '';
});

// The window this brew aims for (docs/api/brew-logs.md §6): the recipe's,
// which can be changed before it starts, and is saved with the brew. Long
// styles steep for hours (the ready reminder comes at its start); rapid cold
// runs the timer in minutes. Both are set on setup.
const rapidCold = computed(() => recipe.value?.style?.brewsLike === 'rapid_cold');
const windowText = reactive({ steepFrom: '', steepTo: '', finishFrom: '', finishTo: '' });
function resetWindow(r: Recipe | null = recipe.value): void {
  windowText.steepFrom = hoursText(r?.steepMinHours ?? null);
  windowText.steepTo = hoursText(r?.steepMaxHours ?? null);
  windowText.finishFrom = r?.expectedFinishMinSec != null ? formatTime(r.expectedFinishMinSec) : '';
  windowText.finishTo = r?.expectedFinishMaxSec != null ? formatTime(r.expectedFinishMaxSec) : '';
}
const steepParsed = computed(() => parseSteepWindow(windowText.steepFrom, windowText.steepTo));
const finishParsed = computed(() => parseFinishWindow(windowText.finishFrom, windowText.finishTo));
const windowError = computed(() => ({ steep: steepParsed.value.ok ? '' : steepParsed.value.error, finish: finishParsed.value.ok ? '' : finishParsed.value.error }));
const steepRange = computed(() => (steepParsed.value.ok ? steepParsed.value.value : null));
const finishRange = computed(() => (finishParsed.value.ok ? finishParsed.value.value : null));
const steepWindow = computed(() => steepWindowText(steepRange.value?.min ?? null, steepRange.value?.max ?? null));
// "The recipe's: 12–18 h", while it's been changed.
const recipeSteepNote = computed(() => {
  const r = recipe.value;
  const changed = (steepRange.value?.min ?? null) !== (r?.steepMinHours ?? null) || (steepRange.value?.max ?? null) !== (r?.steepMaxHours ?? null);
  return changed ? steepWindowText(r?.steepMinHours ?? null, r?.steepMaxHours ?? null) || 'none' : '';
});
const recipeFinishNote = computed(() => {
  const r = recipe.value;
  const changed = (finishRange.value?.min ?? null) !== (r?.expectedFinishMinSec ?? null) || (finishRange.value?.max ?? null) !== (r?.expectedFinishMaxSec ?? null);
  return changed ? (formatFinishWindow(r?.expectedFinishMinSec ?? null, r?.expectedFinishMaxSec ?? null) ?? 'none') : '';
});
// The timer's target: rapid cold's own, else the recipe's.
const timerFinish = computed(() =>
  rapidCold.value ? (finishRange.value ?? { min: null, max: null }) : { min: recipe.value?.expectedFinishMinSec ?? null, max: recipe.value?.expectedFinishMaxSec ?? null },
);
// What's saved with the brew; other styles leave it out.
function windowValues(): Pick<BrewLogInput, 'steepMinHours' | 'steepMaxHours' | 'expectedFinishMinSec' | 'expectedFinishMaxSec'> {
  if (longStyle.value) return { steepMinHours: steepRange.value?.min ?? null, steepMaxHours: steepRange.value?.max ?? null };
  if (rapidCold.value) return { expectedFinishMinSec: finishRange.value?.min ?? null, expectedFinishMaxSec: finishRange.value?.max ?? null };
  return {};
}

async function startSteep(): Promise<void> {
  submitted.value = true;
  if (windowError.value.steep) return;
  const ws = workspaces.current?.id;
  // Nothing's measured yet: time 0, no results or rating.
  const start = { ...draft, time: '0', yieldGrams: '', tds: '', rating: null, notes: '', drinkRating: null, drinkNotes: '' };
  const values = parseBrewDraft(start, recipe.value?.brewer.kind ?? null, false, temperatureUnit.value, grinders.value.find((g) => g.id === draft.grinderId) ?? null).values;
  if (!ws || !bean.value || !values) return;
  saving.value = true;
  saveError.value = '';
  try {
    const { brewLog, steepReminder } = await brewLogsApi.create(ws, {
      beanId: bean.value.id,
      recipeId: recipe.value?.id ?? null,
      drinkId: drink.value?.id ?? null,
      servingSize: drink.value ? (madeSize.value?.size ?? null) : null,
      servingUnit: drink.value ? (madeSize.value?.unit ?? null) : null,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      ...values,
      ...windowValues(),
      steeping: true,
    });
    if (values.grinderId) remember('grinderId', values.grinderId);
    savedLogId.value = brewLog.id;
    steepStarted.value = {
      at: brewLog.timestamp,
      reminder: steepReminder ?? null,
      minHours: brewLog.steepMinHours,
      window: steepWindowText(brewLog.steepMinHours, brewLog.steepMaxHours),
    };
    stage.value = 'saved';
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
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

// Abandoning a brew in progress (the timer, or a log not saved yet) asks
// first: leaving the page, reloading, or clicking Brew again in the header.
// After a save, clicking Brew goes straight back to setup.
const brewSession = useBrewSessionStore();
const inProgress = computed(() => stage.value === 'timing' || stage.value === 'log' || stage.value === 'steep');
watch(inProgress, (v) => (brewSession.inProgress = v), { immediate: true });
const abandonOpen = ref(false);
let abandonAnswer: ((abandon: boolean) => void) | null = null;
function askAbandon(): Promise<boolean> {
  abandonAnswer?.(false); // a second ask replaces the first
  abandonOpen.value = true;
  return new Promise((resolve) => (abandonAnswer = resolve));
}
function answerAbandon(abandon: boolean): void {
  abandonOpen.value = false;
  abandonAnswer?.(abandon);
  abandonAnswer = null;
}
onBeforeRouteLeave(() => (inProgress.value ? askAbandon() : true));
watch(
  () => brewSession.restartRequests,
  async () => {
    if (inProgress.value) {
      if (await askAbandon()) brewAgain();
    } else if (stage.value === 'saved') brewAgain();
  },
);
function warnOnUnload(event: BeforeUnloadEvent): void {
  if (!inProgress.value) return;
  event.preventDefault();
  event.returnValue = ''; // older browsers need it set
}
window.addEventListener('beforeunload', warnOnUnload);
onUnmounted(() => {
  window.removeEventListener('beforeunload', warnOnUnload);
  brewSession.inProgress = false;
});

// Log form
const saving = ref(false);
const saveError = ref('');
const submitted = ref(false);
const savedLogId = ref<string | null>(null);

// Rate later (docs/api/notifications.md §1b): a box on the log form when
// reminders are on (Settings → Notifications), ticked to start or not as set
// there, and greyed out while no service is on to deliver the reminder.
const auth = useAuthStore();
const notifyChannels = ref<NotificationChannel[]>([]);
const userPrefs = computed(() => auth.user?.preferences ?? DEFAULT_PREFERENCES);
const deliverable = computed(() => canRemind(userPrefs.value, notifyChannels.value));
const rateLater = ref(false);
watch(stage, (s) => {
  if (s === 'log') rateLater.value = userPrefs.value.rateLaterDefault;
});
const reminder = ref<'queued' | 'off' | 'unavailable' | null>(null); // for the brew just saved
notificationsApi
  .list()
  .then((r) => (notifyChannels.value = r.channels))
  .catch(() => (notifyChannels.value = [])); // without it, brews just save without Rate later

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const values = parsed.value.values;
  if (!ws || !bean.value || !values) return;
  // Already rated after all: a normal save (no reminder, and the AI is offered).
  const remind = rateLater.value && deliverable.value && values.rating === null && (values.drinkRating ?? null) === null;
  saving.value = true;
  saveError.value = '';
  try {
    const { brewLog, reminder: outcome } = await brewLogsApi.create(ws, {
      beanId: bean.value.id,
      recipeId: recipe.value?.id ?? null,
      drinkId: drink.value?.id ?? null,
      servingSize: drink.value ? (madeSize.value?.size ?? null) : null,
      servingUnit: drink.value ? (madeSize.value?.unit ?? null) : null,
      // So the AI dates the brew by this device's calendar day, like freeze dates.
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      ...values,
      ...windowValues(),
      ...(remind ? { remindToRate: true } : {}),
      // The steps' real times, plus the first drop from the log's field. A time
      // typed shorter than a tap drops that tap.
      marks: [
        ...(recipe.value ? marks.value.filter((m) => m.kind === 'step_end' && m.atSec <= values.actualTimeSec) : []),
        ...(parsed.value.firstDropSec !== null ? [{ kind: 'first_drop' as const, stepOrder: null, atSec: parsed.value.firstDropSec }] : []),
      ],
    });
    if (values.grinderId) remember('grinderId', values.grinderId);
    savedLogId.value = brewLog.id;
    reminder.value = remind ? (outcome ?? 'unavailable') : null;
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
  reminder.value = null;
  steepStarted.value = null;
  draft.rating = null;
  draft.notes = '';
  draft.problemIds = [];
  draft.drinkRating = null;
  draft.drinkNotes = '';
  submitted.value = false;
  suggestion.value = null;
  suggestionState.value = 'idle';
  repeatFrom.value = null;
  repeatGrind.value = null;
  void loadRecent(); // the brew just saved is now the latest
  void refreshGrind(); // the brew just saved is now the "last setting"
}

// Repeat a brew (lib/repeatBrew.ts): quick buttons for the latest brew of
// each of the last 3 things made, "Pick a brew…" for any other, and
// /brew?repeat=<id> from the journal. Setup is filled from the brew; the
// timer starts as usual.
const recentLogs = ref<BrewLog[]>([]);
const quickRepeats = computed(() => recentByMade(recentLogs.value, brewers.value));
const pickerOpen = ref(false);
const repeatFrom = ref<{ log: BrewLog; missing: string[] } | null>(null);
const repeatError = ref('');
// The repeated brew's notes, shown on the log form when you keep them as a reminder.
const repeatNotes = computed(
  () => !!repeatFrom.value && userPrefs.value.repeatKeeps.includes('notes') && !!(repeatFrom.value.log.tastingNotes || repeatFrom.value.log.drinkTastingNotes),
)
async function loadRecent(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    recentLogs.value = (await brewLogsApi.list(ws, { limit: 30 })).brewLogs;
  } catch {
    recentLogs.value = []; // the buttons are a shortcut; the picker still loads
  }
}
// Each choice is set once the previous one's watcher has run (a drink picks
// its default brewer and recipe, a recipe resets the batch), so the brew's
// own choices win. Then its amounts, after the recipe has set its own.
async function applyRepeat(log: BrewLog): Promise<void> {
  pickerOpen.value = false;
  repeatError.value = '';
  const plan = repeatPlan(log, {
    beans: beans.value,
    brewers: brewers.value,
    drinks: drinks.value,
    recipes: recipes.value,
    grinders: grinders.value,
    waterProfiles: waterProfiles.value,
  });
  // Only mention what's gone if it would have been copied.
  const kept = new Set(userPrefs.value.repeatKeeps);
  const missing = plan.missing.filter(
    (m) => !(m.startsWith('The grinder') && !kept.has('grinder') && !kept.has('grind')) && !(m.startsWith('The water') && !kept.has('waterProfile')),
  );
  repeatFrom.value = { log, missing };
  repeatGrind.value =
    plan.grinderId && log.actualGrindSetting !== null
      ? { grinderId: plan.grinderId, recipeId: plan.recipeId, grind: formatGrind(log.actualGrindSetting), rpm: log.grindRpm === null ? '' : String(log.grindRpm) }
      : null;
  if (plan.beanId) beanId.value = plan.beanId;
  what.value = plan.what;
  await nextTick();
  if (plan.item) item.value = plan.item;
  await nextTick();
  if (plan.brewerId) brewerId.value = plan.brewerId;
  await nextTick();
  if (plan.recipeId) recipeId.value = plan.recipeId;
  await nextTick();
  if (repeatGrind.value) repeatGrind.value.recipeId = recipeId.value; // another recipe if the brew's is gone
  // What else it copies is yours to choose (Settings → Repeat brews,
  // repeatKeeps); what's left out is set as for a new brew.
  if (kept.has('size') && log.servingSize !== null && log.servingUnit && baseSize.value) {
    sizeText.value = formatGrams(log.servingSize);
    sizeUnit.value = log.servingUnit;
  } else resetSize();
  // Filter: the brew's dose and water (so the ratio is the one it had);
  // espresso: its dose, with the shot weight at the recipe's ratio.
  if (!kept.has('doseWater')) {
    resetBatch();
    sizeToBatch();
  } else if (filterRecipe.value && log.actualWaterGrams !== null) {
    const r = log.actualWaterGrams / log.actualDoseGrams;
    lead.value = { field: 'dose', text: formatGrams(log.actualDoseGrams) };
    ratio.value = { text: formatRatio(r), value: r };
  } else if (shotRecipe.value) {
    lead.value = { field: 'dose', text: formatGrams(log.actualDoseGrams) };
    ratio.value = null;
  } else {
    draft.dose = formatGrams(log.actualDoseGrams);
    draft.water = log.actualWaterGrams === null ? '' : formatGrams(log.actualWaterGrams);
  }
  draft.temp = tempText(kept.has('temp') ? log.actualTempC : (recipe.value?.targetTempC ?? null), temperatureUnit.value);
  if (kept.has('grinder')) draft.grinderId = plan.grinderId; // else the one setup already has
  // The grind follows only on the brew's own grinder (repeatGrind checks it).
  if (!kept.has('grind')) repeatGrind.value = null;
  draft.waterProfileId = kept.has('waterProfile') && plan.waterProfileId ? plan.waterProfileId : defaultWaterProfileId(waterProfiles.value);
  // Cold styles: where it steeped goes with the temperature; the dilution
  // has its own switch. Otherwise the recipe's (set when the recipe was chosen).
  if (kept.has('temp') && log.steepTemp) draft.steepTemp = log.steepTemp;
  if (kept.has('dilution') && log.dilutionRatio !== null) {
    draft.dilution = String(log.dilutionRatio);
    draft.dilutedWith = log.dilutedWith ?? '';
  }
  // The steep or finish window it aimed for; else the recipe's.
  if (kept.has('window') && longStyle.value && log.steepMinHours !== null && log.steepMaxHours !== null) {
    windowText.steepFrom = hoursText(log.steepMinHours);
    windowText.steepTo = hoursText(log.steepMaxHours);
  }
  if (kept.has('window') && rapidCold.value && log.expectedFinishMinSec !== null && log.expectedFinishMaxSec !== null) {
    windowText.finishFrom = formatTime(log.expectedFinishMinSec);
    windowText.finishTo = formatTime(log.expectedFinishMaxSec);
  }
  const activeTools = new Set(prepTools.value.filter((t) => !t.archivedAt).map((t) => t.id));
  draft.toolIds = kept.has('prepTools') ? log.tools.map((t) => t.id).filter((id) => activeTools.has(id)) : [];
  draft.problemIds = []; // what went wrong is noted for each brew
  draft.beanIn = kept.has('grinderWeights') && log.beanWeightInGrams !== null ? formatGrams(log.beanWeightInGrams) : '';
  draft.groundOut = kept.has('grinderWeights') && log.groundWeightOutGrams !== null ? formatGrams(log.groundWeightOutGrams) : '';
  await nextTick();
  void refreshGrind(); // applies repeatGrind (also when the grinder didn't change)
}

const beanLabel = computed(() => (bean.value ? `${bean.value.roasterName} ${bean.value.beanName}${batchSuffix(bean.value)}` : ''));
</script>

<template>
  <AppHeader />
  <main class="page">
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>

    <div v-else-if="beans.length === 0" class="card empty">
      <p>Add a bean (or unarchive one) first, then come back to brew.</p>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'bean-new' }">Add bean</RouterLink>
    </div>

    <p v-else-if="!workspaces.canEdit" class="card muted">Viewers can't log brews. Ask an owner to make you a barista.</p>

    <!-- 1. Setup -->
    <template v-else-if="stage === 'setup'">
      <h1>New brew</h1>
      <!-- Repeat a brew: fills setup from an earlier one (lib/repeatBrew.ts). -->
      <section v-if="recentLogs.length" class="repeat" aria-labelledby="repeat-label">
        <span id="repeat-label" class="batch-label">Repeat a brew</span>
        <div class="repeat-row">
          <button v-for="l in quickRepeats" :key="l.id" class="btn btn-secondary repeat-btn" type="button" @click="applyRepeat(l)">
            <strong>{{ repeatLabel(l).made }}</strong>
            <span v-if="repeatLabel(l).recipe" class="small recipe">{{ repeatLabel(l).recipe }}</span>
            <span class="muted small">{{ repeatLabel(l).bean }} · {{ repeatLabel(l).when }}</span>
          </button>
          <button class="btn-link repeat-pick" type="button" @click="pickerOpen = true">Pick a brew…</button>
        </div>
        <p v-if="repeatFrom" class="muted small" aria-live="polite">
          Filled from your {{ repeatLabel(repeatFrom.log).made }} brew of {{ repeatLabel(repeatFrom.log).when }}.
          <template v-for="m in repeatFrom.missing" :key="m"> {{ m }}</template>
        </p>
      </section>
      <p v-if="repeatError" class="form-error" role="alert">{{ repeatError }}</p>
      <RepeatBrewPicker :open="pickerOpen" :beans="beans" @close="pickerOpen = false" @pick="applyRepeat" />
      <section class="card stack">
        <div class="field">
          <label for="bean">Bean<span class="req" aria-hidden="true">*</span></label>
          <select id="bean" aria-required="true" v-model="beanId">
            <option value="" disabled>Choose a bean…</option>
            <option v-for="b in beans" :key="b.id" :value="b.id">{{ pickerLabel(b) }}</option>
          </select>
        </div>
        <div class="field">
          <label for="what">What are you making?<span class="req" aria-hidden="true">*</span></label>
          <select id="what" aria-required="true" v-model="what">
            <option v-for="c in whatList" :key="c.value" :value="c.value">{{ c.name }}</option>
            <option :value="NO_RECIPE">Something else (no recipe)</option>
          </select>
        </div>
        <div v-if="chosenCategory?.empty" class="card empty-category" role="status">
          <p>Nothing in {{ chosenCategory.name }} yet.</p>
          <p class="muted small">
            <RouterLink v-if="workspaces.canEdit" :to="{ name: 'drink-new', query: { category: chosenCategory.categoryId ?? undefined } }">Add a drink</RouterLink
            ><template v-else>Add a drink</template> to it (a V60 or espresso drink with ingredients, say). For a plain brew, pick its method above.
          </p>
        </div>
        <div v-else-if="chosenCategory" class="field">
          <label for="item">Drink<span class="req" aria-hidden="true">*</span></label>
          <select id="item" aria-required="true" v-model="item">
            <option v-for="d in items.drinks" :key="d.drink.id" :value="encodeDrink(d.drink.id)">{{ '\u2003'.repeat(d.depth) }}{{ drinkLabel(d.drink) }}</option>
          </select>
        </div>
        <div v-if="chosen && brewerList.length" class="field">
          <label for="brewer">Brewer<span class="req" aria-hidden="true">*</span></label>
          <select id="brewer" aria-required="true" v-model="brewerId">
            <option v-for="b in brewerList" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </div>
        <div v-if="brewerId && !recipeChoices.length" class="card empty-category" role="status">
          <p>No recipes for {{ brewerList.find((b) => b.id === brewerId)?.name }} yet.</p>
          <p class="muted small">
            <RouterLink v-if="workspaces.canEdit" :to="{ name: 'recipe-new', query: { brewer: brewerId } }">Add a recipe</RouterLink
            ><template v-else>Ask an owner or barista to add a recipe</template> for it to brew with.
          </p>
        </div>
        <div v-else-if="brewerId" class="field">
          <label for="recipe">Recipe<span class="req" aria-hidden="true">*</span></label>
          <select id="recipe" aria-required="true" v-model="recipeId">
            <option v-for="r in recipeChoices" :key="r.id" :value="r.id">{{ r.name }}<template v-if="r.style && !(r.style.brewsLike === 'standard' && r.style.name === 'Standard')"> ({{ r.style.name.toLowerCase() }})</template><template v-if="r.id === drink?.defaultRecipeId"> (default)</template></option>
          </select>
        </div>
        <div v-if="baseSize" class="batch" role="group" aria-labelledby="size-label">
          <span id="size-label" class="batch-label">Size</span>
          <div class="size-row">
            <input id="drink-size" inputmode="decimal" :value="sizeText" aria-label="Drink size" @input="setSize" />
            <select :value="sizeUnit" aria-label="Size unit" @change="setSizeUnit(($event.target as HTMLSelectElement).value as ServingUnit)">
              <option v-for="(label, key) in SERVING_UNITS" :key="key" :value="key">{{ label }}</option>
            </select>
            <button v-if="sizeScale !== 1" class="btn-link small" type="button" @click="resetSize(); sizeToBatch()">Reset to {{ formatSize(baseSize) }}</button>
          </div>
          <p v-if="!madeSize" class="field-error">Enter a size.</p>
          <p v-else-if="sizeScale !== 1" class="muted small">
            ×{{ Math.round(sizeScale * 100) / 100 }} of {{ formatSize(baseSize) }}<template v-if="espresso">: the shot stays as the recipe says</template>
          </p>
        </div>
        <div v-if="drink && drink.ingredients.length" class="finish-with" aria-label="Finish with">
          <span class="batch-label">Finish with</span>
          <ul>
            <li v-for="c in drink.ingredients" :key="c.ingredientId">{{ ingredientLine(c, sizeScale) }}</li>
          </ul>
        </div>
        <div v-if="show('brew.grinder')" class="field">
          <label for="grinder">
            Grinder
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
            <label for="new-grinder">New grinder name<span class="req" aria-hidden="true">*</span></label>
            <input id="new-grinder" aria-required="true" ref="newGrinderInput" v-model="newGrinderName" maxlength="100" placeholder="e.g. Comandante C40" @keydown.enter.prevent="addGrinder" />
          </div>
          <button class="btn btn-secondary" type="button" :disabled="addingGrinder || !newGrinderName.trim()" @click="addGrinder">Add</button>
          <span v-if="grinderError" class="field-error full">{{ grinderError }}</span>
        </div>
        <p v-if="recipe" class="muted recipe-summary">
          {{ formatDoseLine(recipe.targetDoseGrams, recipe.targetWaterGrams, recipe.expectedYieldGrams) }}
          <template v-if="recipe.targetTempC !== null"> · {{ formatTemp(recipe.targetTempC, temperatureUnit) }}</template>
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
          <div class="batch-row" :class="{ two: yieldFields.length === 2 }">
            <div v-for="f in yieldFields" :key="f.field" class="field">
              <label :for="`batch-${f.field}`">Yield ≈ ({{ f.label }})</label>
              <input :id="`batch-${f.field}`" inputmode="decimal" :value="batchText(f.field)" @input="setLead(f.field, $event)" />
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
            <li><strong>{{ formatTempChange(suggestion.tempDeltaC, temperatureUnit) }}</strong><template v-if="suggestion.tempC !== null"> → {{ formatTemp(suggestion.tempC, temperatureUnit) }}</template></li>
          </ul>
          <p v-if="suggestionGrinderMismatch" class="note small">
            That brew was on {{ suggestion.grinder?.name ?? 'no recorded grinder' }}, so its grind setting isn't copied. Adjust for {{ grinder?.name ?? 'your grinder' }}.
          </p>
          <p class="muted small">
            Based on your brew from {{ formatDay(suggestion.basedOn.timestamp) }}<template v-if="!suggestion.basedOn.isLatestBrew"> (you've brewed since then)</template>.
          </p>
        </template>
        <div v-if="show('brew.temp') || show('brew.grind')" class="form-row">
          <div v-if="show('brew.temp')" class="field">
            <label for="setup-temp">Water temp ({{ TEMPERATURE_LABELS[temperatureUnit] }})</label>
            <input id="setup-temp" v-model="draft.temp" inputmode="decimal" :placeholder="temperatureUnit === 'f' ? 'e.g. 201' : 'e.g. 94'" />
          </div>
          <div v-if="show('brew.grind')" class="field">
            <label for="setup-grind">Grind setting</label>
            <input id="setup-grind" v-model="draft.grind" inputmode="decimal" :placeholder="grindPlaceholder" :aria-invalid="!!setupGrindError" @input="grindSource = 'none'" />
            <span v-if="setupGrindError" class="field-error">{{ setupGrindError }}</span>
          </div>
        </div>
        <template v-if="show('brew.grind')">
          <p v-if="grindSource === 'last' && lastSetting" class="muted small grind-hint">
            Last time with {{ grinder?.name }} on {{ recipe?.name }}: {{ formatGrind(lastSetting.grindSetting) }} ({{ formatDay(lastSetting.timestamp) }})
          </p>
          <p v-else-if="grindSource === 'suggestion'" class="muted small grind-hint">Grind from the analyzed brew; adjust as suggested.</p>
          <p v-else-if="grindSource === 'repeat' && repeatFrom" class="muted small grind-hint">
            From the brew you're repeating ({{ repeatLabel(repeatFrom.log).when }}). Adjust as you dial in.
          </p>
          <p v-else-if="grindSource === 'recipe'" class="muted small grind-hint">
            The recipe's approximate starting point for {{ grinder?.name }}. Adjust to taste; next time your own setting is used.
          </p>
        </template>
        <div v-if="grinder?.variableSpeed && show('brew.rpm')" class="field">
          <label for="setup-rpm">Speed (RPM)</label>
          <input id="setup-rpm" v-model="draft.rpm" inputmode="numeric" :placeholder="grinder.rpmMin != null && grinder.rpmMax != null ? `${grinder.rpmMin}–${grinder.rpmMax}` : 'e.g. 900'" />
        </div>
        <div v-if="show('brew.grinderWeights')" class="form-row">
          <div class="field">
            <label for="setup-bean-in">Beans in (g)</label>
            <input id="setup-bean-in" v-model="draft.beanIn" inputmode="decimal" placeholder="Before grinding" />
          </div>
          <div class="field">
            <label for="setup-ground-out">Grounds out (g)</label>
            <input id="setup-ground-out" :value="draft.groundOut" inputmode="decimal" placeholder="Sets the dose" @input="setGroundOut" />
            <span v-if="setupRetention" class="hint">{{ setupRetention }}</span>
          </div>
        </div>
        <!-- Cold styles: fridge or room, the recipe's to start with. -->
        <div v-if="coldStyle && show('brew.steepTemp')" class="field">
          <label for="steep-temp">Steeping in</label>
          <select id="steep-temp" v-model="draft.steepTemp">
            <option value="">Not recorded</option>
            <option v-for="(label, key) in STEEP_TEMPS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <!-- Long cold styles: the steep window for this brew, the recipe's to start with (the reminder comes at its start). -->
        <fieldset v-if="longStyle && show('brew.window')" class="window">
          <legend>Steep for</legend>
          <div class="window-row">
            <div class="field">
              <label for="steep-from">From (h)</label>
              <input id="steep-from" v-model="windowText.steepFrom" inputmode="decimal" placeholder="12" :aria-invalid="!!windowError.steep" />
            </div>
            <span class="dash" aria-hidden="true">–</span>
            <div class="field">
              <label for="steep-to">To (h)</label>
              <input id="steep-to" v-model="windowText.steepTo" inputmode="decimal" placeholder="18" :aria-invalid="!!windowError.steep" />
            </div>
          </div>
          <span v-if="windowError.steep" class="field-error">{{ windowError.steep }}</span>
          <span v-else-if="recipeSteepNote" class="hint">
            For this brew. The recipe's: {{ recipeSteepNote }}.
            <button class="btn-link small" type="button" @click="resetWindow()">Use it</button>
          </span>
          <span v-else-if="steepWindow" class="hint">You get a reminder when it opens (Settings → Notifications).</span>
        </fieldset>
        <!-- Rapid cold: the timer's target for this brew, the recipe's to start with. -->
        <fieldset v-if="rapidCold && show('brew.window')" class="window">
          <legend>Target finish</legend>
          <div class="window-row">
            <div class="field">
              <label for="finish-from">From</label>
              <input id="finish-from" v-model="windowText.finishFrom" inputmode="numeric" placeholder="m:ss" :aria-invalid="!!windowError.finish" />
            </div>
            <span class="dash" aria-hidden="true">–</span>
            <div class="field">
              <label for="finish-to">To</label>
              <input id="finish-to" v-model="windowText.finishTo" inputmode="numeric" placeholder="m:ss" :aria-invalid="!!windowError.finish" />
            </div>
          </div>
          <span v-if="windowError.finish" class="field-error">{{ windowError.finish }}</span>
          <span v-else-if="recipeFinishNote" class="hint">
            For this brew. The recipe's: {{ recipeFinishNote }}.
            <button class="btn-link small" type="button" @click="resetWindow()">Use it</button>
          </span>
        </fieldset>
      </section>

      <div class="stack">
        <template v-if="longStyle">
          <button class="btn btn-primary btn-block" type="button" :disabled="!bean || !setupReady" @click="leaveSetup('steep')">Start steep</button>
          <button class="btn btn-secondary btn-block" type="button" :disabled="!bean || !setupReady" @click="logWithoutTimer">
            Log a finished one
          </button>
        </template>
        <template v-else>
          <button class="btn btn-primary btn-block" type="button" :disabled="!bean || !setupReady" @click="leaveSetup('timing')">
            {{ espresso ? 'Start shot timer' : timerSteps.length ? 'Start timer' : 'Start stopwatch' }}
          </button>
          <button class="btn btn-secondary btn-block" type="button" :disabled="!bean || !setupReady" @click="logWithoutTimer">
            Log a brew without the timer
          </button>
        </template>
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
        :expected-finish-min-sec="timerFinish.min"
        :expected-finish-max-sec="timerFinish.max"
        :first-drop-window="firstDropWindow"
        :machine="machine"
        @complete="onTimerComplete"
      />
    </template>

    <!-- 2b. Start a long cold brew: the recipe's steps as a checklist, then it's saved steeping. -->
    <section v-else-if="stage === 'steep'" class="stack">
      <button class="btn-link cancel" type="button" @click="stage = 'setup'">← Back to setup</button>
      <h1>Start the steep</h1>
      <p class="muted">
        {{ beanLabel }}<template v-if="recipe"> · {{ recipe.name }}</template> · {{ draft.dose }} g : {{ draft.water }} g<template v-if="draft.grind"> · grind {{ draft.grind }}</template>
      </p>
      <section v-if="timerSteps.length" class="card stack">
        <h2>Steps</h2>
        <label v-for="(st, i) in timerSteps" :key="i" class="checkbox">
          <input type="checkbox" />
          {{ stepTitle(st) }}<template v-if="st.targetWaterGrams !== null"> · to {{ formatGrams(st.targetWaterGrams) }} g</template>
        </label>
      </section>
      <section class="card stack">
        <p class="muted small">
          <template v-if="draft.steepTemp">{{ draft.steepTemp === 'fridge' ? 'In the fridge' : 'At room temperature' }}. </template>
          <template v-if="steepWindow">Steep for {{ steepWindow }}<template v-if="recipeSteepNote"> (changed for this brew)</template>. </template>It's saved as steeping now; finish it from the journal when it's done, and rate it then.
        </p>
      </section>
      <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
      <button class="btn btn-primary btn-block" type="button" :disabled="saving" @click="startSteep">{{ saving ? 'Saving…' : 'Start steeping' }}</button>
    </section>

    <!-- 3. Log -->
    <form v-else-if="stage === 'log'" class="stack" novalidate @submit.prevent="save()">
      <h1>How was it?</h1>
      <p class="muted">
        {{ beanLabel }}<template v-if="drink"> · {{ drink.name }}</template><template v-if="madeSize"> · {{ formatSize(madeSize) }}</template
        ><template v-if="recipe"> · {{ recipe.name }}</template>
      </p>
      <FinishDrinkCard v-if="drink" :drink="drink" :factor="sizeScale" :size-label="madeSize ? formatSize(madeSize) : null" />
      <!-- Settings → Repeat brews: the repeated brew's notes, as a reminder (not copied). -->
      <section v-if="repeatNotes" class="card notes-reminder">
        <h2>Last time ({{ repeatLabel(repeatFrom!.log).when }})</h2>
        <p v-if="repeatFrom!.log.tastingNotes">{{ repeatFrom!.log.tastingNotes }}</p>
        <p v-if="repeatFrom!.log.drinkTastingNotes"><span class="muted">The drink:</span> {{ repeatFrom!.log.drinkTastingNotes }}</p>
      </section>
      <section class="card">
        <p v-if="stepMarksLine" class="muted small marks-line">{{ stepMarksLine }}</p>
        <BrewFields v-model="draft" :errors="parsed.errors" :show-errors="submitted" :grinders="grinders" :water-profiles="waterProfiles" :prep-tools="prepTools" :problems="problems" :method-kind="recipe?.brewer.kind ?? null" :expected-yield-grams="expectedYield" :espresso="espresso" :drink-tasting="drinkTasting" :recipe-style="recipe?.style?.brewsLike ?? null" />
      </section>
      <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
      <div v-if="userPrefs.rateReminders" class="rate-later">
        <label class="checkbox" :class="{ off: !deliverable }">
          <input v-model="rateLater" type="checkbox" :disabled="!deliverable" />
          Rate later: remind me in {{ formatDelay(userPrefs.rateReminderMinutes) }}
        </label>
        <p v-if="!deliverable" class="muted small">
          No notification service is on yet: <RouterLink :to="{ name: 'settings-notifications' }">set one up</RouterLink>.
        </p>
        <p v-else-if="rateLater" class="muted small">Leave the rating for now. If you rate it before saving, no reminder is sent.</p>
      </div>
      <button class="btn btn-primary btn-block" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save brew' }}</button>
    </form>

    <!-- 4. Saved -->
    <template v-else>
      <section class="card stack saved">
        <h1>{{ steepStarted ? 'Steeping ✓' : 'Brew saved ✓' }}</h1>
        <!-- A long cold brew: finished and rated later, from the journal. -->
        <template v-if="steepStarted">
          <p v-if="readyFrom" class="muted">Ready from {{ readyFrom }} ({{ steepStarted.window }}).</p>
          <p v-if="steepStarted.reminder === 'queued'" class="muted">We'll remind you when it's ready to filter.</p>
          <p v-else-if="steepStarted.reminder" class="muted small">
            No reminder{{ steepStarted.reminder === 'off' ? ': steep reminders or every notification service are off (Settings → Notifications)' : ": it couldn't be set" }}.
          </p>
          <p class="muted">When it's done, open it in the journal and tap Finish to add the steep time, yield and how it tasted.</p>
        </template>
        <!-- Rate later: the AI waits for the rating, offered with it on the entry. -->
        <template v-else-if="reminder">
          <p v-if="reminder === 'queued'" class="muted">
            We'll remind you to rate it in {{ formatDelay(userPrefs.rateReminderMinutes) }}. The AI suggestion comes with the rating.
          </p>
          <p v-else class="form-error" role="alert">
            The reminder couldn't be set{{ reminder === 'off' ? ': no notification service is on (Settings → Notifications)' : '' }}. Rate it from the journal when you're ready.
          </p>
        </template>
        <template v-else>
          <p class="muted">Want a suggestion for your next brew of {{ beanLabel }}?</p>
          <button v-if="aiState === 'idle' || aiState === 'error'" class="btn btn-primary" type="button" @click="requestAnalysis">
            Get AI suggestion
          </button>
          <p v-if="aiState === 'error'" class="form-error" role="alert">{{ aiError }}</p>
          <p v-if="aiState === 'waiting'" class="muted" aria-live="polite">Analyzing your brew… this usually takes a few seconds.</p>
          <p v-if="aiState === 'slow'" class="muted" aria-live="polite">
            Still working on it. It'll show up in the journal, and next time you tap “Suggest parameters” for this bean.
          </p>
          <AnalysisCard v-if="analysis" :analysis="analysis" :can-rate="workspaces.canEdit" />
        </template>
      </section>
      <FinishDrinkCard v-if="drink" :drink="drink" :factor="sizeScale" :size-label="madeSize ? formatSize(madeSize) : null" />
      <div class="stack">
        <button class="btn btn-secondary btn-block" type="button" @click="brewAgain">Brew again</button>
        <RouterLink v-if="savedLogId" class="btn btn-secondary btn-block" :to="{ name: 'journal-entry', params: { id: savedLogId } }">
          View in journal
        </RouterLink>
      </div>
    </template>
  </main>

  <ConfirmDialog :open="abandonOpen" title="Abandon this brew?" @cancel="answerAbandon(false)">
    <p>The timer and anything you've entered for this brew will be lost.</p>
    <template #actions>
      <button class="btn btn-danger" type="button" @click="answerAbandon(true)">Abandon brew</button>
      <button class="btn btn-secondary" type="button" @click="answerAbandon(false)">Keep brewing</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.notes-reminder h2 {
  font-size: 1rem;
  margin: 0 0 var(--space-1);
}
.notes-reminder p {
  margin: 0;
  white-space: pre-line;
}
.rate-later {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.rate-later p {
  margin: 0;
}
.rate-later .checkbox.off {
  color: var(--text-muted);
}
.repeat {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.repeat p {
  margin: 0;
}
.repeat-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: stretch;
}
.repeat-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  text-align: left;
  flex: 1 1 9rem;
  min-width: 0;
}
.repeat-btn .small {
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.repeat-pick {
  align-self: center;
}
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
.empty-category {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.empty-category p {
  margin: 0;
}
.size-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.size-row input {
  width: 6rem;
}
.size-row select {
  width: auto;
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
.window {
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.window legend {
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0;
  margin-bottom: var(--space-1);
}
.window-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: var(--space-2);
}
.window .dash {
  padding-bottom: 0.6rem;
  color: var(--text-muted);
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

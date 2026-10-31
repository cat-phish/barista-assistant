<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { beanProcessesApi } from '../api/beanProcesses';
import { beansApi, type BeanBrewSummary, type BeanInput } from '../api/beans';
import { errorMessage } from '../api/client';
import AppHeader from '../components/AppHeader.vue';
import BeanPhotos from '../components/BeanPhotos.vue';
import BeanReviewDialog from '../components/BeanReviewDialog.vue';
import BrewAverageHint from '../components/BrewAverageHint.vue';
import LabelCard from '../components/LabelCard.vue';
import LabelHint from '../components/LabelHint.vue';
import NameInput from '../components/NameInput.vue';
import NamesInput from '../components/NamesInput.vue';
import RatingInput from '../components/RatingInput.vue';
import { localDateInput, parseDecimal, toDateInput } from '../lib/format';
import { ALTITUDE_LABELS, altitudeText, parseAltitude } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import { useWorkspaceStore } from '../stores/workspace';
import { useBeanDraftStore } from '../stores/beanDraft';
import { labelReadKey, useLabelReadStore, type LabelAnswer } from '../stores/labelRead';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import type { Bean, BeanPhoto, BeanProcess, BlendType, CoffeeSpecies, DetailedRoastLevel, OriginArea, RoastLevel, RoastType } from '../api/types';
import { COUNTRY_AREAS, ORIGIN_AREAS, areaForCountry } from '../lib/origins';
import { ROAST_LEVELS } from '../lib/scale';
import { LABEL_FIELD_KEYS, labelFill, lookUpFields, pageLabel, type LabelForm, type LabelSuggestion, type TextKey } from '../lib/labelFill';
import type { FieldKey } from '../lib/fields';
import { distinctNames, lastBag, normalizeName } from '../lib/nameSuggest';
import { COMMON_VARIETIES } from '../lib/varieties';
import {
  BLEND_TYPES,
  COFFEE_SPECIES,
  DETAILED_ROAST_LEVELS,
  ROAST_TYPES,
  formatPricePerGram,
  lastCurrency,
  nextBatch,
  pricePerGram,
  rememberCurrency,
} from '../lib/beans';

const props = defineProps<{ id?: string }>(); // set when editing (route param)

const workspaces = useWorkspaceStore();
const { altitudeUnit, roastScale, settings } = usePreferences();
const route = useRoute();
const router = useRouter();
const editing = computed(() => props.id !== undefined);
// Duplicate (?from=<bean id>): a new bag of the same coffee. The original's
// name, for the heading.
const copyFrom = typeof route.query.from === 'string' && !editing.value ? route.query.from : null;
const copyOf = ref<string | null>(null);

const roasterName = ref('');
const beanName = ref('');
const process = ref(''); // a processId, '' = not sure
// The workspace's processes (docs/api/bean-processes.md §4b): the visible ones,
// plus the bean's own if it's hidden, so editing doesn't drop it.
const processes = ref<BeanProcess[]>([]);
const processChoices = computed(() => processes.value.filter((p) => !p.hidden || p.id === process.value));
const originArea = ref<OriginArea | ''>('');
const country = ref('');
const region = ref('');
const producer = ref('');
const altitude = ref('');
const varieties = ref<string[]>([]);
const species = ref<CoffeeSpecies[]>([]); // in COFFEE_SPECIES order
const flavorProfile = ref('');
const blendType = ref<BlendType | ''>('');
const decaf = ref(false);
const roastType = ref<RoastType | ''>('');
const roastDate = ref('');
const detailedRoastLevel = ref<DetailedRoastLevel | ''>('');
const inventory = ref('0');
const price = ref('');
const currency = ref(editing.value ? '' : lastCurrency());
const bagWeight = ref('');
const purchaseDate = ref('');
const greenSupplier = ref('');
const batchNumber = ref('');
const weightLoss = ref(''); // roast weight loss, %
const website = ref('');
const showOnPublicMenu = ref(true);
const rating = ref<number | null>(null);
const review = ref('');
// How its brews went: the hint under the rating. A new bean has none.
const brewSummary = ref<BeanBrewSummary | null>(null);
// "Suggest with AI" (docs/api/analysis.md §8e) needs brews to read.
const suggestingReview = ref(false);
const canSuggestReview = computed(() => settings.value.beanReviews && workspaces.canEdit && (brewSummary.value?.brewCount ?? 0) > 0);
const notes = ref('');
// Saved photos, cover first (docs/api/bean-photos.md §4c); a new bean's are
// held by BeanPhotos until it's saved.
const photos = ref<BeanPhoto[]>([]);
const photoPicker = ref<InstanceType<typeof BeanPhotos> | null>(null);

// The workspace's other beans, archived ones too: the names the roaster,
// coffee, producer and supplier fields suggest, and the last bag of a coffee
// you've had before.
const otherBeans = ref<Bean[]>([]);
const roasterNames = computed(() => distinctNames(otherBeans.value.map((b) => b.roasterName)));
const coffeeNames = computed(() => distinctNames(otherBeans.value.map((b) => b.beanName)));
const producerNames = computed(() => distinctNames(otherBeans.value.map((b) => b.producer)));
const supplierNames = computed(() => distinctNames(otherBeans.value.map((b) => b.greenSupplier)));
// The workspace's spellings first, so they win over the built-in ones.
const varietyNames = computed(() => distinctNames([...otherBeans.value.flatMap((b) => b.varieties ?? []), ...COMMON_VARIETIES]));
const SPECIES_KEYS = Object.keys(COFFEE_SPECIES) as CoffeeSpecies[];
function toggleSpecies(s: CoffeeSpecies): void {
  species.value = species.value.includes(s) ? species.value.filter((x) => x !== s) : SPECIES_KEYS.filter((x) => x === s || species.value.includes(x));
}
// This roaster's coffees come first.
const roasterCoffees = computed(() => {
  const roaster = normalizeName(roasterName.value);
  return roaster ? otherBeans.value.filter((b) => normalizeName(b.roasterName) === roaster).map((b) => b.beanName) : [];
});
// A new bean (not already a copy) of a coffee you've had: offer to start
// from its last bag, as Duplicate does.
const previousBag = computed(() =>
  editing.value || copyOf.value ? null : lastBag(otherBeans.value, roasterName.value, beanName.value),
);
const labelCard = ref<InstanceType<typeof LabelCard> | null>(null);

const countries = Object.keys(COUNTRY_AREAS);
// A known country fills in its growing area, unless one is already chosen.
watch(country, (c) => {
  const area = areaForCountry(c);
  if (area && !originArea.value) originArea.value = area;
});

// As saved, for beans from before detailed levels: their 5-step level shows
// until a detailed one is picked.
const savedRoastLevel = ref<RoastLevel | null>(null);
const savedDetailed = ref<DetailedRoastLevel | null>(null);

// Light to dark (the workspace's roastScale is "levels"): the 5-step level is
// chosen directly. A roast name the bean (or the bean copied) already has is
// kept while its level stays chosen; picking another level replaces it.
const level = ref<RoastLevel | ''>('');
const sourceDetailed = ref<DetailedRoastLevel | null>(null);
const keptName = computed(() =>
  sourceDetailed.value && level.value === DETAILED_ROAST_LEVELS[sourceDetailed.value].roastLevel ? sourceDetailed.value : null,
);

const loading = ref(editing.value || copyFrom !== null);
const saving = ref(false);
const error = ref('');
const submitted = ref(false); // show field errors only after a save attempt

// The 5-step level the API will store (docs/api/beans.md §4), shown read-only.
const impliedRoastLevel = computed<RoastLevel | null>(() => {
  if (detailedRoastLevel.value) return DETAILED_ROAST_LEVELS[detailedRoastLevel.value].roastLevel;
  return savedDetailed.value ? null : savedRoastLevel.value; // clearing a detailed level clears it
});

const inventoryParsed = computed(() => parseDecimal(inventory.value, { scale: 0, min: 0, max: 1_000_000 }));
const altitudeParsed = computed(() => (altitude.value.trim() ? parseAltitude(altitude.value, altitudeUnit.value) : null));
const priceParsed = computed(() =>
  price.value.trim() ? parseDecimal(price.value, { scale: 2, min: 0, max: 1_000_000, exclusiveMin: true, exclusiveMax: true }) : null,
);
const currencyCode = computed(() => currency.value.trim().toUpperCase());
const weightLossParsed = computed(() =>
  weightLoss.value.trim() ? parseDecimal(weightLoss.value, { scale: 1, min: 0, max: 40, exclusiveMin: true }) : null,
);
const bagParsed = computed(() => (bagWeight.value.trim() ? parseDecimal(bagWeight.value, { scale: 0, min: 1, max: 100_000 }) : null));
const websiteTrimmed = computed(() => website.value.trim());

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const today = localDateInput();
const fieldErrors = computed(() => ({
  roasterName: roasterName.value.trim() ? '' : 'Required',
  beanName: beanName.value.trim() ? '' : 'Required',
  altitude: altitudeParsed.value && !altitudeParsed.value.ok ? altitudeParsed.value.error : '',
  inventory: inventoryParsed.value.ok ? '' : inventoryParsed.value.error,
  price: priceParsed.value && !priceParsed.value.ok ? priceParsed.value.error : '',
  // Without a price the currency (often prefilled) is ignored, not an error.
  currency:
    priceParsed.value && currencyCode.value && !/^[A-Z]{3}$/.test(currencyCode.value)
      ? 'Use a 3-letter code, e.g. USD'
      : priceParsed.value && !currencyCode.value
        ? 'Required with a price'
        : '',
  bagWeight: bagParsed.value && !bagParsed.value.ok ? bagParsed.value.error : '',
  weightLoss: weightLossParsed.value && !weightLossParsed.value.ok ? weightLossParsed.value.error : '',
  purchaseDate: purchaseDate.value > today ? "Can't be in the future" : '',
  website: websiteTrimmed.value && !isHttpUrl(websiteTrimmed.value) ? 'Enter a web address starting with https://' : '',
}));
const valid = computed(() => Object.values(fieldErrors.value).every((e) => !e));

const perGram = computed(() => {
  if (!priceParsed.value?.ok || !bagParsed.value?.ok || !/^[A-Z]{3}$/.test(currencyCode.value)) return null;
  const p = pricePerGram({ priceAmount: priceParsed.value.value, priceCurrency: currencyCode.value, bagWeightGrams: bagParsed.value.value });
  return p ? formatPricePerGram(p) : null;
});

// Optional fields the workspace hides (Settings → Fields); ones this bean
// already records stay shown.
const { show, reveal } = useFieldVisibility();

// "Fill in from a photo" (docs/api/bean-label.md §4d): empty fields are
// filled, ones that say something else get a "Label says" suggestion. The
// lists go through it as text (LabelForm).
const varietiesText = computed({
  get: () => varieties.value.join(', '),
  set: (text: string) => (varieties.value = text.split(',').map((s) => s.trim()).filter(Boolean)),
});
const speciesText = computed({
  get: () => species.value.join(','),
  set: (text: string) => (species.value = SPECIES_KEYS.filter((s) => text.split(',').includes(s))),
});
const labelRefs = computed<Record<TextKey, Ref<string>>>(() => ({
  roasterName,
  beanName,
  process,
  country,
  region,
  producer,
  altitude,
  varieties: varietiesText,
  species: speciesText,
  flavorProfile,
  roastDate,
  roastLevel: roastScale.value === 'levels' ? level : detailedRoastLevel,
  roastType,
  blendType,
  bagWeight,
  batchNumber,
  website,
  notes,
}));
const suggestions = ref<Partial<Record<TextKey, LabelSuggestion>>>({});
const labelSummary = ref('');
// The pages the last web lookup looked at, to look for what it didn't pick
// out (docs/api/bean-label.md §4d). A read without a lookup keeps them.
const webSources = ref<string[]>([]);
function applyLabel({ fields, web, webSources: pages, webError, fromPhotos }: LabelAnswer): void {
  const refs = labelRefs.value;
  const form = { decaf: decaf.value } as LabelForm;
  for (const key of Object.keys(refs) as TextKey[]) form[key] = refs[key].value;
  const { fills, suggestions: offered } = labelFill(fields, form, {
    processes: processes.value,
    altitudeUnit: altitudeUnit.value,
    roastScale: roastScale.value,
  }, web);
  const filled = Object.keys(fills) as (keyof LabelForm)[];
  for (const key of filled) {
    if (key === 'decaf') decaf.value = true;
    else refs[key].value = fills[key] ?? '';
  }
  // A filled field shows even if the workspace hides it.
  const shown = filled.flatMap((key) => LABEL_FIELD_KEYS[key] ?? []).concat(Object.keys(offered).flatMap((key) => LABEL_FIELD_KEYS[key as TextKey] ?? []));
  reveal(Object.fromEntries(shown.map((key) => [key as FieldKey, true])));
  // What an earlier web lookup found stays, unless this read says something
  // about that field or the field already says it.
  const kept = Object.fromEntries(
    Object.entries(suggestions.value).filter(([key, s]) => s.source && !(key in offered) && refs[key as TextKey].value.trim() !== s.value.trim()),
  );
  suggestions.value = { ...kept, ...offered };
  if (web) webSources.value = pages;
  const fromWeb = Object.values(offered).filter((s) => s.source).length;
  const differ = Object.keys(offered).length - fromWeb;
  const parts = [
    filled.length ? `Filled ${filled.length} field${filled.length === 1 ? '' : 's'} from the label` : '',
    differ ? `${differ} differ${differ === 1 ? 's' : ''} from what's there (see "Label says")` : '',
    fromWeb ? `${fromWeb} suggestion${fromWeb === 1 ? '' : 's'} from the web (see "Web says")` : '',
  ].filter(Boolean);
  // A lookup alone (no photos) only speaks for the web.
  const summary = parts.length ? `${parts.join('; ')}. Check them before saving.` : fromPhotos ? 'Nothing new could be read from the label.' : '';
  const nothingOnWeb = web && fromWeb === 0 ? 'Nothing more was found on the web.' : '';
  labelSummary.value = [summary, nothingOnWeb, webError ?? ''].filter(Boolean).join(' ');
}
// What the form says, for "Look it up on the web" without photos.
const knownForLookUp = computed(() =>
  lookUpFields({
    roasterName: roasterName.value,
    beanName: beanName.value,
    processName: processes.value.find((p) => p.id === process.value)?.name ?? null,
    country: country.value,
    region: region.value,
    producer: producer.value,
    altitudeMasl: altitudeParsed.value?.ok ? altitudeParsed.value.value : null,
    varieties: varieties.value.length ? varieties.value : null,
    species: species.value.length ? species.value : null,
    flavorProfile: flavorProfile.value,
    roastType: roastType.value || null,
    blendType: blendType.value || null,
    decaf: decaf.value || null,
    bagWeightGrams: bagParsed.value?.ok ? bagParsed.value.value : null,
    website: website.value,
  }),
);
function useSuggestion(key: TextKey): void {
  const s = suggestions.value[key];
  if (s) labelRefs.value[key].value = s.value;
  const { [key]: _used, ...rest } = suggestions.value;
  suggestions.value = rest;
}

function fill(bean: Bean): void {
  reveal({
    'bean.process': bean.processId,
    'bean.blendType': bean.blendType,
    'bean.origin': bean.originArea ?? bean.country,
    'bean.region': bean.region,
    'bean.producer': bean.producer,
    'bean.altitude': bean.altitudeMasl,
    'bean.varieties': bean.varieties,
    'bean.species': bean.species,
    'bean.flavorProfile': bean.flavorProfile,
    'bean.decaf': bean.decaf,
    'bean.roastType': bean.roastType,
    'bean.roastDate': bean.roastDate,
    'bean.roastLevel': bean.detailedRoastLevel ?? bean.roastLevel,
    'bean.batchNumber': bean.batchNumber,
    'bean.weightLoss': bean.roastWeightLossPercent,
    'bean.price': bean.priceAmount,
    'bean.bagWeight': bean.bagWeightGrams,
    'bean.purchaseDate': bean.purchaseDate,
    'bean.greenSupplier': bean.greenSupplier,
    'bean.website': bean.website,
    'bean.rating': bean.rating,
    'bean.review': bean.review,
    'bean.notes': bean.notes,
    'bean.photos': bean.photos,
  });
  photos.value = bean.photos;
  roasterName.value = bean.roasterName;
  beanName.value = bean.beanName;
  process.value = bean.processId ?? '';
  originArea.value = bean.originArea ?? '';
  country.value = bean.country ?? '';
  region.value = bean.region ?? '';
  producer.value = bean.producer ?? '';
  altitude.value = altitudeText(bean.altitudeMasl, altitudeUnit.value);
  varieties.value = bean.varieties ?? [];
  species.value = bean.species ?? [];
  flavorProfile.value = bean.flavorProfile ?? '';
  blendType.value = bean.blendType ?? '';
  decaf.value = bean.decaf;
  roastType.value = bean.roastType ?? '';
  roastDate.value = toDateInput(bean.roastDate);
  detailedRoastLevel.value = bean.detailedRoastLevel ?? '';
  savedDetailed.value = bean.detailedRoastLevel;
  savedRoastLevel.value = bean.roastLevel;
  level.value = bean.roastLevel ?? '';
  sourceDetailed.value = bean.detailedRoastLevel;
  inventory.value = String(bean.inventoryWeightGrams);
  price.value = bean.priceAmount === null ? '' : bean.priceAmount.toFixed(2);
  currency.value = bean.priceCurrency ?? '';
  bagWeight.value = bean.bagWeightGrams === null ? '' : String(bean.bagWeightGrams);
  purchaseDate.value = bean.purchaseDate ?? '';
  greenSupplier.value = bean.greenSupplier ?? '';
  batchNumber.value = bean.batchNumber ?? '';
  weightLoss.value = bean.roastWeightLossPercent === null ? '' : String(bean.roastWeightLossPercent);
  website.value = bean.website ?? '';
  showOnPublicMenu.value = bean.showOnPublicMenu;
  rating.value = bean.rating;
  review.value = bean.review ?? '';
  notes.value = bean.notes ?? '';
}

// A copy keeps the coffee and drops what belongs to one bag: roast and
// purchase dates, the roast's weight loss and the rating. Stock starts at the bag weight, if known,
// and a numbered batch moves on to the next one.
function fillCopy(bean: Bean): void {
  fill(bean);
  batchNumber.value = nextBatch(bean.batchNumber);
  roastDate.value = '';
  weightLoss.value = '';
  purchaseDate.value = '';
  rating.value = null;
  review.value = '';
  photos.value = []; // a new bag: its own photos
  inventory.value = bean.bagWeightGrams === null ? '0' : String(bean.bagWeightGrams);
  // Nothing is stored for the copy yet: an older bean's 5-step level (no
  // roast name) is sent explicitly, else the API derives it from the name.
  savedDetailed.value = null;
  savedRoastLevel.value = bean.detailedRoastLevel ? null : bean.roastLevel;
  copyOf.value = `${bean.roasterName} ${bean.beanName}`;
}

// The label read runs in a store, so it carries on if you leave this page
// (docs/api/bean-label.md §4d): its answer is applied once the form is ready,
// now or when you come back.
const labelReads = useLabelReadStore();
const readKey = labelReadKey(props.id);
const readName = computed(() => `${roasterName.value} ${beanName.value}`.trim() || (editing.value ? 'this bean' : 'the new bean'));
const ready = ref(false); // loaded, or a kept draft restored: answers apply from then
watch(
  [() => labelReads.current?.status, ready],
  () => {
    if (!ready.value) return;
    const result = labelReads.take(readKey);
    if (result) applyLabel(result);
  },
  { immediate: true },
);

// Add bean keeps what's entered while you're elsewhere in the app
// (stores/beanDraft.ts); saving, Cancel and Start over drop it.
const drafts = useBeanDraftStore();
const draftRefs: Record<string, Ref<unknown>> = {
  roasterName, beanName, process, originArea, country, region, producer, altitude, varieties, species, flavorProfile, blendType, decaf, roastType,
  roastDate, detailedRoastLevel, inventory, price, currency, bagWeight, purchaseDate, greenSupplier, batchNumber, weightLoss,
  website, showOnPublicMenu, rating, review, notes, level, sourceDetailed, savedDetailed, savedRoastLevel, copyOf, suggestions, labelSummary, webSources,
};
const snapshot = () => Object.fromEntries(Object.entries(draftRefs).map(([name, r]) => [name, r.value]));
let blank = ''; // the form as it opened, to tell whether anything was entered
const restored = ref(false); // picked up a kept draft
const resetKey = ref(0); // remounts the photo cards on Start over
const draftPhotos = ref<File[]>([]);
const draftLabelPhotos = ref<File[]>([]);
let finished = false; // saved or cancelled: nothing to keep

const draftFits = () => !editing.value && drafts.draft?.workspaceId === workspaces.current?.id && drafts.draft?.from === copyFrom;
function restoreDraft(): boolean {
  const d = drafts.draft;
  if (!d || !draftFits()) return false;
  for (const [name, value] of Object.entries(d.values)) if (name in draftRefs) draftRefs[name]!.value = value;
  draftPhotos.value = d.photos;
  draftLabelPhotos.value = d.labelPhotos;
  revealEntered();
  restored.value = true;
  return true;
}
// Hidden fields that have something in them stay shown.
function revealEntered(): void {
  reveal({
    'bean.process': process.value, 'bean.blendType': blendType.value, 'bean.origin': originArea.value || country.value,
    'bean.region': region.value, 'bean.producer': producer.value, 'bean.altitude': altitude.value, 'bean.flavorProfile': flavorProfile.value,
    'bean.varieties': varieties.value.length ? varieties.value : null, 'bean.species': species.value.length ? species.value : null,
    'bean.decaf': decaf.value || null, 'bean.roastType': roastType.value, 'bean.roastDate': roastDate.value,
    'bean.roastLevel': detailedRoastLevel.value || level.value, 'bean.batchNumber': batchNumber.value, 'bean.weightLoss': weightLoss.value,
    'bean.price': price.value, 'bean.bagWeight': bagWeight.value, 'bean.purchaseDate': purchaseDate.value,
    'bean.greenSupplier': greenSupplier.value, 'bean.website': website.value, 'bean.rating': rating.value, 'bean.review': review.value, 'bean.notes': notes.value,
    'bean.photos': draftPhotos.value.length ? draftPhotos.value : null,
  });
}
function keepDraft(): void {
  const ws = workspaces.current?.id;
  if (editing.value || finished || !ws) return;
  const photos = photoPicker.value?.pendingFiles() ?? [];
  const labelPhotos = labelCard.value?.extraFiles() ?? [];
  const reading = labelReads.current?.key === readKey;
  const values = snapshot();
  if (JSON.stringify(values) === blank && !photos.length && !labelPhotos.length && !reading) drafts.clear();
  else drafts.keep({ workspaceId: ws, from: copyFrom, values, photos, labelPhotos });
}
onBeforeUnmount(keepDraft);
function startOver(): void {
  drafts.clear();
  if (labelReads.current?.key === readKey) labelReads.dismiss();
  for (const [name, value] of Object.entries(JSON.parse(blank) as Record<string, unknown>)) draftRefs[name]!.value = value;
  draftPhotos.value = [];
  draftLabelPhotos.value = [];
  restored.value = false;
  submitted.value = false;
  resetKey.value++;
}
function cancel(): void {
  finished = true;
  if (!editing.value) drafts.clear();
}

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (ws) {
    beanProcessesApi
      .list(ws)
      .then((r) => (processes.value = r.processes))
      .catch(() => (processes.value = [])); // the select just offers "Not sure"
    if (props.id) {
      beansApi
        .brewSummary(ws, props.id)
        .then((summary) => (brewSummary.value = summary))
        .catch(() => undefined); // only a hint
    }
  }
  // The form as it opens (for Start over), then what was kept, if any.
  await load();
  blank = JSON.stringify(snapshot());
  restoreDraft();
  ready.value = true;
});

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!editing.value && !copyFrom) {
    // A blank bean only needs the names; it opens without waiting for them.
    if (ws) beansApi.list(ws).then((r) => (otherBeans.value = r.beans)).catch(() => {});
    return;
  }
  try {
    const list = ws ? (await beansApi.list(ws)).beans : [];
    otherBeans.value = list.filter((b) => b.id !== props.id);
    if (copyFrom) {
      const from = list.find((b) => b.id === copyFrom);
      if (from) fillCopy(from);
      return; // gone: start a blank bean
    }
    const bean = list.find((b) => b.id === props.id);
    if (!bean) {
      error.value = 'This bean no longer exists.';
      return;
    }
    fill(bean);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!valid.value || !ws || !inventoryParsed.value.ok) return;
  const priceAmount = priceParsed.value?.ok ? priceParsed.value.value : null;
  // docs/api/beans.md §4: a roast name sets the 5-step level; without one,
  // roastLevel is sent on its own (a null name first clears a stored one).
  const roast: Pick<BeanInput, 'detailedRoastLevel' | 'roastLevel'> =
    roastScale.value === 'levels'
      ? keptName.value
        ? { detailedRoastLevel: keptName.value }
        : { detailedRoastLevel: null, roastLevel: level.value || null }
      : {
          detailedRoastLevel: detailedRoastLevel.value || null,
          // Only a copy of a bean with a 5-step level and no roast name.
          ...(!editing.value && !detailedRoastLevel.value && savedRoastLevel.value ? { roastLevel: savedRoastLevel.value } : {}),
        };
  const input: BeanInput = {
    roasterName: roasterName.value.trim(),
    beanName: beanName.value.trim(),
    processId: process.value || null,
    originArea: originArea.value || null,
    country: country.value.trim() || null,
    region: region.value.trim() || null,
    producer: producer.value.trim() || null,
    altitudeMasl: altitudeParsed.value?.ok ? altitudeParsed.value.value : null,
    varieties: varieties.value.length ? varieties.value : null,
    species: species.value.length ? species.value : null,
    flavorProfile: flavorProfile.value.trim() || null,
    blendType: blendType.value || null,
    decaf: decaf.value,
    roastType: roastType.value || null,
    roastDate: roastDate.value || null,
    ...roast,
    inventoryWeightGrams: inventoryParsed.value.value,
    priceAmount,
    priceCurrency: priceAmount === null ? null : currencyCode.value,
    bagWeightGrams: bagParsed.value?.ok ? bagParsed.value.value : null,
    roastWeightLossPercent: weightLossParsed.value?.ok ? weightLossParsed.value.value : null,
    purchaseDate: purchaseDate.value || null,
    greenSupplier: greenSupplier.value.trim() || null,
    batchNumber: batchNumber.value.trim() || null,
    website: websiteTrimmed.value || null,
    showOnPublicMenu: showOnPublicMenu.value,
    rating: rating.value,
    review: review.value.trim() || null,
    notes: notes.value.trim() || null,
  };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await beansApi.update(ws, props.id, input);
    else {
      const { bean } = await beansApi.create(ws, input);
      finished = true;
      drafts.clear();
      const photoError = (await photoPicker.value?.uploadPending(bean.id)) ?? '';
      if (photoError) {
        // The bean is saved: carry on editing it, with the photos that made it.
        if (input.priceCurrency) rememberCurrency(input.priceCurrency);
        await router.replace({ name: 'bean-edit', params: { id: bean.id } });
        await load();
        error.value = `Bean saved, but ${photoError}`;
        return;
      }
    }
    if (input.priceCurrency) rememberCurrency(input.priceCurrency);
    finished = true;
    await router.push({ name: 'beans' });
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
      <h1>{{ editing ? 'Edit bean' : copyOf ? 'Duplicate bean' : 'Add bean' }}</h1>
    </div>
    <p v-if="copyOf && !loading" class="muted small">
      A copy of {{ copyOf }}, for a new bag: set its roast date and stock. The original stays as it is.
    </p>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="restored" class="muted small" role="status">
      Picked up where you left off.
      <button type="button" class="btn-link small" @click="startOver">Start over</button>
    </p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section v-if="show('bean.photos') && workspaces.current" class="card stack">
        <h2>Photos</h2>
        <BeanPhotos
          :key="resetKey"
          ref="photoPicker"
          v-model="photos"
          :workspace-id="workspaces.current.id"
          :bean-id="props.id ?? null"
          :initial-pending="draftPhotos"
        />
      </section>
      <section v-if="settings.readLabels && workspaces.current" class="card stack">
        <h2>Fill in with AI</h2>
        <LabelCard
          :key="resetKey"
          ref="labelCard"
          :workspace-id="workspaces.current.id"
          :bean-photos="show('bean.photos') ? (photoPicker?.photoSources ?? []) : []"
          :web-lookup="settings.labelWebLookup"
          :website="website"
          :known="knownForLookUp"
          :read-key="readKey"
          :name="readName"
          :initial-extras="draftLabelPhotos"
        >
          <p v-if="labelSummary" class="small" role="status">{{ labelSummary }}</p>
          <div v-if="webSources.length" class="web-sources small">
            <p class="muted">Pages the web lookup looked at, for anything it missed:</p>
            <ul>
              <li v-for="url in webSources" :key="url">
                <a :href="url" target="_blank" rel="noopener noreferrer">{{ pageLabel(url) }}</a>
              </li>
            </ul>
          </div>
        </LabelCard>
      </section>
      <section class="card stack">
        <div class="field">
          <label for="roaster">Roaster<span class="req" aria-hidden="true">*</span></label>
          <NameInput id="roaster" v-model="roasterName" :names="roasterNames" aria-required="true" maxlength="255" placeholder="e.g. Onyx Coffee Lab" :aria-invalid="submitted && !!fieldErrors.roasterName" />
          <LabelHint v-if="suggestions.roasterName" :text="suggestions.roasterName.text" :source="suggestions.roasterName.source" @use="useSuggestion('roasterName')" />
          <span v-if="submitted && fieldErrors.roasterName" class="field-error">{{ fieldErrors.roasterName }}</span>
        </div>
        <div class="field">
          <label for="bean">Coffee<span class="req" aria-hidden="true">*</span></label>
          <NameInput id="bean" v-model="beanName" :names="coffeeNames" :prefer="roasterCoffees" :hint="false" aria-required="true" maxlength="255" placeholder="e.g. Ethiopia Guji" :aria-invalid="submitted && !!fieldErrors.beanName" />
          <span v-if="previousBag" class="small muted">
            You've had this coffee.
            <button type="button" class="btn-link small" @click="fillCopy(previousBag)">Start from your last bag</button>
          </span>
          <LabelHint v-if="suggestions.beanName" :text="suggestions.beanName.text" :source="suggestions.beanName.source" @use="useSuggestion('beanName')" />
          <span v-if="submitted && fieldErrors.beanName" class="field-error">{{ fieldErrors.beanName }}</span>
        </div>
        <div v-if="show('bean.process') || show('bean.blendType')" class="form-row">
          <div v-if="show('bean.process')" class="field">
            <label for="process">Process</label>
            <select id="process" v-model="process">
              <option value="">Not sure</option>
              <option v-for="p in processChoices" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <LabelHint v-if="suggestions.process" :text="suggestions.process.text" :source="suggestions.process.source" @use="useSuggestion('process')" />
          </div>
          <div v-if="show('bean.blendType')" class="field">
            <label for="blend-type">Type</label>
            <select id="blend-type" v-model="blendType">
              <option value="">Not sure</option>
              <option v-for="(b, key) in BLEND_TYPES" :key="key" :value="key">{{ b.label }}</option>
            </select>
            <LabelHint v-if="suggestions.blendType" :text="suggestions.blendType.text" :source="suggestions.blendType.source" @use="useSuggestion('blendType')" />
          </div>
        </div>
        <div v-if="show('bean.origin')" class="form-row">
          <div class="field">
            <label for="origin-area">Growing area</label>
            <select id="origin-area" v-model="originArea">
              <option value="">Not sure</option>
              <option v-for="(a, key) in ORIGIN_AREAS" :key="key" :value="key">{{ a.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="country">Country</label>
            <input id="country" v-model="country" maxlength="100" list="country-suggestions" placeholder="e.g. Ethiopia" />
            <datalist id="country-suggestions">
              <option v-for="c in countries" :key="c" :value="c" />
            </datalist>
            <LabelHint v-if="suggestions.country" :text="suggestions.country.text" :source="suggestions.country.source" @use="useSuggestion('country')" />
          </div>
        </div>
        <div v-if="show('bean.region') || show('bean.producer')" class="form-row">
          <div v-if="show('bean.region')" class="field">
            <label for="region">Region</label>
            <input id="region" v-model="region" maxlength="255" placeholder="e.g. Yirgacheffe" />
            <LabelHint v-if="suggestions.region" :text="suggestions.region.text" :source="suggestions.region.source" @use="useSuggestion('region')" />
          </div>
          <div v-if="show('bean.producer')" class="field">
            <label for="producer">Producer</label>
            <NameInput id="producer" v-model="producer" :names="producerNames" maxlength="255" placeholder="e.g. a farm, co-op or washing station" />
            <LabelHint v-if="suggestions.producer" :text="suggestions.producer.text" :source="suggestions.producer.source" @use="useSuggestion('producer')" />
          </div>
        </div>
        <div v-if="show('bean.altitude')" class="field altitude">
          <label for="altitude">Altitude ({{ ALTITUDE_LABELS[altitudeUnit] }})</label>
          <input id="altitude" v-model="altitude" inputmode="numeric" :placeholder="altitudeUnit === 'ft' ? 'e.g. 6400' : 'e.g. 1950'" :aria-invalid="submitted && !!fieldErrors.altitude" />
          <LabelHint v-if="suggestions.altitude" :text="suggestions.altitude.text" :source="suggestions.altitude.source" @use="useSuggestion('altitude')" />
          <span v-if="submitted && fieldErrors.altitude" class="field-error">{{ fieldErrors.altitude }}</span>
        </div>
        <div v-if="show('bean.varieties')" class="field">
          <label for="varieties">Variety</label>
          <NamesInput id="varieties" v-model="varieties" :names="varietyNames" placeholder="e.g. Bourbon, SL28" />
          <LabelHint v-if="suggestions.varieties" :text="suggestions.varieties.text" :source="suggestions.varieties.source" @use="useSuggestion('varieties')" />
        </div>
        <fieldset v-if="show('bean.species')" class="field species">
          <legend>Species</legend>
          <div class="species-choices">
            <button
              v-for="s in SPECIES_KEYS"
              :key="s"
              type="button"
              class="species-choice"
              :aria-pressed="species.includes(s)"
              @click="toggleSpecies(s)"
            >
              {{ COFFEE_SPECIES[s].label }}
            </button>
          </div>
          <LabelHint v-if="suggestions.species" :text="suggestions.species.text" :source="suggestions.species.source" @use="useSuggestion('species')" />
        </fieldset>
        <div v-if="show('bean.flavorProfile')" class="field">
          <label for="flavor-profile">Flavor profile</label>
          <textarea id="flavor-profile" v-model="flavorProfile" rows="2" maxlength="500" placeholder="e.g. Milk chocolate, plum, cane sugar" />
          <LabelHint v-if="suggestions.flavorProfile" :text="suggestions.flavorProfile.text" :source="suggestions.flavorProfile.source" @use="useSuggestion('flavorProfile')" />
        </div>
        <label v-if="show('bean.decaf')" class="checkbox">
          <input v-model="decaf" type="checkbox" />
          Decaf
        </label>
      </section>

      <section class="card stack">
        <h2>Roast</h2>
        <div v-if="show('bean.roastType') || show('bean.roastDate')" class="form-row">
          <div v-if="show('bean.roastType')" class="field">
            <label for="roast-type">Roasted for</label>
            <select id="roast-type" v-model="roastType">
              <option value="">Not sure</option>
              <option v-for="(r, key) in ROAST_TYPES" :key="key" :value="key">{{ r.label }}</option>
            </select>
            <LabelHint v-if="suggestions.roastType" :text="suggestions.roastType.text" :source="suggestions.roastType.source" @use="useSuggestion('roastType')" />
          </div>
          <div v-if="show('bean.roastDate')" class="field">
            <label for="roast-date">Roast date</label>
            <input id="roast-date" v-model="roastDate" type="date" :max="today" />
            <LabelHint v-if="suggestions.roastDate" :text="suggestions.roastDate.text" :source="suggestions.roastDate.source" @use="useSuggestion('roastDate')" />
          </div>
        </div>
        <div v-if="show('bean.batchNumber')" class="field">
          <label for="batch-number">Batch no.</label>
          <input id="batch-number" v-model="batchNumber" maxlength="50" placeholder="e.g. 3, for home roasts" />
          <LabelHint v-if="suggestions.batchNumber" :text="suggestions.batchNumber.text" :source="suggestions.batchNumber.source" @use="useSuggestion('batchNumber')" />
        </div>
        <template v-if="show('bean.roastLevel')">
          <div v-if="roastScale === 'levels'" class="field">
            <label for="roast-level">Roast level</label>
            <select id="roast-level" v-model="level" aria-describedby="roast-level-note">
              <option value="">Not sure</option>
              <option v-for="(r, key) in ROAST_LEVELS" :key="key" :value="key">{{ r.label }}</option>
            </select>
            <LabelHint v-if="suggestions.roastLevel" :text="suggestions.roastLevel.text" :source="suggestions.roastLevel.source" @use="useSuggestion('roastLevel')" />
            <span v-if="keptName" id="roast-level-note" class="hint">Recorded as {{ DETAILED_ROAST_LEVELS[keptName].label }}. Choosing another level replaces it.</span>
            <span v-else-if="sourceDetailed" id="roast-level-note" class="hint">Saving replaces the roast name {{ DETAILED_ROAST_LEVELS[sourceDetailed].label }}.</span>
          </div>
          <div v-else class="form-row">
            <div class="field">
              <label for="detailed-roast">Roast Level</label>
              <select id="detailed-roast" v-model="detailedRoastLevel">
                <option value="">Not sure</option>
                <option v-for="(d, key) in DETAILED_ROAST_LEVELS" :key="key" :value="key">{{ d.label }}</option>
              </select>
              <LabelHint v-if="suggestions.roastLevel" :text="suggestions.roastLevel.text" :source="suggestions.roastLevel.source" @use="useSuggestion('roastLevel')" />
            </div>
            <div class="field">
              <span id="implied-roast-label" class="label">Light to dark</span>
              <output class="readonly" for="detailed-roast" aria-labelledby="implied-roast-label" aria-live="polite">
                {{ impliedRoastLevel ? ROAST_LEVELS[impliedRoastLevel].label : '—' }}
              </output>
            </div>
          </div>
          <p class="muted small">The roast helps estimate how much coffee ends up in the cup when you scale a recipe.</p>
        </template>
        <div v-if="show('bean.weightLoss')" class="field">
          <label for="weight-loss">Roast weight loss (%)</label>
          <input id="weight-loss" v-model="weightLoss" inputmode="decimal" placeholder="e.g. 14.5" aria-describedby="weight-loss-hint" :aria-invalid="submitted && !!fieldErrors.weightLoss" />
          <span id="weight-loss-hint" class="hint">The green weight lost in roasting, if the roaster gives it: about 11–13% light, 14–16% medium, 17%+ dark.</span>
          <span v-if="submitted && fieldErrors.weightLoss" class="field-error">{{ fieldErrors.weightLoss }}</span>
        </div>
      </section>

      <section class="card stack">
        <h2>Stock and buying</h2>
        <div class="field">
          <label for="inventory">In stock (grams)<span class="req" aria-hidden="true">*</span></label>
          <input id="inventory" aria-required="true" v-model="inventory" inputmode="numeric" :aria-invalid="submitted && !!fieldErrors.inventory" />
          <span v-if="submitted && fieldErrors.inventory" class="field-error">{{ fieldErrors.inventory }}</span>
        </div>
        <div v-if="show('bean.price') || show('bean.bagWeight')" class="price-row">
          <template v-if="show('bean.price')">
            <div class="field">
              <label for="price">Bag price</label>
              <input id="price" v-model="price" inputmode="decimal" placeholder="e.g. 21.50" :aria-invalid="submitted && !!fieldErrors.price" />
              <span v-if="submitted && fieldErrors.price" class="field-error">{{ fieldErrors.price }}</span>
            </div>
            <div class="field">
              <label for="currency">Currency<span v-if="price.trim()" class="req" aria-hidden="true">*</span></label>
              <input
                id="currency"
                v-model="currency"
                class="currency"
                :aria-required="!!price.trim()"
                maxlength="3"
                autocapitalize="characters"
                placeholder="USD"
                :aria-invalid="submitted && !!fieldErrors.currency"
              />
              <span v-if="submitted && fieldErrors.currency" class="field-error">{{ fieldErrors.currency }}</span>
            </div>
          </template>
          <div v-if="show('bean.bagWeight')" class="field">
            <label for="bag-weight">Bag Weight (g)</label>
            <input id="bag-weight" v-model="bagWeight" inputmode="numeric" placeholder="e.g. 340" :aria-invalid="submitted && !!fieldErrors.bagWeight" />
            <LabelHint v-if="suggestions.bagWeight" :text="suggestions.bagWeight.text" :source="suggestions.bagWeight.source" @use="useSuggestion('bagWeight')" />
            <span v-if="submitted && fieldErrors.bagWeight" class="field-error">{{ fieldErrors.bagWeight }}</span>
          </div>
        </div>
        <p v-if="perGram" class="muted small" aria-live="polite">≈ {{ perGram }}</p>
        <div v-if="show('bean.purchaseDate') || show('bean.greenSupplier')" class="form-row">
          <div v-if="show('bean.purchaseDate')" class="field">
            <label for="purchase-date">Purchase date</label>
            <input id="purchase-date" v-model="purchaseDate" type="date" :max="today" :aria-invalid="submitted && !!fieldErrors.purchaseDate" />
            <span v-if="submitted && fieldErrors.purchaseDate" class="field-error">{{ fieldErrors.purchaseDate }}</span>
          </div>
          <div v-if="show('bean.greenSupplier')" class="field">
            <label for="green-supplier">Green bean supplier</label>
            <NameInput id="green-supplier" v-model="greenSupplier" :names="supplierNames" maxlength="255" />
          </div>
        </div>
        <div v-if="show('bean.website')" class="field">
          <label for="website">Website</label>
          <input id="website" v-model="website" type="url" inputmode="url" maxlength="500" placeholder="https://" :aria-invalid="submitted && !!fieldErrors.website" />
          <LabelHint v-if="suggestions.website" :text="suggestions.website.text" :source="suggestions.website.source" @use="useSuggestion('website')" />
          <span v-if="submitted && fieldErrors.website" class="field-error">{{ fieldErrors.website }}</span>
        </div>
        <label class="checkbox">
          <input v-model="showOnPublicMenu" type="checkbox" />
          Show on the public menu
        </label>
      </section>

      <section v-if="show('bean.rating') || show('bean.review') || show('bean.notes')" class="card stack review-card">
        <button v-if="canSuggestReview && show('bean.review')" class="btn-link small suggest-review" type="button" @click="suggestingReview = true">Suggest with AI</button>
        <RatingInput v-if="show('bean.rating')" v-model="rating" name="bean-rating" label="Rating" />
        <BrewAverageHint v-if="show('bean.rating')" :summary="brewSummary" />
        <div v-if="show('bean.review')" class="field">
          <label for="review">Review</label>
          <textarea id="review" v-model="review" rows="4" maxlength="2000" placeholder="e.g. Bright and juicy on the V60, a bit thin as espresso. Would buy again." />
        </div>
        <div v-if="show('bean.notes')" class="field">
          <label for="notes">Notes</label>
          <textarea id="notes" v-model="notes" rows="4" maxlength="2000" placeholder="e.g. Roaster suggests 1:16. Best after 10 days." />
          <LabelHint v-if="suggestions.notes" :text="suggestions.notes.text" :source="suggestions.notes.source" @use="useSuggestion('notes')" />
        </div>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !valid" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'beans' }" @click="cancel">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save bean' }}</button>
      </div>
    </form>
    <BeanReviewDialog
      v-if="props.id && brewSummary"
      :open="suggestingReview"
      :bean-id="props.id"
      :summary="brewSummary"
      :offer-rating="show('bean.rating')"
      @close="suggestingReview = false"
      @use-review="(text) => (review = text)"
      @use-rating="(value) => (rating = value)"
    />
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
h2 {
  font-size: 1.05rem;
}
.small {
  font-size: 0.85rem;
}
.review-card {
  position: relative;
}
.suggest-review {
  position: absolute;
  top: var(--space-3);
  right: var(--space-4);
}
.web-sources ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
}
.web-sources li {
  overflow-wrap: anywhere;
}
.altitude {
  max-width: 12rem;
}
.species {
  margin: 0;
  padding: 0;
  border: 0;
}
.species legend {
  padding: 0;
  margin-bottom: var(--space-1);
  font-weight: 600;
  font-size: 0.9rem;
}
.species-choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
/* Toggle chips: any number can be on (a blend of arabica and robusta). */
.species-choice {
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.species-choice[aria-pressed='true'] {
  border-color: var(--brand);
  background: var(--brand-tint);
  color: var(--brand);
  font-weight: 600;
}
/* Looks like a field, but is computed: the 5-step level the roast implies. */
.label {
  font-weight: 600;
  font-size: 0.9rem;
}
.readonly {
  display: flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
}
.price-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
}
@media (max-width: 380px) {
  .price-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.currency {
  text-transform: uppercase;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

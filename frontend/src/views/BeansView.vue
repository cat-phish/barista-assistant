<script setup lang="ts">
// Beans (docs/api/beans.md §4) as a table, split into Active and Archived
// tabs: filter, sort by any of BEAN_SORT_COLUMNS (headers or the dropdown); a
// row expands to its details and actions. Archiving an unrated bean asks for a
// rating, and unrated archived beans keep asking until rated.
import { computed, onMounted, ref, watch } from 'vue';
import { beansApi } from '../api/beans';
import { ApiError, errorMessage } from '../api/client';
import type { Bean } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import BeanTabs from '../components/BeanTabs.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ListControls from '../components/ListControls.vue';
import RatingInput from '../components/RatingInput.vue';
import RatingStars from '../components/RatingStars.vue';
import {
  BEAN_FILTERS,
  BEAN_PROCESSES,
  BEAN_SORT_COLUMNS,
  BLEND_TYPES,
  DETAILED_ROAST_LEVELS,
  ROAST_TYPES,
  formatAltitude,
  formatPrice,
  formatPricePerGram,
  isBeanFilter,
  daysBetween,
  latestThaw,
  periodsLatestFirst,
  pricePerGram,
  roastAgeDays,
  type BeanFilter,
  type BeanSortColumn,
} from '../lib/beans';
import { formatAdded, formatDay, localDateInput, toDateInput } from '../lib/format';
import { isSortKey, recallView, rememberView, sortArrow, sortBy, sortLabel, sortColumnOptions, toggleHeader } from '../lib/listSort';
import { effectiveRoastAge } from '../lib/roastAge';
import { ROAST_LEVELS } from '../lib/scale';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ archived?: boolean }>(); // the Archived tab (route prop)

const workspaces = useWorkspaceStore();
const beans = ref<Bean[]>([]);
const loading = ref(true);
const error = ref('');

const tab = computed(() => (props.archived ? 'archived' : 'active'));
const inTab = computed(() => beans.value.filter((b) => (b.archivedAt !== null) === !!props.archived));
const archivedCount = computed(() => beans.value.filter((b) => b.archivedAt !== null).length);

// View choices, remembered per workspace and tab. The default matches the
// old list (by roaster).
const viewKey = (what: string) => `beans.${tab.value}.${what}.${workspaces.current?.id ?? ''}`;
const DEFAULT_SORT = 'roaster_asc';
const sortChoices = sortColumnOptions(BEAN_SORT_COLUMNS);
const filterOptions = Object.entries(BEAN_FILTERS).map(([value, f]) => ({ value, label: f.label }));
const filter = ref<BeanFilter>('all');
const sort = ref(DEFAULT_SORT);
// The view is reused across tabs, so restore that tab's choices when it changes.
function restoreView(): void {
  const savedSort = recallView(viewKey('sort'));
  sort.value = isSortKey(savedSort, BEAN_SORT_COLUMNS) ? savedSort : DEFAULT_SORT;
  const savedFilter = recallView(viewKey('filter'));
  filter.value = isBeanFilter(savedFilter) ? savedFilter : 'all';
  openId.value = null;
}
watch(tab, restoreView);
watch(sort, (v) => rememberView(viewKey('sort'), v));
watch(filter, (v) => rememberView(viewKey('filter'), v));

const filterName = computed(() => BEAN_FILTERS[filter.value].label.toLowerCase());
const shown = computed(() => sortBy(inTab.value.filter(BEAN_FILTERS[filter.value].test), sort.value, BEAN_SORT_COLUMNS, (b) => b.beanName));
const unrated = computed(() => (props.archived ? inTab.value.filter((b) => b.rating === null) : []));

async function load(): Promise<void> {
  const id = workspaces.current?.id;
  if (!id) return;
  try {
    beans.value = (await beansApi.list(id)).beans;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  restoreView();
  await load();
});

const replace = (updated: Bean) => (beans.value = beans.value.map((b) => (b.id === updated.id ? updated : b)));

// One row open at a time.
const openId = ref<string | null>(null);
const toggle = (id: string) => (openId.value = openId.value === id ? null : id);

// Delete flow (docs/api/beans.md §4 frontend requirement): confirm, try the
// plain DELETE, and only if the server reports brew logs, ask again with the count.
const pending = ref<Bean | null>(null);
const brewLogCount = ref<number | null>(null);
const busy = ref(false);
const dialogError = ref('');
const understood = ref(false); // deleting the history needs "I understand" (CLAUDE.md rule 6)

function askDelete(bean: Bean): void {
  pending.value = bean;
  brewLogCount.value = null;
  understood.value = false;
  dialogError.value = '';
}
function closeDialog(): void {
  pending.value = null;
}

async function run(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  dialogError.value = '';
  try {
    await action();
    closeDialog();
    await load();
  } catch (err) {
    dialogError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = pending.value;
  if (!ws || !bean) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await beansApi.remove(ws, bean.id);
    closeDialog();
    await load();
  } catch (err) {
    const count = err instanceof ApiError && err.status === 409 ? err.body?.brewLogCount : undefined;
    if (typeof count === 'number') brewLogCount.value = count; // switch to the stronger warning
    else dialogError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

// A bean with history is better archived (or, archived already, hidden).
function keepInstead(): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = pending.value;
  if (!ws || !bean) return Promise.resolve();
  return run(() => beansApi.update(ws, bean.id, bean.archivedAt ? { showOnPublicMenu: false } : { archived: true }));
}

function deleteEverything(): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = pending.value;
  if (!ws || !bean) return Promise.resolve();
  return run(() => beansApi.remove(ws, bean.id, true));
}

// Archive and unarchive. Archiving an unrated bean goes through the rating
// dialog first; a rated one is archived straight away.
const busyId = ref<string | null>(null);
const rowError = ref('');
async function setArchived(bean: Bean, archived: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busyId.value = bean.id;
  rowError.value = '';
  try {
    replace((await beansApi.update(ws, bean.id, { archived })).bean);
    openId.value = null;
  } catch (err) {
    rowError.value = errorMessage(err);
  } finally {
    busyId.value = null;
  }
}
function askArchive(bean: Bean): void {
  if (bean.rating !== null) void setArchived(bean, true);
  else openRating(bean, 'archive');
}

// Rating dialog: 'archive' rates (optionally) and archives; 'rate' only rates.
const rateTarget = ref<Bean | null>(null);
const rateMode = ref<'archive' | 'rate'>('rate');
const rateValue = ref<number | null>(null);
const rateError = ref('');
const rating = ref(false);
function openRating(bean: Bean, mode: 'archive' | 'rate'): void {
  rateTarget.value = bean;
  rateMode.value = mode;
  rateValue.value = null;
  rateError.value = '';
}
async function saveRating(withRating: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = rateTarget.value;
  if (!ws || !bean) return;
  const value = withRating ? rateValue.value : null;
  if (rateMode.value === 'rate' && value === null) return;
  rating.value = true;
  rateError.value = '';
  try {
    const input = {
      ...(value !== null ? { rating: value } : {}),
      ...(rateMode.value === 'archive' ? { archived: true } : {}),
    };
    replace((await beansApi.update(ws, bean.id, input)).bean);
    rateTarget.value = null;
    openId.value = null;
  } catch (err) {
    rateError.value = errorMessage(err);
  } finally {
    rating.value = false;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const beanTitle = (b: Bean) => `${b.roasterName} ${b.beanName}`;

// The open period, if frozen now (bean.frozen says whether there is one).
function openFreeze(bean: Bean) {
  return bean.frozen ? (bean.freezePeriods.find((p) => p.thawedOn === null) ?? null) : null;
}

// The roast name when known ("City+"), else the 5-step level.
function roastLabel(bean: Bean): string | null {
  if (bean.detailedRoastLevel) return DETAILED_ROAST_LEVELS[bean.detailedRoastLevel].label;
  return bean.roastLevel ? ROAST_LEVELS[bean.roastLevel].label : null;
}

// Table columns, each a sort column (BEAN_SORT_COLUMNS). On phones the
// headers hide and the wide-only cells drop out (the frozen mark moves next
// to the name); the Sort by dropdown still has every column.
const HEADERS: Array<{ id: BeanSortColumn; text: string; title?: string; class?: string }> = [
  { id: 'name', text: 'Coffee' },
  { id: 'frozen', text: '❄', title: 'Frozen', class: 'center' },
  { id: 'roaster', text: 'Roaster' },
  { id: 'roast', text: 'Roast' },
  { id: 'process', text: 'Process' },
  { id: 'age', text: 'Age', title: 'Days off roast (not counting frozen days)' },
  { id: 'decaf', text: 'Caf', title: 'Caffeinated / decaf' },
  { id: 'stock', text: 'Stock' },
  { id: 'added', text: 'Added' },
  { id: 'rating', text: 'Rating', class: 'end' },
];
const TABLE_COLS =
  'minmax(0, 1.6fr) 1.5rem minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.1fr) 3.25rem 3.5rem 4rem 4.5rem 5.5rem';

// "12 d" off roast, frozen days excluded; "–" without a roast date.
function ageCell(bean: Bean): string {
  const days = roastAgeDays(bean);
  return days === null ? '–' : `${days} d`;
}

// "Colombia · Huila · Finca El Paraíso · 1,950 m"
function originLabel(bean: Bean): string | null {
  const parts = [bean.country, bean.region, bean.producer, bean.altitudeMasl === null ? null : formatAltitude(bean.altitudeMasl)];
  return parts.filter((p) => p).join(' · ') || null;
}

// "21.50 USD · 0.063 USD/g", or just the price without a bag weight.
function priceLabel(bean: Bean): string | null {
  if (bean.priceAmount === null || bean.priceCurrency === null) return null;
  const perGram = pricePerGram(bean);
  return formatPrice(bean.priceAmount, bean.priceCurrency) + (perGram ? ` · ${formatPricePerGram(perGram)}` : '');
}

// "9 days off roast", or while frozen "age paused at 9 days" (docs/api/beans.md §4).
function ageLabel(bean: Bean): string | null {
  if (!bean.roastDate) return null;
  const { ageDays, daysFrozen } = effectiveRoastAge(bean.roastDate, bean.freezePeriods, localDateInput());
  if (ageDays < 0) return 'roasts in the future';
  if (openFreeze(bean)) return `age paused at ${plural(ageDays, 'day')}`;
  const base = ageDays === 0 ? 'roasted today' : `${plural(ageDays, 'day')} off roast`;
  return daysFrozen > 0 ? `${base} (not counting ${plural(daysFrozen, 'day')} frozen)` : base;
}

// Freeze / thaw dialog
const freezeTarget = ref<Bean | null>(null);
const freezeDate = ref('');
const freezeError = ref('');
const freezing = ref(false);
const freezeAction = computed(() => (freezeTarget.value && openFreeze(freezeTarget.value) ? 'thaw' : 'freeze'));
// Same limits as the API: not before the roast / last thaw / freeze start, not in the future.
const freezeMin = computed(() => {
  const bean = freezeTarget.value;
  if (!bean) return '';
  const open = openFreeze(bean);
  if (open) return open.frozenOn;
  const lastThaw = latestThaw(bean.freezePeriods);
  const roast = toDateInput(bean.roastDate);
  return lastThaw > roast ? lastThaw : roast;
});

// Freeze history, oldest first as the API sends it: "Oct 3 – Oct 10 · 7 days".
function periodLabel(p: Bean['freezePeriods'][number]): string {
  const end = p.thawedOn ?? localDateInput();
  const days = daysBetween(p.frozenOn, end);
  return `${formatDay(p.frozenOn)} – ${p.thawedOn ? formatDay(p.thawedOn) : 'now'} · ${plural(days, 'day')}`;
}
const latestPeriodId = (bean: Bean) => periodsLatestFirst(bean.freezePeriods)[0]?.id ?? null;

// Correcting the latest period (docs/api/beans.md §4): its dates, un-thaw
// ("Still frozen"), or delete it. Same limits as the API.
const editTarget = ref<Bean | null>(null);
const editFrozenOn = ref('');
const editThawedOn = ref('');
const editStillFrozen = ref(false);
const confirmRemove = ref(false);
const editError = ref('');
const editing = ref(false);
const editMin = computed(() => {
  const bean = editTarget.value;
  if (!bean) return '';
  const previousThaw = periodsLatestFirst(bean.freezePeriods)[1]?.thawedOn ?? '';
  const roast = toDateInput(bean.roastDate);
  return previousThaw > roast ? previousThaw : roast;
});
const editProblem = computed(() => {
  const today = localDateInput();
  if (!editFrozenOn.value) return 'Pick the day it was frozen.';
  if (editMin.value && editFrozenOn.value < editMin.value) return `It can't be frozen before ${formatDay(editMin.value)}.`;
  if (editFrozenOn.value > today) return "It can't be frozen in the future.";
  if (editStillFrozen.value) return '';
  if (!editThawedOn.value) return 'Pick the day it was thawed, or tick Still frozen.';
  if (editThawedOn.value < editFrozenOn.value) return "It can't be thawed before it was frozen.";
  if (editThawedOn.value > today) return "It can't be thawed in the future.";
  return '';
});

function askEditFreeze(bean: Bean): void {
  const latest = periodsLatestFirst(bean.freezePeriods)[0];
  if (!latest) return;
  editTarget.value = bean;
  editFrozenOn.value = latest.frozenOn;
  editThawedOn.value = latest.thawedOn ?? '';
  editStillFrozen.value = latest.thawedOn === null;
  confirmRemove.value = false;
  editError.value = '';
}

async function saveFreezeEdit(action: 'save' | 'remove'): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = editTarget.value;
  if (!ws || !bean) return;
  if (action === 'save' && editProblem.value) return;
  editing.value = true;
  editError.value = '';
  try {
    const { bean: updated } =
      action === 'remove'
        ? await beansApi.removeLatestFreeze(ws, bean.id)
        : await beansApi.editLatestFreeze(ws, bean.id, { frozenOn: editFrozenOn.value, thawedOn: editStillFrozen.value ? null : editThawedOn.value });
    replace(updated);
    editTarget.value = null;
  } catch (err) {
    editError.value = errorMessage(err);
  } finally {
    editing.value = false;
  }
}

function askFreeze(bean: Bean): void {
  freezeTarget.value = bean;
  freezeDate.value = localDateInput();
  freezeError.value = '';
}

async function confirmFreeze(): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = freezeTarget.value;
  if (!ws || !bean || !freezeDate.value) return;
  freezing.value = true;
  freezeError.value = '';
  try {
    const { bean: updated } =
      freezeAction.value === 'freeze'
        ? await beansApi.freeze(ws, bean.id, freezeDate.value)
        : await beansApi.thaw(ws, bean.id, freezeDate.value);
    replace(updated);
    freezeTarget.value = null;
  } catch (err) {
    freezeError.value = errorMessage(err);
  } finally {
    freezing.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page wide">
    <div class="page-header">
      <h1>Beans</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'bean-new' }">Add bean</RouterLink>
    </div>
    <BeanTabs />

    <p v-if="loading" class="muted" aria-live="polite">Loading beans…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-else>
      <div v-if="inTab.length === 0" class="card empty">
        <template v-if="archived">
          <p>No archived beans.</p>
          <p>Archive a bean when it's finished: it leaves the brew picker and the menu, and its brews stay in the journal.</p>
        </template>
        <template v-else>
          <p>{{ archivedCount ? 'No active beans.' : 'No beans yet.' }}</p>
          <p v-if="workspaces.canEdit">Add the coffee you're brewing to start logging brews.</p>
        </template>
      </div>

      <template v-else>
        <section v-if="unrated.length && workspaces.canEdit" class="card rate-prompt" aria-labelledby="rate-prompt-title">
          <h2 id="rate-prompt-title">{{ unrated.length === 1 ? '1 archived bean needs' : `${unrated.length} archived beans need` }} a rating</h2>
          <p class="muted small">How it was helps you decide whether to buy it again.</p>
          <ul>
            <li v-for="b in unrated" :key="b.id">
              <span>{{ beanTitle(b) }}</span>
              <button class="btn-link" type="button" @click="openRating(b, 'rate')">Rate</button>
            </li>
          </ul>
        </section>

        <ListControls v-model:filter="filter" v-model:sort="sort" :sort-columns="sortChoices" :id-prefix="`beans-${tab}`" filter-label="Show" :filter-options="filterOptions" />
        <p v-if="rowError" class="form-error" role="alert">{{ rowError }}</p>
        <p v-if="shown.length === 0" class="card empty">No {{ filterName }} {{ archived ? 'archived ' : '' }}beans.</p>
        <div v-else class="data-table" :style="{ '--cols': TABLE_COLS }">
          <div class="data-row data-head">
            <button
              v-for="h in HEADERS"
              :key="h.id"
              class="data-th"
              :class="h.class"
              type="button"
              :title="h.title"
              :aria-label="sortLabel(sort, h.id, h.title ?? h.text)"
              @click="sort = toggleHeader(sort, h.id, BEAN_SORT_COLUMNS)"
            >
              {{ h.text }} <span aria-hidden="true">{{ sortArrow(sort, h.id) }}</span>
            </button>
          </div>
          <div v-for="bean in shown" :key="bean.id" class="data-item" :class="{ open: openId === bean.id }">
            <button class="data-row" type="button" :aria-expanded="openId === bean.id" @click="toggle(bean.id)">
              <span class="data-td primary">
                {{ bean.beanName }}<span v-if="openFreeze(bean)" class="frozen-mark phone-only" aria-label="frozen"> ❄</span>
              </span>
              <span class="data-td wide-only center">
                <span v-if="openFreeze(bean)" class="frozen-mark" title="Frozen" aria-label="Frozen">❄</span>
              </span>
              <span class="data-td first-on-phone">{{ bean.roasterName }}</span>
              <span class="data-td">{{ roastLabel(bean) ?? '–' }}</span>
              <span class="data-td wide-only">{{ bean.process ? BEAN_PROCESSES[bean.process].label : '–' }}</span>
              <span class="data-td wide-only">{{ ageCell(bean) }}</span>
              <span class="data-td wide-only" :title="bean.decaf ? 'Decaf' : 'Caffeinated'">{{ bean.decaf ? 'Decaf' : 'Caf' }}</span>
              <span class="data-td">{{ bean.inventoryWeightGrams }} g</span>
              <span class="data-td wide-only">{{ formatAdded(bean.createdAt) }}</span>
              <span class="data-td end">
                <RatingStars v-if="bean.rating !== null" :rating="bean.rating" />
                <span v-else class="muted">{{ archived ? 'Unrated' : '–' }}</span>
              </span>
            </button>
            <div v-if="openId === bean.id" class="data-details">
              <div class="badges">
                <span v-if="openFreeze(bean)" class="badge frozen">Frozen</span>
                <span v-if="bean.decaf" class="badge">Decaf</span>
                <span v-if="bean.roastType" class="badge">{{ ROAST_TYPES[bean.roastType].label }} roast</span>
                <span v-if="bean.blendType" class="badge">{{ BLEND_TYPES[bean.blendType].label }}</span>
                <span v-if="!bean.showOnPublicMenu" class="badge">Hidden from menu</span>
              </div>
              <p v-if="bean.flavorProfile" class="flavor">{{ bean.flavorProfile }}</p>
              <p class="facts">
                <span v-if="ageLabel(bean)">{{ ageLabel(bean) }}</span>
                <span v-if="openFreeze(bean)" class="frozen-since">Frozen since {{ formatDay(openFreeze(bean)!.frozenOn) }}</span>
                <span v-if="originLabel(bean)">{{ originLabel(bean) }}</span>
                <span v-if="priceLabel(bean)">{{ priceLabel(bean) }}</span>
                <a v-if="bean.website" :href="bean.website" target="_blank" rel="noopener noreferrer">Website</a>
              </p>
              <div v-if="bean.freezePeriods.length" class="freezes">
                <span class="muted small">Freeze history</span>
                <ul>
                  <li v-for="p in bean.freezePeriods" :key="p.id">
                    <span :class="{ 'frozen-since': p.thawedOn === null }">{{ periodLabel(p) }}</span>
                    <button v-if="workspaces.canEdit && p.id === latestPeriodId(bean)" class="btn-link" type="button" @click="askEditFreeze(bean)">Edit</button>
                  </li>
                </ul>
              </div>
              <p class="facts muted small">
                <span>Added {{ formatAdded(bean.createdAt) }}</span>
                <span v-if="bean.purchaseDate">Purchased {{ formatDay(bean.purchaseDate) }}</span>
                <span v-if="bean.greenSupplier">Green from {{ bean.greenSupplier }}</span>
                <span v-if="bean.archivedAt">Archived {{ formatAdded(bean.archivedAt) }}</span>
              </p>
              <p v-if="bean.notes" class="notes muted">{{ bean.notes }}</p>
              <div v-if="workspaces.canEdit" class="data-actions">
                <template v-if="bean.archivedAt">
                  <button v-if="bean.rating === null" class="btn-link" type="button" @click="openRating(bean, 'rate')">Rate</button>
                  <button class="btn-link" type="button" :disabled="busyId === bean.id" @click="setArchived(bean, false)">Unarchive</button>
                </template>
                <template v-else>
                  <button class="btn-link" type="button" @click="askFreeze(bean)">{{ openFreeze(bean) ? 'Thaw' : 'Freeze' }}</button>
                  <button class="btn-link" type="button" :disabled="busyId === bean.id" @click="askArchive(bean)">Archive</button>
                </template>
                <RouterLink class="btn-link" :to="{ name: 'bean-new', query: { from: bean.id } }">Duplicate</RouterLink>
                <RouterLink class="btn-link" :to="{ name: 'bean-edit', params: { id: bean.id } }">Edit</RouterLink>
                <button class="btn-link danger" type="button" @click="askDelete(bean)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </main>

  <ConfirmDialog
    :open="rateTarget !== null"
    :title="rateMode === 'archive' ? 'Archive this bean?' : 'Rate this bean'"
    @cancel="rateTarget = null"
  >
    <p v-if="rateMode === 'archive'">
      {{ rateTarget && beanTitle(rateTarget) }} will leave the brew picker and the menu; its brews stay in the journal.
      How was it? A rating helps you decide whether to buy it again.
    </p>
    <p v-else>How was {{ rateTarget && beanTitle(rateTarget) }}?</p>
    <RatingInput v-model="rateValue" name="archive-rating" label="Rating" />
    <p v-if="rateError" class="form-error" role="alert">{{ rateError }}</p>
    <template #actions>
      <template v-if="rateMode === 'archive'">
        <button class="btn btn-primary" type="button" :disabled="rating || rateValue === null" @click="saveRating(true)">Rate and archive</button>
        <button class="btn btn-secondary" type="button" :disabled="rating" @click="saveRating(false)">Skip rating</button>
      </template>
      <button v-else class="btn btn-primary" type="button" :disabled="rating || rateValue === null" @click="saveRating(true)">Save rating</button>
      <button class="btn btn-secondary" type="button" :disabled="rating" @click="rateTarget = null">Cancel</button>
    </template>
  </ConfirmDialog>

  <ConfirmDialog :open="editTarget !== null" title="Edit the latest freeze" @cancel="editTarget = null">
    <form id="freeze-edit-form" class="stack" @submit.prevent="saveFreezeEdit('save')">
      <p class="muted small">Fix a date you got wrong; the roast age is worked out again everywhere, including for the AI.</p>
      <div class="field">
        <label for="edit-frozen-on">Frozen on<span class="req" aria-hidden="true">*</span></label>
        <input id="edit-frozen-on" aria-required="true" v-model="editFrozenOn" type="date" :min="editMin || undefined" :max="localDateInput()" required />
      </div>
      <label class="checkbox">
        <input v-model="editStillFrozen" type="checkbox" />
        Still frozen
      </label>
      <div v-if="!editStillFrozen" class="field">
        <label for="edit-thawed-on">Thawed on<span class="req" aria-hidden="true">*</span></label>
        <input id="edit-thawed-on" aria-required="true" v-model="editThawedOn" type="date" :min="editFrozenOn || undefined" :max="localDateInput()" required />
      </div>
      <p v-if="editProblem" class="field-error">{{ editProblem }}</p>
      <p v-if="confirmRemove" class="form-error" role="alert">Delete this freeze? Its days will count toward the roast age again.</p>
      <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
    </form>
    <template #actions>
      <template v-if="confirmRemove">
        <button class="btn btn-danger" type="button" :disabled="editing" @click="saveFreezeEdit('remove')">Delete freeze</button>
        <button class="btn btn-secondary" type="button" :disabled="editing" @click="confirmRemove = false">Keep it</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" type="submit" form="freeze-edit-form" :disabled="editing || !!editProblem">Save</button>
        <button class="btn btn-danger" type="button" :disabled="editing" @click="confirmRemove = true">Delete this freeze</button>
        <button class="btn btn-secondary" type="button" :disabled="editing" @click="editTarget = null">Cancel</button>
      </template>
    </template>
  </ConfirmDialog>

  <ConfirmDialog
    :open="pending !== null"
    :title="brewLogCount === null ? 'Delete this bean?' : 'This bean has brew history'"
    @cancel="closeDialog"
  >
    <p v-if="brewLogCount === null">
      {{ pending?.roasterName }} {{ pending?.beanName }} will be removed.
    </p>
    <p v-else>
      Deleting it will also permanently delete its
      <strong>{{ brewLogCount }} brew log{{ brewLogCount === 1 ? '' : 's' }}</strong> and their AI suggestions.
      {{ pending?.archivedAt ? 'Consider hiding it from the menu instead.' : 'Consider archiving it instead: it leaves the brew picker and the menu, and its brews stay.' }}
    </p>
    <label v-if="brewLogCount !== null" class="checkbox">
      <input v-model="understood" type="checkbox" />
      I understand
    </label>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <template v-if="brewLogCount === null">
        <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="keepInstead">{{ pending?.archivedAt ? 'Hide from menu instead' : 'Archive instead' }}</button>
        <button class="btn btn-danger" type="button" :disabled="busy || !understood" @click="deleteEverything">Delete bean and history</button>
      </template>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="closeDialog">Cancel</button>
    </template>
  </ConfirmDialog>

  <ConfirmDialog
    :open="freezeTarget !== null"
    :title="freezeAction === 'freeze' ? 'Freeze this bean?' : 'Thaw this bean?'"
    @cancel="freezeTarget = null"
  >
    <form id="freeze-form" class="stack" @submit.prevent="confirmFreeze">
      <p v-if="freezeAction === 'freeze'">
        Its roast age stops counting while frozen and picks up again when you thaw it.
      </p>
      <p v-else>Its roast age starts counting again from where it paused.</p>
      <div class="field">
        <label for="freeze-date">{{ freezeAction === 'freeze' ? 'Frozen on' : 'Thawed on' }}<span class="req" aria-hidden="true">*</span></label>
        <input id="freeze-date" aria-required="true" v-model="freezeDate" type="date" :min="freezeMin || undefined" :max="localDateInput()" required />
      </div>
      <p v-if="freezeError" class="form-error" role="alert">{{ freezeError }}</p>
    </form>
    <template #actions>
      <button class="btn btn-primary" type="submit" form="freeze-form" :disabled="freezing || !freezeDate">
        {{ freezeAction === 'freeze' ? 'Freeze' : 'Thaw' }}
      </button>
      <button class="btn btn-secondary" type="button" :disabled="freezing" @click="freezeTarget = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.9rem;
}
/* Ten columns need more than the usual 640px page. */
.page.wide {
  max-width: 1080px;
}
.center {
  text-align: center;
}
.phone-only {
  display: none;
}
@media (max-width: 560px) {
  .wide-only {
    display: none;
  }
  .phone-only {
    display: inline;
  }
  /* The hidden frozen cell comes first, so the roaster would get the "·". */
  .first-on-phone::before {
    content: none !important;
  }
}
.frozen-mark,
.frozen-since {
  color: var(--frozen);
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.badges:empty {
  display: none;
}
.badge.frozen {
  background: var(--frozen-tint);
  color: var(--frozen);
}
.freezes ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.freezes li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.9rem;
}
.flavor {
  font-style: italic;
  font-size: 0.95rem;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 0.95rem;
}
.facts.small {
  font-size: 0.85rem;
}
.notes {
  font-size: 0.9rem;
  white-space: pre-line;
}
.rate-prompt {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border-left: 4px solid var(--brand);
}
.rate-prompt h2 {
  font-size: 1rem;
}
.rate-prompt ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rate-prompt li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
</style>

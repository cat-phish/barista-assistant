<script setup lang="ts">
// The chat's attach picker (docs/api/chat.md §12): brews, beans, recipes and
// Insights charts to send with the next message, ticked in a list like "Pick
// a brew…" (RepeatBrewPicker). Brews narrow to a period, bean, recipe, brewer
// or your own, and "Select all" ticks every brew that matches, up to the
// workspace's limit; "Attach as live period" saves the filters instead, as one
// item the worker runs again for each reply. Charts have their own tab and
// filters (ChartPicker). It edits the whole selection: what's already attached starts ticked.
// A native <dialog>: Escape or ✕ closes it; full screen on a phone.
import { computed, ref, watch } from 'vue';
import { beansApi } from '../api/beans';
import { brewersApi } from '../api/brewers';
import { brewLogsApi, type BrewLogQuery } from '../api/brews';
import type { ChatAttachment, ChatAttachmentKind } from '../api/chats';
import { errorMessage } from '../api/client';
import { recipesApi } from '../api/recipes';
import type { Bean, Brewer, BrewLog, Recipe } from '../api/types';
import { beanLabel } from '../lib/beans';
import { attachKey, beanAttachLabel, brewAttachLabel, countLabel, isPicked, KIND_NAMES, matches, PICKER_TABS, selectAll, toggle, withoutKind } from '../lib/chatAttach';
import { choiceDays, choiceSpec, PERIOD_CHOICES, periodLabel, type ChatPeriodSpec, type PeriodChoice } from '../lib/chatPeriod';
import { estimateTokens, tokenWarning } from '../lib/chatTokens';
import { formatListDay, localDateInput } from '../lib/format';
import { usePreferences } from '../composables/usePreferences';
import { useWorkspaceStore } from '../stores/workspace';
import BrewLogRow from './BrewLogRow.vue';
import ChartPicker from './ChartPicker.vue';
import FilterBar from './FilterBar.vue';

// periodCap: the brews a period sends in detail; periodBrews: how many each
// attached period held when picked, by id (for the token estimate).
const props = defineProps<{ open: boolean; selected: ChatAttachment[]; max: number; periodCap: number; periodBrews: ReadonlyMap<string, number> }>();
const emit = defineEmits<{ close: []; done: [attachments: ChatAttachment[], periodBrews: Map<string, number>] }>();
const { prefs } = usePreferences();
const workspaces = useWorkspaceStore();
const dialog = ref<HTMLDialogElement | null>(null);

const PAGE = 30;
const FETCH_ALL = 100; // the list route's largest page

const draft = ref<ChatAttachment[]>([]);
const tab = ref<Exclude<ChatAttachmentKind, 'period'>>('brew');
const error = ref('');
const notice = ref('');
const full = computed(() => draft.value.length >= props.max);
const countOf = (kind: ChatAttachmentKind) => draft.value.filter((a) => a.kind === kind).length;

// What the filters choose from, loaded on opening.
const beans = ref<Bean[]>([]);
const recipes = ref<Recipe[]>([]);
const brewers = ref<Brewer[]>([]);
const activeFirst = <T extends { archivedAt: string | null }>(list: T[], name: (x: T) => string): T[] =>
  [...list].sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || name(a).localeCompare(name(b)));

// Brews: newest first, PAGE at a time, through the filters.
const range = ref<PeriodChoice>('all');
const from = ref('');
const to = ref('');
const beanId = ref('');
const recipeId = ref('');
const brewerId = ref('');
// Only your own to start, as Insights has it; shown outside the folded
// filters so it's never hidden.
const mine = ref(true);
const logs = ref<BrewLog[]>([]);
const total = ref(0);
const loading = ref(false);

function query(): BrewLogQuery {
  const days = choiceDays(range.value, { from: from.value, to: to.value }, localDateInput(), prefs.value.weekStartsOn);
  return {
    beanId: beanId.value || undefined,
    recipeId: recipeId.value || undefined,
    brewerId: brewerId.value || undefined,
    mine: mine.value || undefined,
    from: days.from ?? undefined,
    to: days.to ?? undefined,
  };
}
const brewItem = (l: BrewLog): ChatAttachment => ({ kind: 'brew', id: l.id, label: brewAttachLabel(l) });
// The filters in words, for the folded filter bar.
const brewSummary = computed(() => {
  const nameIn = <T extends { id: string }>(list: T[], id: string, name: (x: T) => string) => {
    const found = list.find((x) => x.id === id);
    return found ? name(found) : null;
  };
  const period = range.value === 'custom' ? `${from.value ? formatListDay(from.value) : 'the start'} – ${to.value ? formatListDay(to.value) : 'today'}` : range.value === 'all' ? null : PERIOD_CHOICES[range.value];
  const parts = [
    period,
    beanId.value && nameIn(beans.value, beanId.value, beanLabel),
    recipeId.value && nameIn(recipes.value, recipeId.value, (r) => r.name),
    brewerId.value && nameIn(brewers.value, brewerId.value, (b) => b.name),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No filters';
});

async function loadBrews(fresh: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await brewLogsApi.list(ws, { ...query(), limit: PAGE, offset: fresh ? 0 : logs.value.length });
    logs.value = fresh ? res.brewLogs : [...logs.value, ...res.brewLogs];
    total.value = res.total;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

// Every matching brew, newest first, until the selection is full.
async function selectAllBrews(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const q = query();
    let picked = draft.value;
    let left = 0;
    let offset = 0;
    let matching = 0;
    do {
      const res = await brewLogsApi.list(ws, { ...q, limit: FETCH_ALL, offset });
      matching = res.total;
      offset += res.brewLogs.length;
      ({ selection: picked, left } = selectAll(picked, res.brewLogs.map(brewItem), props.max));
      if (!res.brewLogs.length) break;
    } while (left === 0 && offset < matching && picked.length < props.max);
    const added = picked.length - draft.value.length;
    draft.value = picked;
    if (left > 0 || (offset < matching && picked.length >= props.max)) notice.value = `Added the newest ${added} of the ${matching} that match: up to ${props.max} can be attached.`;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

// The filters as one live item (docs/api/chat.md §12, "Periods"): the same
// filters are the same period, so it's added once.
const periods = computed(() => draft.value.filter((a) => a.kind === 'period'));
const periodBrews = ref(new Map<string, number>());
const sameSpec = (a: ChatPeriodSpec, b: ChatPeriodSpec) => (Object.keys(a) as Array<keyof ChatPeriodSpec>).every((k) => a[k] === b[k]);
const currentSpec = computed(() =>
  choiceSpec(range.value, { from: from.value, to: to.value }, localDateInput(), prefs.value.weekStartsOn, {
    beanId: beanId.value || null,
    recipeId: recipeId.value || null,
    brewerId: brewerId.value || null,
    mine: mine.value,
  }),
);
const periodAttached = computed(() => {
  const spec = currentSpec.value;
  return !!spec && periods.value.some((a) => a.period && sameSpec(a.period, spec));
});
function attachPeriod(): void {
  const spec = currentSpec.value;
  if (!spec || periodAttached.value || full.value) return;
  const nameOf = <T extends { id: string }>(list: T[], id: string | null, name: (x: T) => string): string | null => {
    const found = id ? list.find((x) => x.id === id) : undefined;
    return found ? name(found) : null;
  };
  // As the server labels it (backend chatPeriod.ts), which sends its own back.
  const label = periodLabel(spec, {
    bean: nameOf(beans.value, spec.beanId, (b) => b.beanName),
    recipe: nameOf(recipes.value, spec.recipeId, (r) => r.name),
    brewer: nameOf(brewers.value, spec.brewerId, (b) => b.name),
  });
  const id = crypto.randomUUID();
  draft.value = [...draft.value, { kind: 'period', id, label, period: spec }];
  periodBrews.value = new Map(periodBrews.value).set(id, total.value);
  notice.value = '';
}
function removePeriod(item: ChatAttachment): void {
  draft.value = draft.value.filter((a) => attachKey(a) !== attachKey(item));
}
const warning = computed(() => tokenWarning(estimateTokens(draft.value, periodBrews.value, props.periodCap)));

// Beans and recipes: all of them, searched here.
const search = ref('');
const beanItems = computed(() =>
  activeFirst(beans.value, beanLabel)
    .filter((b) => matches(`${beanLabel(b)} ${b.country ?? ''}`, search.value))
    .map((b) => ({ bean: b, item: { kind: 'bean', id: b.id, label: beanAttachLabel(b) } as ChatAttachment })),
);
const recipeItems = computed(() =>
  activeFirst(recipes.value, (r) => r.name)
    .filter((r) => matches(`${r.name} ${r.brewer.name}`, search.value))
    .map((r) => ({ recipe: r, item: { kind: 'recipe', id: r.id, label: r.name } as ChatAttachment })),
);
const shownItems = computed(() => (tab.value === 'bean' ? beanItems.value.map((x) => x.item) : recipeItems.value.map((x) => x.item)));
function selectAllShown(): void {
  notice.value = '';
  const { selection, left } = selectAll(draft.value, shownItems.value, props.max);
  draft.value = selection;
  if (left > 0) notice.value = `${left} didn't fit: up to ${props.max} can be attached.`;
}

// Drawn once the Charts tab is first opened, then kept, filters and all.
const chartsSeen = ref(false);
function pickAllCharts(items: ChatAttachment[]): void {
  notice.value = '';
  const { selection, left } = selectAll(draft.value, items, props.max);
  draft.value = selection;
  if (left > 0) notice.value = `${left} didn't fit: up to ${props.max} can be attached.`;
}

function pick(item: ChatAttachment): void {
  draft.value = toggle(draft.value, item, props.max);
}
function clearTab(): void {
  draft.value = withoutKind(draft.value, tab.value);
  notice.value = '';
}

async function loadLists(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [b, r, m] = await Promise.all([beansApi.list(ws), recipesApi.list(ws), brewersApi.list(ws)]);
    beans.value = b.beans;
    recipes.value = r.recipes;
    brewers.value = activeFirst(m.brewers, (x) => x.name);
  } catch (err) {
    error.value = errorMessage(err);
  }
}

watch(
  () => props.open,
  (open) => {
    if (open && !dialog.value?.open) {
      draft.value = [...props.selected];
      periodBrews.value = new Map(props.periodBrews);
      notice.value = '';
      search.value = '';
      dialog.value?.showModal();
      void loadLists();
      void loadBrews(true);
    }
    if (!open && dialog.value?.open) dialog.value.close();
  },
  { flush: 'post' },
);
watch([range, from, to, beanId, recipeId, brewerId, mine], () => {
  notice.value = '';
  if (range.value !== 'custom' || (from.value && to.value) || (!from.value && !to.value)) void loadBrews(true);
});
watch(tab, (t) => {
  search.value = '';
  notice.value = '';
  if (t === 'chart') chartsSeen.value = true;
});
</script>

<template>
  <dialog ref="dialog" class="attach" aria-labelledby="attach-title" @cancel.prevent="emit('close')">
    <div class="head">
      <h2 id="attach-title">Attach to your message</h2>
      <button class="btn-link close" type="button" aria-label="Close" @click="emit('close')">✕</button>
    </div>

    <div class="tabs" role="tablist" aria-label="What to attach" :style="{ '--tabs': PICKER_TABS.length }">
      <button
        v-for="k in PICKER_TABS"
        :id="`attach-tab-${k}`"
        :key="k"
        type="button"
        role="tab"
        :aria-selected="tab === k"
        aria-controls="attach-panel"
        :class="{ active: tab === k }"
        @click="tab = k"
      >
        {{ KIND_NAMES[k].one }}s<span v-if="countOf(k) + (k === 'brew' ? periods.length : 0)" class="count">{{ countOf(k) + (k === 'brew' ? periods.length : 0) }}</span>
      </button>
    </div>

    <div id="attach-panel" class="panel" role="tabpanel" :aria-labelledby="`attach-tab-${tab}`">
      <template v-if="tab === 'brew'">
        <FilterBar :summary="brewSummary">
        <div class="filters">
          <div class="field">
            <label for="attach-range">Period</label>
            <select id="attach-range" v-model="range">
              <option v-for="(text, key) in PERIOD_CHOICES" :key="key" :value="key">{{ text }}</option>
            </select>
          </div>
          <template v-if="range === 'custom'">
            <div class="field">
              <label for="attach-from">From</label>
              <input id="attach-from" v-model="from" type="date" />
            </div>
            <div class="field">
              <label for="attach-to">To</label>
              <input id="attach-to" v-model="to" type="date" />
            </div>
          </template>
          <div class="field">
            <label for="attach-bean">Bean</label>
            <select id="attach-bean" v-model="beanId">
              <option value="">All beans</option>
              <option v-for="b in activeFirst(beans, beanLabel)" :key="b.id" :value="b.id">{{ beanLabel(b) }}</option>
            </select>
          </div>
          <div class="field">
            <label for="attach-recipe">Recipe</label>
            <select id="attach-recipe" v-model="recipeId">
              <option value="">All recipes</option>
              <option v-for="r in activeFirst(recipes, (x) => x.name)" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
          <div class="field">
            <label for="attach-brewer">Brewer</label>
            <select id="attach-brewer" v-model="brewerId">
              <option value="">All brewers</option>
              <option v-for="m in brewers" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>
        </div>
        <div class="live">
          <button type="button" class="btn btn-secondary" :disabled="!currentSpec || periodAttached || full" @click="attachPeriod">
            {{ periodAttached ? 'Attached as a live period' : 'Attach these filters as a live period' }}
          </button>
          <span class="muted small">One item, with Only mine as it's set below: brews logged, changed or deleted later are seen by the next reply.</span>
        </div>
        </FilterBar>
        <label class="checkbox mine">
          <input v-model="mine" type="checkbox" />
          Only mine
        </label>
        <div class="bulk">
          <span class="muted small" aria-live="polite">{{ loading && !logs.length ? 'Loading…' : `${total} ${total === 1 ? 'brew matches' : 'brews match'}` }}</span>
          <button v-if="total" type="button" class="btn-link" :disabled="loading || full" @click="selectAllBrews">Select all {{ total }}</button>
          <button v-if="countOf('brew')" type="button" class="btn-link" @click="clearTab">Clear</button>
        </div>
        <ul v-if="periods.length" class="live-list" aria-label="Live periods attached">
          <li v-for="p in periods" :key="p.id" class="chip">
            {{ p.label }}
            <button type="button" class="btn-link remove" :aria-label="`Remove ${p.label}`" @click="removePeriod(p)">×</button>
          </li>
        </ul>
      </template>
      <template v-else-if="tab !== 'chart'">
        <div class="field">
          <label :for="`attach-search-${tab}`" class="visually-hidden">Search {{ KIND_NAMES[tab].many }}</label>
          <input :id="`attach-search-${tab}`" v-model="search" type="search" :placeholder="`Search ${KIND_NAMES[tab].many}`" />
        </div>
        <div class="bulk">
          <span class="muted small">{{ countLabel(tab, shownItems.length) }}</span>
          <button v-if="shownItems.length" type="button" class="btn-link" :disabled="full" @click="selectAllShown">Select all {{ shownItems.length }}</button>
          <button v-if="countOf(tab)" type="button" class="btn-link" @click="clearTab">Clear</button>
        </div>
      </template>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="muted small" role="status">{{ notice }}</p>

      <ChartPicker v-if="chartsSeen" v-show="tab === 'chart'" :selected="draft" :full="full" @toggle="pick" @pick-all="pickAllCharts" @clear="clearTab" />
      <ul v-if="tab !== 'chart'" class="rows">
        <template v-if="tab === 'brew'">
          <li v-for="l in logs" :key="l.id">
            <label class="row" :class="{ picked: isPicked(draft, brewItem(l)) }">
              <input type="checkbox" :checked="isPicked(draft, brewItem(l))" :disabled="full && !isPicked(draft, brewItem(l))" @change="pick(brewItem(l))" />
              <BrewLogRow :log="l" />
            </label>
          </li>
          <li v-if="!loading && !logs.length" class="muted">No brews match.</li>
        </template>
        <template v-else-if="tab === 'bean'">
          <li v-for="{ bean, item } in beanItems" :key="bean.id">
            <label class="row" :class="{ picked: isPicked(draft, item) }">
              <input type="checkbox" :checked="isPicked(draft, item)" :disabled="full && !isPicked(draft, item)" @change="pick(item)" />
              <span class="text">
                <strong>{{ beanLabel(bean) }}</strong>
                <span class="muted small">
                  <template v-if="bean.roastDate">Roasted {{ formatListDay(bean.roastDate.slice(0, 10)) }}</template>
                  <template v-if="bean.archivedAt"><template v-if="bean.roastDate"> · </template>Archived</template>
                </span>
              </span>
            </label>
          </li>
          <li v-if="!beanItems.length" class="muted">{{ search ? 'No beans match.' : 'No beans yet.' }}</li>
        </template>
        <template v-else>
          <li v-for="{ recipe, item } in recipeItems" :key="recipe.id">
            <label class="row" :class="{ picked: isPicked(draft, item) }">
              <input type="checkbox" :checked="isPicked(draft, item)" :disabled="full && !isPicked(draft, item)" @change="pick(item)" />
              <span class="text">
                <strong>{{ recipe.name }}</strong>
                <span class="muted small">{{ recipe.brewer.name }}<template v-if="recipe.archivedAt"> · Archived</template></span>
              </span>
            </label>
          </li>
          <li v-if="!recipeItems.length" class="muted">{{ search ? 'No recipes match.' : 'No recipes yet.' }}</li>
        </template>
      </ul>
      <button v-if="tab === 'brew' && logs.length < total" class="btn btn-secondary more" type="button" :disabled="loading" @click="loadBrews(false)">
        {{ loading ? 'Loading…' : `Load more (${total - logs.length} left)` }}
      </button>
    </div>

    <div class="foot">
      <span class="muted small" aria-live="polite">
        {{ draft.length }} selected · up to {{ max }}<template v-if="full">, so nothing more can be ticked</template>
        <span v-if="warning" class="token-warning">{{ warning }}</span>
      </span>
      <div class="buttons">
        <button type="button" class="btn btn-secondary" @click="emit('close')">Cancel</button>
        <button type="button" class="btn btn-primary" @click="emit('done', draft, periodBrews)">Attach</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.attach {
  width: min(640px, calc(100vw - 2 * var(--space-3)));
  height: min(92dvh, 900px);
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: var(--text);
}
.attach[open] {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.attach::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  font-size: 1.2rem;
  margin: 0;
}
.close {
  font-size: 1.1rem;
  min-height: var(--tap);
  min-width: var(--tap);
}
p {
  margin: 0;
}
/* The look of SectionTabs, as buttons. */
.tabs {
  display: grid;
  grid-template-columns: repeat(var(--tabs), minmax(0, 1fr));
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--brand-tint);
  border-radius: var(--radius);
}
.tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: var(--tap);
  padding: 0 var(--space-2);
  border: none;
  border-radius: calc(var(--radius) - 2px);
  background: none;
  color: var(--brand);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.tabs button.active {
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.count {
  min-width: 1.4em;
  padding: 0 0.35em;
  border-radius: 999px;
  background: var(--brand);
  color: var(--surface);
  font-size: 0.75rem;
  line-height: 1.4;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
  min-height: 0;
  /* On a short screen the whole panel scrolls, not a squeezed list. */
  overflow-y: auto;
}
.live {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.live-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.live-list .chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.15em 0.6em;
  border-radius: 999px;
  background: var(--brand-tint);
  font-size: 0.85rem;
}
.live-list .remove {
  min-height: var(--tap);
  min-width: var(--tap);
}
.token-warning {
  display: block;
  color: var(--warning);
}
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-2);
  align-items: end;
}
.filters select,
.filters input[type='date'] {
  width: 100%;
  min-width: 0;
}
.mine {
  min-height: var(--tap);
}
.bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
}
.bulk > :first-child {
  margin-right: auto;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  flex: 1 0 12rem;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}
.row:hover,
.row:focus-within {
  border-color: var(--brand);
}
.row.picked {
  border-color: var(--brand-line);
  background: var(--brand-tint);
}
.row input {
  margin-top: 3px;
  flex: none;
}
.row > :last-child {
  flex: 1;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.more {
  align-self: center;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
.buttons {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}
@media (max-width: 600px) {
  .attach {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    border-radius: 0;
    padding: var(--space-3);
  }
  .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

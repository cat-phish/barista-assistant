<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { beansApi } from '../api/beans';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import { brewersApi } from '../api/brewers';
import { recipesApi } from '../api/recipes';
import { recipeStylesApi } from '../api/recipeStyles';
import type { Bean, Brewer, BrewLog, Recipe, RecipeStyleItem } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import FilterBar from '../components/FilterBar.vue';
import ListDataBar from '../components/ListDataBar.vue';
import RatingStars from '../components/RatingStars.vue';
import { useSelection } from '../composables/useSelection';
import { batchSuffix, beanLabel } from '../lib/beans';
import { analysisStatus, formatClock } from '../lib/analysisStatus';
import { formatDoseLine, formatGrams, formatGrind, formatListDay, formatTime, formatWhen, localDateInput } from '../lib/format';
import { hasFilters, journalSummary, parseJournalQuery, STATUSES, toApiQuery, toJournalQuery, type JournalFilters } from '../lib/journalFilters';
import { RANGES } from '../lib/statsRange';
import { formatSize } from '../lib/servings';
import { batchStock, stockText } from '../lib/batch';
import { formatTemp } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import { useWorkspaceStore } from '../stores/workspace';

const PAGE_SIZE = 20;

// The card's AI pill (docs/api/analysis.md §8): not analyzed yet, or when an
// automatic analysis is due. Nothing once it has a suggestion.
function aiBadge(log: BrewLog): { kind: 'due' | 'none'; label: string; title: string } | null {
  const s = analysisStatus(log);
  if (s.kind === 'due') return { kind: 'due', label: `AI at ${formatClock(s.at)}`, title: 'An automatic AI suggestion is on its way' };
  if (s.kind === 'none') return { kind: 'none', label: 'Not analyzed', title: s.reason ?? 'No AI suggestion yet' };
  return null;
}

const workspaces = useWorkspaceStore();
const { temperatureUnit, recipeRoastLevel } = usePreferences();
// A cold brew batch's stock on its card (docs/api/brew-servings.md §6c).
const stock = (log: BrewLog) => {
  const st = batchStock(log, recipeRoastLevel.value);
  return st ? { text: stockText(st), finished: st.finished } : null;
};
const route = useRoute();
const router = useRouter();

const beans = ref<Bean[]>([]);
const logs = ref<BrewLog[]>([]);
const total = ref(0);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');

const styles = ref<RecipeStyleItem[]>([]);
const brewers = ref<Brewer[]>([]);
const recipes = ref<Recipe[]>([]);

// The filters live in the URL (lib/journalFilters.ts), so Back and reloads keep them.
const filters = computed(() => parseJournalQuery(route.query));
const filtered = computed(() => hasFilters(filters.value));
function setFilter<K extends keyof JournalFilters>(key: K, value: JournalFilters[K]): void {
  void router.replace({ query: toJournalQuery({ ...filters.value, [key]: value }) });
}
// Only mine isn't a folded filter, so clearing leaves it (CLAUDE.md rule 13).
const clearFilters = () => void router.replace({ query: filters.value.mine ? {} : { mine: '0' } });
// A v-model for each filter.
const model = <K extends keyof JournalFilters>(key: K) => computed({ get: () => filters.value[key], set: (v: JournalFilters[K]) => setFilter(key, v) });
const beanFilter = model('bean');
const styleFilter = model('style');
const brewerFilter = model('brewer');
const recipeFilter = model('recipe');
const rangeFilter = model('range');
const fromFilter = model('from');
const toFilter = model('to');
const mineFilter = model('mine');
const statusFilter = model('status');

// Archived ones last; a hidden style only while it's picked.
const activeFirst = <T extends { archivedAt: string | null; name: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.name.localeCompare(b.name));
const styleOptions = computed(() => styles.value.filter((st) => !st.hidden || st.id === filters.value.style));
const names = computed(() => {
  const out = new Map<string, string>();
  for (const b of beans.value) out.set(b.id, beanLabel(b));
  for (const x of [...styles.value, ...brewers.value, ...recipes.value]) out.set(x.id, x.name);
  return out;
});
const summary = computed(() => journalSummary(filters.value, (id) => names.value.get(id), (d) => formatListDay(d)));

async function load(reset: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  if (reset) loading.value = true;
  else loadingMore.value = true;
  error.value = '';
  try {
    const page = await brewLogsApi.list(ws, {
      ...toApiQuery(filters.value, localDateInput()),
      limit: PAGE_SIZE,
      offset: reset ? 0 : logs.value.length,
    });
    logs.value = reset ? page.brewLogs : [...logs.value, ...page.brewLogs];
    total.value = page.total;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (ws) {
    beansApi.list(ws).then((r) => (beans.value = r.beans)).catch(() => undefined);
    recipeStylesApi.list(ws).then((r) => (styles.value = r.styles)).catch(() => undefined);
    brewersApi.list(ws).then((r) => (brewers.value = activeFirst(r.brewers))).catch(() => undefined);
    recipesApi.list(ws).then((r) => (recipes.value = activeFirst(r.recipes))).catch(() => undefined);
  }
  await load(true);
});
watch(() => JSON.stringify(toJournalQuery(filters.value)), () => load(true));
// Select mode for exporting some brews (components/ExportBar.vue): a card
// is then a button that ticks it, not a link.
const selection = useSelection();
const cardProps = (id: string) =>
  selection.selecting
    ? { type: 'button', 'aria-pressed': selection.has(id), onClick: () => selection.toggle(id) }
    : { to: { name: 'journal-entry', params: { id } } };
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Journal</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'brew' }">New brew</RouterLink>
    </div>

    <label class="checkbox mine">
      <input v-model="mineFilter" type="checkbox" />
      Only mine
    </label>
    <FilterBar :summary="summary" describe="Showing">
      <div class="filters">
        <div v-if="styleOptions.length > 1" class="field">
          <label for="filter-style">Style</label>
          <select id="filter-style" v-model="styleFilter">
            <option value="">All styles</option>
            <option v-for="st in styleOptions" :key="st.id" :value="st.id">{{ st.name }}</option>
          </select>
        </div>
        <div v-if="brewers.length > 1" class="field">
          <label for="filter-brewer">Brewer</label>
          <select id="filter-brewer" v-model="brewerFilter">
            <option value="">All brewers</option>
            <option v-for="b in brewers" :key="b.id" :value="b.id">{{ b.name }}{{ b.archivedAt ? ' (archived)' : '' }}</option>
          </select>
        </div>
        <div v-if="recipes.length > 1" class="field">
          <label for="filter-recipe">Recipe</label>
          <select id="filter-recipe" v-model="recipeFilter">
            <option value="">All recipes</option>
            <option v-for="r in recipes" :key="r.id" :value="r.id">{{ r.name }}{{ r.archivedAt ? ' (archived)' : '' }}</option>
          </select>
        </div>
        <div v-if="beans.length > 1" class="field">
          <label for="filter-bean">Bean</label>
          <select id="filter-bean" v-model="beanFilter">
            <option value="">All beans</option>
            <option v-for="b in beans" :key="b.id" :value="b.id">{{ beanLabel(b) }}</option>
          </select>
        </div>
        <div class="field">
          <label for="filter-range">Period</label>
          <select id="filter-range" v-model="rangeFilter">
            <option v-for="(label, key) in RANGES" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <template v-if="filters.range === 'custom'">
          <div class="field">
            <label for="filter-from">From</label>
            <input id="filter-from" v-model="fromFilter" type="date" />
          </div>
          <div class="field">
            <label for="filter-to">To</label>
            <input id="filter-to" v-model="toFilter" type="date" />
          </div>
        </template>
        <div class="field">
          <label for="filter-status">Status</label>
          <select id="filter-status" v-model="statusFilter">
            <option value="">Any</option>
            <option v-for="(label, key) in STATUSES" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <button v-if="filtered" class="btn-link clear" type="button" @click="clearFilters">Clear filters</button>
      </div>
    </FilterBar>

    <p v-if="loading" class="muted" aria-live="polite">Loading brews…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="logs.length === 0" class="card empty">
      <p>{{ filtered ? 'No brews match these filters.' : filters.mine ? 'No brews of yours yet.' : 'No brews logged yet.' }}</p>
      <button v-if="filtered" class="btn-link" type="button" @click="clearFilters">Clear filters</button>
      <button v-if="filters.mine" class="btn-link" type="button" @click="mineFilter = false">Show everyone's</button>
    </div>

    <template v-else>
      <p class="muted count">{{ total }} brew{{ total === 1 ? '' : 's' }}</p>
      <ListDataBar list="brew_logs" noun="brews" :selection="selection" :visible-ids="logs.map((l) => l.id)" @imported="load(true)" />
      <ul class="list">
        <li v-for="log in logs" :key="log.id" class="item">
          <component
            :is="selection.selecting ? 'button' : RouterLink"
            class="card entry"
            :class="{ repeatable: workspaces.canEdit && !selection.selecting, picked: selection.has(log.id) }"
            v-bind="cardProps(log.id)"
          >
            <div class="head">
              <span class="when"><span v-if="selection.selecting" class="tick" aria-hidden="true">{{ selection.has(log.id) ? '☑' : '☐' }}</span>{{ formatWhen(log.timestamp) }}</span>
              <span v-if="log.steeping" class="badge steeping">Steeping</span>
              <span v-else class="right">
                <span v-if="stock(log)" class="badge stock" :class="{ finished: stock(log)!.finished }">{{ stock(log)!.text }}</span>
                <span v-if="aiBadge(log)" class="badge ai" :class="aiBadge(log)!.kind" :title="aiBadge(log)!.title">{{ aiBadge(log)!.label }}</span>
                <RatingStars :rating="log.rating ?? log.drinkRating" />
              </span>
            </div>
            <strong>{{ log.bean.roasterName }} {{ log.bean.beanName }}{{ batchSuffix(log.bean) }}</strong>
            <span v-if="log.drink || log.recipe" class="muted">{{ [log.drink?.name, log.servingSize !== null && log.servingUnit ? formatSize({ size: log.servingSize, unit: log.servingUnit }) : null, log.recipe?.name].filter(Boolean).join(' · ') }}</span>
            <span class="facts">
              <span>{{ formatDoseLine(log.actualDoseGrams, log.actualWaterGrams, log.actualYieldGrams, log.actualIceGrams) }}</span>
              <span v-if="log.actualYieldGrams !== null && log.actualWaterGrams !== null">→ {{ formatGrams(log.actualYieldGrams) }} g yield</span>
              <span v-if="log.tdsPercent !== null">{{ log.tdsPercent }}% TDS</span>
              <span>{{ formatTime(log.actualTimeSec) }}</span>
              <span v-if="log.actualTempC !== null">{{ formatTemp(log.actualTempC, temperatureUnit) }}</span>
              <span v-if="log.actualGrindSetting !== null || log.grinder">{{ [log.actualGrindSetting !== null ? formatGrind(log.actualGrindSetting) : null, log.grindRpm !== null ? `${log.grindRpm} RPM` : null, log.grinder?.name].filter(Boolean).join(' · ') }}</span>
            </span>
            <span v-if="log.tastingNotes || log.drinkTastingNotes" class="notes">{{ log.tastingNotes ?? log.drinkTastingNotes }}</span>
          </component>
          <!-- Beside the card link, not inside it: links can't nest. -->
          <RouterLink v-if="workspaces.canEdit && !selection.selecting" class="btn-link small brew-again" :to="{ name: 'brew', query: { repeat: log.id } }">Brew again</RouterLink>
        </li>
      </ul>
      <button v-if="logs.length < total" class="btn btn-secondary" type="button" :disabled="loadingMore" @click="load(false)">
        {{ loadingMore ? 'Loading…' : `Load more (${total - logs.length} left)` }}
      </button>
    </template>
  </main>
</template>

<style scoped>
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
  align-self: flex-start;
}
.mine,
.clear {
  min-height: var(--tap);
}
.clear {
  justify-self: start;
}
.badge.steeping {
  font-size: 0.8rem;
  padding: 1px var(--space-2);
  border-radius: 999px;
  border: 1px solid var(--brand);
  color: var(--brand);
}
.badge.stock {
  font-size: 0.8rem;
  padding: 1px var(--space-2);
  border-radius: 999px;
  border: 1px solid var(--brand);
  color: var(--brand);
}
.badge.stock.finished {
  border-color: var(--border);
  color: var(--text-muted);
}
.right {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.badge.ai {
  padding: 1px var(--space-2);
  font-weight: 500;
}
.badge.ai.none {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--text-muted);
}
.badge.ai.due {
  border: 1px solid var(--brand);
}
.count {
  margin: 0;
  font-size: 0.9rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.item {
  position: relative;
}
.entry.repeatable {
  padding-bottom: calc(var(--space-3) + 1.75rem);
}
.brew-again {
  position: absolute;
  right: var(--space-4);
  bottom: var(--space-2);
}
.entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  color: var(--text);
  text-decoration: none;
}
.entry:hover,
.entry.picked {
  border-color: var(--brand);
}
/* A card in select mode is a button. */
button.entry {
  width: 100%;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.when {
  font-size: 0.85rem;
  color: var(--text-muted);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 0.95rem;
}
.notes {
  font-size: 0.9rem;
  color: var(--text-muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>

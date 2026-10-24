<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { beansApi } from '../api/beans';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { Bean, BrewLog } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ExportBar from '../components/ExportBar.vue';
import RatingStars from '../components/RatingStars.vue';
import { useSelection } from '../composables/useSelection';
import { batchSuffix, beanLabel } from '../lib/beans';
import { analysisStatus, formatClock } from '../lib/analysisStatus';
import { formatDoseLine, formatGrams, formatGrind, formatTime, formatWhen } from '../lib/format';
import { formatSize } from '../lib/servings';
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
const { temperatureUnit } = usePreferences();
const route = useRoute();
const router = useRouter();

const beans = ref<Bean[]>([]);
const logs = ref<BrewLog[]>([]);
const total = ref(0);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');

// The bean filter lives in the URL (?bean=), so Back and reloads keep it.
const beanFilter = computed({
  get: () => (typeof route.query.bean === 'string' ? route.query.bean : ''),
  set: (id: string) => void router.replace({ query: id ? { bean: id } : {} }),
});

async function load(reset: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  if (reset) loading.value = true;
  else loadingMore.value = true;
  error.value = '';
  try {
    const page = await brewLogsApi.list(ws, {
      beanId: beanFilter.value || undefined,
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
  if (ws) beansApi.list(ws).then((r) => (beans.value = r.beans)).catch(() => undefined);
  await load(true);
});
watch(beanFilter, () => load(true));
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

    <div v-if="beans.length > 1" class="field">
      <label for="filter">Bean</label>
      <select id="filter" v-model="beanFilter">
        <option value="">All beans</option>
        <option v-for="b in beans" :key="b.id" :value="b.id">{{ beanLabel(b) }}</option>
      </select>
    </div>

    <p v-if="loading" class="muted" aria-live="polite">Loading brews…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="logs.length === 0" class="card empty">
      <p>{{ beanFilter ? 'No brews with this bean yet.' : 'No brews logged yet.' }}</p>
    </div>

    <template v-else>
      <p class="muted count">{{ total }} brew{{ total === 1 ? '' : 's' }}</p>
      <ExportBar list="brew_logs" noun="brews" csv="brew_logs" :selection="selection" :visible-ids="logs.map((l) => l.id)" />
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
                <span v-if="aiBadge(log)" class="badge ai" :class="aiBadge(log)!.kind" :title="aiBadge(log)!.title">{{ aiBadge(log)!.label }}</span>
                <RatingStars :rating="log.rating ?? log.drinkRating" />
              </span>
            </div>
            <strong>{{ log.bean.roasterName }} {{ log.bean.beanName }}{{ batchSuffix(log.bean) }}</strong>
            <span v-if="log.drink || log.recipe" class="muted">{{ [log.drink?.name, log.servingSize !== null && log.servingUnit ? formatSize({ size: log.servingSize, unit: log.servingUnit }) : null, log.recipe?.name].filter(Boolean).join(' · ') }}</span>
            <span class="facts">
              <span>{{ formatDoseLine(log.actualDoseGrams, log.actualWaterGrams, log.actualYieldGrams) }}</span>
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
.badge.steeping {
  font-size: 0.8rem;
  padding: 1px var(--space-2);
  border-radius: 999px;
  border: 1px solid var(--brand);
  color: var(--brand);
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

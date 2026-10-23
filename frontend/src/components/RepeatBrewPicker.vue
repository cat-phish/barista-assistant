<script setup lang="ts">
// Brew setup's "Pick a brew…": earlier brews, newest first, briefer than the
// journal, to fill setup from (lib/repeatBrew.ts). A native <dialog> like
// ConfirmDialog: Escape or ✕ closes it. Loads 30 at a time; filter by bean.
import { ref, watch } from 'vue';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { Bean, BrewLog } from '../api/types';
import { beanLabel } from '../lib/beans';
import { formatDoseLine, formatGrind } from '../lib/format';
import { repeatLabel } from '../lib/repeatBrew';
import { useWorkspaceStore } from '../stores/workspace';
import RatingStars from './RatingStars.vue';

const props = defineProps<{ open: boolean; beans: Bean[] }>();
const emit = defineEmits<{ close: []; pick: [log: BrewLog] }>();
const workspaces = useWorkspaceStore();
const dialog = ref<HTMLDialogElement | null>(null);

const PAGE = 30;
const logs = ref<BrewLog[]>([]);
const total = ref(0);
const beanFilter = ref('');
const loading = ref(false);
const error = ref('');

async function load(fresh: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await brewLogsApi.list(ws, { beanId: beanFilter.value || undefined, limit: PAGE, offset: fresh ? 0 : logs.value.length });
    logs.value = fresh ? res.brewLogs : [...logs.value, ...res.brewLogs];
    total.value = res.total;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open && !dialog.value?.open) {
      dialog.value?.showModal();
      void load(true);
    }
    if (!open && dialog.value?.open) dialog.value.close();
  },
  { flush: 'post' },
);
watch(beanFilter, () => void load(true));
</script>

<template>
  <dialog ref="dialog" class="picker" aria-labelledby="repeat-picker-title" @cancel.prevent="emit('close')">
    <div class="head">
      <h2 id="repeat-picker-title">Repeat a brew</h2>
      <button class="btn-link close" type="button" aria-label="Close" @click="emit('close')">✕</button>
    </div>
    <div class="field">
      <label for="repeat-bean">Bean</label>
      <select id="repeat-bean" v-model="beanFilter">
        <option value="">All beans</option>
        <option v-for="b in beans" :key="b.id" :value="b.id">{{ beanLabel(b) }}</option>
      </select>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="!loading && logs.length === 0" class="muted">No brews {{ beanFilter ? 'of this bean ' : '' }}yet.</p>
    <ul class="rows">
      <li v-for="l in logs" :key="l.id">
        <button class="row" type="button" @click="emit('pick', l)">
          <span class="top">
            <strong>{{ repeatLabel(l).made }}</strong>
            <span class="muted small">{{ repeatLabel(l).when }}</span>
          </span>
          <span class="muted small">{{ l.bean.roasterName }} {{ repeatLabel(l).bean }}<template v-if="l.recipe"> · {{ l.recipe.name }}</template></span>
          <span class="facts small">
            <span>{{ formatDoseLine(l.actualDoseGrams, l.actualWaterGrams, l.actualYieldGrams) }}</span>
            <span v-if="l.actualGrindSetting !== null">grind {{ formatGrind(l.actualGrindSetting) }}</span>
            <RatingStars :rating="l.rating ?? l.drinkRating" />
          </span>
        </button>
      </li>
    </ul>
    <button v-if="logs.length < total" class="btn btn-secondary" type="button" :disabled="loading" @click="load(false)">
      {{ loading ? 'Loading…' : `Load more (${total - logs.length} left)` }}
    </button>
    <p v-else-if="loading" class="muted" aria-live="polite">Loading…</p>
  </dialog>
</template>

<style scoped>
.picker {
  width: min(520px, calc(100vw - 2 * var(--space-3)));
  max-height: min(80vh, 720px);
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: var(--text);
}
.picker[open] {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.picker::backdrop {
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
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
}
.row {
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  border-color: var(--brand);
}
.top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
}
</style>

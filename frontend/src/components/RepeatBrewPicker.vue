<script setup lang="ts">
// Brew setup's "Pick a brew…": earlier brews, newest first, briefer than the
// journal, to fill setup from (lib/repeatBrew.ts). A native <dialog> like
// ConfirmDialog: Escape or ✕ closes it. Loads 30 at a time. Only your own
// brews, always (no Only mine checkbox: someone else's brew is never one to
// repeat). Bean, recipe and brewer filters fold into one line (FilterBar) so
// the list keeps the room on a phone.
import { computed, ref, watch } from 'vue';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { Bean, Brewer, BrewLog, Recipe } from '../api/types';
import { beanLabel } from '../lib/beans';
import { useWorkspaceStore } from '../stores/workspace';
import BrewLogRow from './BrewLogRow.vue';
import FilterBar from './FilterBar.vue';

const props = defineProps<{ open: boolean; beans: Bean[]; recipes: Recipe[]; brewers: Brewer[] }>();
const emit = defineEmits<{ close: []; pick: [log: BrewLog] }>();
const workspaces = useWorkspaceStore();
const dialog = ref<HTMLDialogElement | null>(null);

const PAGE = 30;
const logs = ref<BrewLog[]>([]);
const total = ref(0);
const beanFilter = ref('');
const recipeFilter = ref('');
const brewerFilter = ref('');
const filtered = computed(() => !!(beanFilter.value || recipeFilter.value || brewerFilter.value));

// Archived ones last, as in the chat's attach picker.
const activeFirst = <T extends { archivedAt: string | null }>(list: T[], name: (x: T) => string): T[] =>
  [...list].sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || name(a).localeCompare(name(b)));
const beanOptions = computed(() => activeFirst(props.beans, beanLabel));
const recipeOptions = computed(() => activeFirst(props.recipes, (r) => r.name));
const brewerOptions = computed(() => activeFirst(props.brewers, (b) => b.name));

const summary = computed(() => {
  const nameIn = <T extends { id: string }>(list: T[], id: string, name: (x: T) => string) => {
    const found = list.find((x) => x.id === id);
    return found ? name(found) : null;
  };
  const parts = [
    beanFilter.value && nameIn(props.beans, beanFilter.value, beanLabel),
    recipeFilter.value && nameIn(props.recipes, recipeFilter.value, (r) => r.name),
    brewerFilter.value && nameIn(props.brewers, brewerFilter.value, (b) => b.name),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No filters';
});
const loading = ref(false);
const error = ref('');

async function load(fresh: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await brewLogsApi.list(ws, {
      beanId: beanFilter.value || undefined,
      recipeId: recipeFilter.value || undefined,
      brewerId: brewerFilter.value || undefined,
      mine: true,
      limit: PAGE, offset: fresh ? 0 : logs.value.length,
    });
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
watch([beanFilter, recipeFilter, brewerFilter], () => void load(true));
</script>

<template>
  <dialog ref="dialog" class="picker" aria-labelledby="repeat-picker-title" @cancel.prevent="emit('close')">
    <div class="head">
      <h2 id="repeat-picker-title">Repeat a brew</h2>
      <button class="btn-link close" type="button" aria-label="Close" @click="emit('close')">✕</button>
    </div>
    <FilterBar :summary="summary" describe="Showing">
      <div class="filters">
        <div class="field">
          <label for="repeat-bean">Bean</label>
          <select id="repeat-bean" v-model="beanFilter">
            <option value="">All beans</option>
            <option v-for="b in beanOptions" :key="b.id" :value="b.id">{{ beanLabel(b) }}</option>
          </select>
        </div>
        <div class="field">
          <label for="repeat-recipe">Recipe</label>
          <select id="repeat-recipe" v-model="recipeFilter">
            <option value="">All recipes</option>
            <option v-for="r in recipeOptions" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>
        <div class="field">
          <label for="repeat-brewer">Brewer</label>
          <select id="repeat-brewer" v-model="brewerFilter">
            <option value="">All brewers</option>
            <option v-for="m in brewerOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
      </div>
    </FilterBar>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="!loading && logs.length === 0" class="muted">{{ filtered ? 'No brews of yours match these filters.' : 'No brews of yours yet.' }}</p>
    <ul class="rows">
      <li v-for="l in logs" :key="l.id">
        <button class="row" type="button" @click="emit('pick', l)">
          <BrewLogRow :log="l" />
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
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-2);
  align-items: end;
}
.filters select {
  width: 100%;
  min-width: 0;
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
  display: block;
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
</style>

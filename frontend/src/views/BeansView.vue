<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { beansApi } from '../api/beans';
import { ApiError, errorMessage } from '../api/client';
import type { Bean } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { formatDay, localDateInput, toDateInput } from '../lib/format';
import { effectiveRoastAge } from '../lib/roastAge';
import { useWorkspaceStore } from '../stores/workspace';
import { ROAST_LEVELS } from '../lib/scale';
import { DETAILED_ROAST_LEVELS, formatPrice, formatPricePerGram, pricePerGram, ROAST_TYPES } from '../lib/beans';

const workspaces = useWorkspaceStore();
const beans = ref<Bean[]>([]);
const loading = ref(true);
const error = ref('');

// Delete flow (docs/api/beans.md §4 frontend requirement): confirm, try the
// plain DELETE, and only if the server reports brew logs, ask again with the count.
const pending = ref<Bean | null>(null);
const brewLogCount = ref<number | null>(null);
const busy = ref(false);
const dialogError = ref('');

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
onMounted(load);

function askDelete(bean: Bean): void {
  pending.value = bean;
  brewLogCount.value = null;
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

function hideInstead(): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = pending.value;
  if (!ws || !bean) return Promise.resolve();
  return run(() => beansApi.update(ws, bean.id, { showOnPublicMenu: false }));
}

function deleteEverything(): Promise<void> {
  const ws = workspaces.current?.id;
  const bean = pending.value;
  if (!ws || !bean) return Promise.resolve();
  return run(() => beansApi.remove(ws, bean.id, true));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function openFreeze(bean: Bean) {
  const last = bean.freezePeriods[bean.freezePeriods.length - 1];
  return last && last.thawedOn === null ? last : null;
}

// "9 days off roast", or while frozen "age paused at 9 days" (docs/api/beans.md §4).
// The roast name when known ("City+"), else the 5-step level.
function roastLabel(bean: Bean): string | null {
  if (bean.detailedRoastLevel) return DETAILED_ROAST_LEVELS[bean.detailedRoastLevel].label;
  return bean.roastLevel ? ROAST_LEVELS[bean.roastLevel].label : null;
}

// "21.50 USD · 0.063 USD/g", or just the price without a bag weight.
function priceLabel(bean: Bean): string | null {
  if (bean.priceAmount === null || bean.priceCurrency === null) return null;
  const perGram = pricePerGram(bean);
  return formatPrice(bean.priceAmount, bean.priceCurrency) + (perGram ? ` · ${formatPricePerGram(perGram)}` : '');
}

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
  const lastThaw = bean.freezePeriods[bean.freezePeriods.length - 1]?.thawedOn ?? '';
  const roast = toDateInput(bean.roastDate);
  return lastThaw > roast ? lastThaw : roast;
});

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
    beans.value = beans.value.map((b) => (b.id === updated.id ? updated : b));
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
  <main class="page">
    <div class="page-header">
      <h1>Beans</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'bean-new' }">Add bean</RouterLink>
    </div>

    <p v-if="loading" class="muted" aria-live="polite">Loading beans…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="beans.length === 0" class="card empty">
      <p>No beans yet.</p>
      <p v-if="workspaces.canEdit">Add the coffee you're brewing to start logging brews.</p>
    </div>

    <ul v-else class="list">
      <li v-for="bean in beans" :key="bean.id" class="card bean">
        <div class="head">
          <div>
            <h2>{{ bean.beanName }}</h2>
            <p class="muted">{{ bean.roasterName }}<template v-if="bean.process"> · {{ bean.process }}</template><template v-if="roastLabel(bean)"> · {{ roastLabel(bean) }} roast</template></p>
          </div>
          <div class="badges">
            <span v-if="openFreeze(bean)" class="badge frozen">Frozen</span>
            <span v-if="bean.decaf" class="badge">Decaf</span>
            <span v-if="bean.roastType" class="badge">{{ ROAST_TYPES[bean.roastType].label }} roast</span>
            <span v-if="bean.blendType === 'blend'" class="badge">Blend</span>
            <span v-if="!bean.showOnPublicMenu" class="badge">Hidden from menu</span>
          </div>
        </div>
        <p class="facts">
          <span>{{ bean.inventoryWeightGrams }} g left</span>
          <span v-if="ageLabel(bean)">{{ ageLabel(bean) }}</span>
          <span v-if="openFreeze(bean)" class="frozen-since">Frozen since {{ formatDay(openFreeze(bean)!.frozenOn) }}</span>
          <span v-if="priceLabel(bean)">{{ priceLabel(bean) }}</span>
          <a v-if="bean.website" :href="bean.website" target="_blank" rel="noopener noreferrer">Website</a>
        </p>
        <p v-if="bean.notes" class="notes muted">{{ bean.notes }}</p>
        <div v-if="workspaces.canEdit" class="actions">
          <button class="btn-link" type="button" @click="askFreeze(bean)">{{ openFreeze(bean) ? 'Thaw' : 'Freeze' }}</button>
          <RouterLink class="btn-link" :to="{ name: 'bean-edit', params: { id: bean.id } }">Edit</RouterLink>
          <button class="btn-link danger" type="button" @click="askDelete(bean)">Delete</button>
        </div>
      </li>
    </ul>
  </main>

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
      Consider hiding it from the menu instead.
    </p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <template v-if="brewLogCount === null">
        <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="hideInstead">Hide from menu instead</button>
        <button class="btn btn-danger" type="button" :disabled="busy" @click="deleteEverything">Delete bean and history</button>
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
        <label for="freeze-date">{{ freezeAction === 'freeze' ? 'Frozen on' : 'Thawed on' }}</label>
        <input id="freeze-date" v-model="freezeDate" type="date" :min="freezeMin || undefined" :max="localDateInput()" required />
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
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.bean {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
h2 {
  font-size: 1.1rem;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
}
.badge.frozen {
  background: var(--frozen-tint);
  color: var(--frozen);
}
.frozen-since {
  color: var(--frozen);
}
p {
  margin: 0;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 0.95rem;
}
.notes {
  font-size: 0.9rem;
  white-space: pre-line;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
</style>

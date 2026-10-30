<script setup lang="ts">
// A roast's page (docs/api/roasts.md §4f): what went in and came out, the
// profile, when it's ready, and the bean it made. Edit and delete for
// owners and baristas; deleting gives the green weight back and keeps the bean.
// Says when its green coffee is running low, and, just after a save, whether
// the rest-done reminder was queued (docs/api/notifications.md §1b).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../api/client';
import { roastsApi } from '../api/roasts';
import type { Roast } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { usePreferences } from '../composables/usePreferences';
import { ROAST_TYPES } from '../lib/beans';
import { formatListDay, formatTime, formatWhen, localDateInput } from '../lib/format';
import { development, formatStock, greenStock, readyOn, roastLevelLabel, roastTempText, weightLoss } from '../lib/roasting';
import { TEMPERATURE_LABELS } from '../lib/units';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id: string }>();
const workspaces = useWorkspaceStore();
const router = useRouter();
const { temperatureUnit } = usePreferences();
const roast = ref<Roast | null>(null);
const loading = ref(true);
const error = ref('');
const today = localDateInput();

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    roast.value = (await roastsApi.get(ws, props.id)).roast;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

const temp = (c: number | null) => (c === null ? null : `${roastTempText(c, temperatureUnit.value)} ${TEMPERATURE_LABELS[temperatureUnit.value]}`);
const dev = computed(() => (roast.value ? development(roast.value.firstCrackSec, roast.value.totalSec) : null));
const ready = computed(() => (roast.value ? readyOn(roast.value) : null));
const greenState = computed(() => (roast.value?.greenCoffee ? greenStock({ ...roast.value.greenCoffee, weightBoughtGrams: null }).state : 'ok'));
// From the form, after a save (history state, so a reload doesn't repeat it).
const savedReminder = typeof history.state?.restReminder === 'string' ? (history.state.restReminder as string) : null;
const shortStock = computed(() => (roast.value && roast.value.greenCoffeeId && roast.value.greenStockTakenGrams < roast.value.greenGrams ? roast.value.greenStockTakenGrams : null));

const confirming = ref(false);
const deleting = ref(false);
const deleteError = ref('');
async function remove(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await roastsApi.remove(ws, props.id);
    await router.push({ name: 'roasts' });
  } catch (err) {
    deleteError.value = errorMessage(err);
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-else-if="roast">
      <div class="page-header">
        <h1>{{ roast.greenCoffee?.name ?? 'Deleted green coffee' }}<template v-if="roast.batchNumber"> · batch {{ roast.batchNumber }}</template></h1>
        <RouterLink v-if="workspaces.canEdit" class="btn btn-secondary" :to="{ name: 'roast-edit', params: { id: roast.id } }">Edit</RouterLink>
      </div>
      <p class="muted">{{ formatWhen(roast.roastedAt) }}<template v-if="roast.machine"> on {{ roast.machine.name }}</template></p>

      <section class="card stack" aria-label="The roast">
        <dl class="facts">
          <div>
            <dt>Green in → roasted out</dt>
            <dd>{{ roast.greenGrams }} g → {{ roast.roastedGrams }} g</dd>
          </div>
          <div>
            <dt>Weight loss</dt>
            <dd>{{ weightLoss(roast.greenGrams, roast.roastedGrams) }}%</dd>
          </div>
          <div v-if="roastLevelLabel(roast)">
            <dt>Roast level</dt>
            <dd>{{ roastLevelLabel(roast) }}</dd>
          </div>
          <div v-if="roast.roastType">
            <dt>Roasted for</dt>
            <dd>{{ ROAST_TYPES[roast.roastType].label }}</dd>
          </div>
          <div v-if="temp(roast.chargeTempC)">
            <dt>Charge</dt>
            <dd>{{ temp(roast.chargeTempC) }}</dd>
          </div>
          <div v-if="temp(roast.dropTempC)">
            <dt>Drop</dt>
            <dd>{{ temp(roast.dropTempC) }}</dd>
          </div>
          <div v-if="roast.firstCrackSec !== null">
            <dt>First crack</dt>
            <dd>{{ formatTime(roast.firstCrackSec) }}</dd>
          </div>
          <div v-if="roast.totalSec !== null">
            <dt>Drop at</dt>
            <dd>{{ formatTime(roast.totalSec) }}</dd>
          </div>
          <div v-if="dev">
            <dt>Development</dt>
            <dd>{{ formatTime(dev.sec) }} ({{ dev.percent }}%)</dd>
          </div>
          <div v-if="ready">
            <dt>Rest</dt>
            <dd>{{ roast.restDays }} {{ roast.restDays === 1 ? 'day' : 'days' }}: {{ ready <= today ? 'ready' : `ready ${formatListDay(ready)}` }}</dd>
          </div>
        </dl>
        <p v-if="ready && ready > today && savedReminder === 'queued'" class="muted small">You'll get a reminder the morning it's ready.</p>
        <p v-else-if="ready && ready > today && savedReminder === 'unavailable'" class="muted small">The ready reminder couldn't be scheduled right now.</p>
        <p v-if="roast.notes" class="notes">{{ roast.notes }}</p>
        <p v-if="shortStock !== null" class="muted small">Took {{ formatStock(shortStock) }} off the green stock: that was all there was.</p>
      </section>

      <div v-if="roast.greenCoffee && greenState !== 'ok'" class="card stock-notice" :class="greenState" role="status">
        <p v-if="greenState === 'out'">{{ roast.greenCoffee.name }} is used up.</p>
        <p v-else>Only {{ formatStock(roast.greenCoffee.weightLeftGrams) }} of {{ roast.greenCoffee.name }} left.</p>
        <RouterLink class="btn-link" :to="{ name: 'green-coffees' }">Green stock</RouterLink>
      </div>

      <section class="card stack" aria-label="Its bean">
        <template v-if="roast.beanId">
          <p>Its coffee is in Beans, ready to brew. Editing this roast keeps the bean in step.</p>
          <RouterLink v-if="workspaces.canEdit" class="btn-link" :to="{ name: 'bean-edit', params: { id: roast.beanId } }">Open the bean</RouterLink>
        </template>
        <p v-else class="muted">Its bean was deleted.</p>
      </section>

      <section v-if="workspaces.canEdit" class="card danger-zone">
        <div>
          <h2>Delete this roast</h2>
          <p class="muted small">Gives its green weight back to the stock. Its bean and brews stay.</p>
        </div>
        <button class="btn btn-danger" type="button" @click="confirming = true">Delete</button>
      </section>
      <ConfirmDialog :open="confirming" title="Delete this roast?" @cancel="confirming = false">
        <p>{{ formatStock(roast.greenStockTakenGrams) }} goes back to {{ roast.greenCoffee?.name ?? 'the green stock' }}. Its bean and brews stay.</p>
        <p v-if="deleteError" class="form-error" role="alert">{{ deleteError }}</p>
        <template #actions>
          <button class="btn btn-danger" type="button" :disabled="deleting" @click="remove">{{ deleting ? 'Deleting…' : 'Delete' }}</button>
          <button class="btn btn-secondary" type="button" :disabled="deleting" @click="confirming = false">Cancel</button>
        </template>
      </ConfirmDialog>
    </template>
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
h2 {
  font-size: 1.05rem;
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.facts dt {
  font-size: 0.85rem;
  color: var(--text-muted);
}
.facts dd {
  margin: 0;
  font-weight: 600;
}
.notes {
  white-space: pre-wrap;
}
.stock-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
  background: var(--warning-tint);
  border-color: var(--warning);
}
.stock-notice.out {
  background: var(--danger-tint);
  border-color: var(--danger);
}
.danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
</style>

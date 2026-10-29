<script setup lang="ts">
// Roast mode → Roast (docs/api/roasts.md §4f): log a roast, or edit one
// (route param). Saving a new roast creates its bean and takes the green
// weight off the stock; editing keeps the bean in step. Times are typed in
// (m:ss from the charge). Optional fields can be hidden (roast.* in
// Settings → Fields).
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../api/client';
import { greenCoffeesApi } from '../api/greenCoffees';
import { roastingMachinesApi } from '../api/roastingMachines';
import { roastsApi } from '../api/roasts';
import type { GreenCoffee, Roast, RoastingMachine, RoastType } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import { usePreferences } from '../composables/usePreferences';
import { DETAILED_ROAST_LEVELS, ROAST_TYPES } from '../lib/beans';
import { formatTime } from '../lib/format';
import { development, formatStock, parseRoastForm, roastForm, toLocalInput, weightLoss } from '../lib/roasting';
import { ROAST_LEVELS } from '../lib/scale';
import { TEMPERATURE_LABELS } from '../lib/units';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const { settings, roastScale, temperatureUnit } = usePreferences();
const { show, reveal } = useFieldVisibility();
const editing = computed(() => props.id !== undefined);

const restFor = (type: RoastType | '') => settings.value.restDays[type || 'omni'];
const form = ref(roastForm(temperatureUnit.value, undefined, { restDays: restFor('') }));
// A roast whose green coffee was deleted can still be edited without one.
const parsed = computed(() =>
  parseRoastForm(form.value, { unit: temperatureUnit.value, scale: roastScale.value, greenOptional: editing.value && !!saved.value && !saved.value.greenCoffeeId }),
);
const errors = computed(() => parsed.value.errors);
const saved = ref<Roast | null>(null);
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');

const greens = ref<GreenCoffee[]>([]);
const machines = ref<RoastingMachine[]>([]);
// Active ones, plus the one this roast already uses.
const greenChoices = computed(() => greens.value.filter((g) => !g.archivedAt || g.id === saved.value?.greenCoffeeId));
const machineChoices = computed(() => machines.value.filter((m) => !m.archivedAt || m.id === saved.value?.machineId));
const green = computed(() => greens.value.find((g) => g.id === form.value.greenCoffeeId) ?? null);
const machine = computed(() => machines.value.find((m) => m.id === form.value.machineId) ?? null);

// The rest days follow the roast type until they're typed over.
const restTouched = ref(false);
watch(
  () => form.value.roastType,
  (type) => {
    if (!restTouched.value) form.value.restDays = String(restFor(type));
  },
);

const greenGrams = computed(() => (/^\d+$/.test(form.value.green.trim()) ? Number(form.value.green) : null));
const roastedGrams = computed(() => (/^\d+$/.test(form.value.roasted.trim()) ? Number(form.value.roasted) : null));
const loss = computed(() => (greenGrams.value && roastedGrams.value && roastedGrams.value < greenGrams.value ? weightLoss(greenGrams.value, roastedGrams.value) : null));
const dev = computed(() => {
  const v = parsed.value.values;
  return v ? development(v.firstCrackSec, v.totalSec) : null;
});
// What it takes off the stock: what's left now, plus what this roast already took from it.
const stockNote = computed(() => {
  const g = green.value;
  const wanted = greenGrams.value;
  if (!g || !wanted) return null;
  const left = g.weightLeftGrams + (saved.value?.greenCoffeeId === g.id ? saved.value.greenStockTakenGrams : 0);
  if (left <= 0) return { warn: true, text: 'None of it is in stock, so the stock stays at 0.' };
  if (wanted > left) return { warn: true, text: `Only ${formatStock(left)} is in stock: that's what it takes.` };
  return { warn: false, text: `${formatStock(left - wanted)} left after this roast.` };
});
const overCapacity = computed(() => (machine.value?.capacityGrams && greenGrams.value ? greenGrams.value > machine.value.capacityGrams : false));

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [g, m, r] = await Promise.all([greenCoffeesApi.list(ws), roastingMachinesApi.list(ws), props.id ? roastsApi.get(ws, props.id) : null]);
    greens.value = g.greenCoffees;
    machines.value = m.machines;
    if (r) {
      saved.value = r.roast;
      form.value = roastForm(temperatureUnit.value, r.roast);
      restTouched.value = true;
      reveal({
        'roast.machine': r.roast.machineId,
        'roast.batchNumber': r.roast.batchNumber,
        'roast.roastType': r.roast.roastType,
        'roast.roastLevel': r.roast.roastLevel,
        'roast.temps': r.roast.chargeTempC ?? r.roast.dropTempC,
        'roast.times': r.roast.firstCrackSec ?? r.roast.totalSec,
        'roast.notes': r.roast.notes,
      });
    } else {
      // Start on the last roast's machine, when there's one.
      const last = (await roastsApi.list(ws)).roasts[0];
      if (last?.machineId && m.machines.some((x) => x.id === last.machineId && !x.archivedAt)) form.value.machineId = last.machineId;
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

const maxRoastedAt = toLocalInput(new Date());

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const values = parsed.value.values;
  if (!ws || !values) return;
  saving.value = true;
  error.value = '';
  try {
    const { greenCoffeeId, ...rest } = values;
    const { roast } = props.id ? await roastsApi.update(ws, props.id, greenCoffeeId ? values : rest) : await roastsApi.create(ws, values);
    await router.push({ name: 'roast', params: { id: roast.id } });
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
      <h1>{{ editing ? 'Edit roast' : 'Log a roast' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="!editing && greens.filter((g) => !g.archivedAt).length === 0" class="card empty">
      Add the green coffee you roast first.
      <RouterLink class="btn btn-primary" :to="{ name: 'green-coffee-new' }">Add green coffee</RouterLink>
    </p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="roast-green">Green coffee<span class="req" aria-hidden="true">*</span></label>
          <select id="roast-green" v-model="form.greenCoffeeId" aria-required="true" :aria-invalid="submitted && !!errors.greenCoffeeId">
            <option value="" :disabled="!(editing && saved && !saved.greenCoffeeId)">Choose…</option>
            <option v-for="g in greenChoices" :key="g.id" :value="g.id">{{ g.name }} ({{ formatStock(g.weightLeftGrams) }} left)</option>
          </select>
          <span v-if="submitted && errors.greenCoffeeId" class="field-error">{{ errors.greenCoffeeId }}</span>
          <span v-if="editing && saved && !saved.greenCoffeeId" class="muted small">Its green coffee was deleted. Choose one to link it again, or leave it.</span>
        </div>
        <div class="form-row">
          <div v-if="show('roast.machine')" class="field">
            <label for="roast-machine">Roaster</label>
            <select id="roast-machine" v-model="form.machineId">
              <option value="">None</option>
              <option v-for="m in machineChoices" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>
          <div class="field">
            <label for="roast-at">Roasted<span class="req" aria-hidden="true">*</span></label>
            <input id="roast-at" v-model="form.roastedAt" type="datetime-local" :max="maxRoastedAt" aria-required="true" :aria-invalid="submitted && !!errors.roastedAt" />
            <span v-if="submitted && errors.roastedAt" class="field-error">{{ errors.roastedAt }}</span>
          </div>
        </div>
        <div v-if="show('roast.batchNumber')" class="field short">
          <label for="roast-batch">Batch no.</label>
          <input id="roast-batch" v-model="form.batchNumber" maxlength="50" :placeholder="editing ? '' : 'Next batch'" />
        </div>
      </section>

      <section class="card stack" aria-labelledby="roast-weights">
        <h2 id="roast-weights">Weights</h2>
        <div class="form-row">
          <div class="field">
            <label for="roast-in">Green in (g)<span class="req" aria-hidden="true">*</span></label>
            <input id="roast-in" v-model="form.green" inputmode="numeric" aria-required="true" placeholder="e.g. 120" :aria-invalid="submitted && !!errors.green" />
            <span v-if="submitted && errors.green" class="field-error">{{ errors.green }}</span>
          </div>
          <div class="field">
            <label for="roast-out">Roasted out (g)<span class="req" aria-hidden="true">*</span></label>
            <input id="roast-out" v-model="form.roasted" inputmode="numeric" aria-required="true" placeholder="e.g. 102" :aria-invalid="submitted && !!errors.roasted" />
            <span v-if="submitted && errors.roasted" class="field-error">{{ errors.roasted }}</span>
          </div>
        </div>
        <p v-if="loss !== null" class="muted small" aria-live="polite">Weight loss: {{ loss }}%</p>
        <p v-if="stockNote" class="small" :class="stockNote.warn ? 'warn' : 'muted'" aria-live="polite">{{ stockNote.text }}</p>
        <p v-if="overCapacity" class="small warn">More than {{ machine?.name }}'s largest batch ({{ formatStock(machine?.capacityGrams ?? 0) }}).</p>
      </section>

      <section v-if="show('roast.temps') || show('roast.times')" class="card stack" aria-labelledby="roast-profile">
        <h2 id="roast-profile">Temperatures and times</h2>
        <div v-if="show('roast.temps')" class="form-row">
          <div class="field">
            <label for="roast-charge">Charge ({{ TEMPERATURE_LABELS[temperatureUnit] }})</label>
            <input id="roast-charge" v-model="form.chargeTemp" inputmode="decimal" :aria-invalid="submitted && !!errors.chargeTemp" />
            <span v-if="submitted && errors.chargeTemp" class="field-error">{{ errors.chargeTemp }}</span>
          </div>
          <div class="field">
            <label for="roast-drop">Drop ({{ TEMPERATURE_LABELS[temperatureUnit] }})</label>
            <input id="roast-drop" v-model="form.dropTemp" inputmode="decimal" :aria-invalid="submitted && !!errors.dropTemp" />
            <span v-if="submitted && errors.dropTemp" class="field-error">{{ errors.dropTemp }}</span>
          </div>
        </div>
        <template v-if="show('roast.times')">
          <div class="form-row">
            <div class="field">
              <label for="roast-crack">First crack (m:ss)</label>
              <input id="roast-crack" v-model="form.firstCrack" inputmode="numeric" placeholder="e.g. 7:30" :aria-invalid="submitted && !!errors.firstCrack" />
              <span v-if="submitted && errors.firstCrack" class="field-error">{{ errors.firstCrack }}</span>
            </div>
            <div class="field">
              <label for="roast-total">Drop at (m:ss)</label>
              <input id="roast-total" v-model="form.total" inputmode="numeric" placeholder="e.g. 9:20" :aria-invalid="submitted && !!errors.total" />
              <span v-if="submitted && errors.total" class="field-error">{{ errors.total }}</span>
            </div>
          </div>
          <p class="muted small" aria-live="polite">
            <template v-if="dev">Development: {{ formatTime(dev.sec) }} ({{ dev.percent }}% of the roast)</template>
            <template v-else>From the charge. Both give the development time.</template>
          </p>
        </template>
      </section>

      <section v-if="show('roast.roastType') || show('roast.roastLevel') || show('roast.restDays')" class="card stack" aria-labelledby="roast-result">
        <h2 id="roast-result">The roast</h2>
        <div class="form-row">
          <div v-if="show('roast.roastType')" class="field">
            <label for="roast-type">Roasted for</label>
            <select id="roast-type" v-model="form.roastType">
              <option value="">Not set</option>
              <option v-for="(t, key) in ROAST_TYPES" :key="key" :value="key">{{ t.label }}</option>
            </select>
          </div>
          <template v-if="show('roast.roastLevel')">
            <div v-if="roastScale === 'levels'" class="field">
              <label for="roast-level">Roast level</label>
              <select id="roast-level" v-model="form.level">
                <option value="">Not sure</option>
                <option v-for="(r, key) in ROAST_LEVELS" :key="key" :value="key">{{ r.label }}</option>
              </select>
            </div>
            <div v-else class="field">
              <label for="roast-detailed">Roast level</label>
              <select id="roast-detailed" v-model="form.detailed">
                <option value="">Not sure</option>
                <option v-for="(d, key) in DETAILED_ROAST_LEVELS" :key="key" :value="key">{{ d.label }}</option>
              </select>
            </div>
          </template>
        </div>
        <div v-if="show('roast.restDays')" class="field short">
          <label for="roast-rest">Rest (days)</label>
          <input id="roast-rest" v-model="form.restDays" inputmode="numeric" aria-describedby="roast-rest-hint" :aria-invalid="submitted && !!errors.restDays" @input="restTouched = true" />
          <span id="roast-rest-hint" class="muted small">Before it's ready to brew. Defaults per roast type are in Settings → Defaults.</span>
          <span v-if="submitted && errors.restDays" class="field-error">{{ errors.restDays }}</span>
        </div>
      </section>

      <section v-if="show('roast.notes')" class="card stack">
        <div class="field">
          <label for="roast-notes">Notes</label>
          <textarea id="roast-notes" v-model="form.notes" rows="3" maxlength="2000" placeholder="e.g. Turned the fan up at yellowing." />
        </div>
      </section>

      <p v-if="!editing" class="muted small">Saving adds the roasted coffee to Beans as {{ settings.homeRoasterName }} · {{ green?.name ?? 'the green coffee' }}, ready to brew.</p>
      <p v-else-if="saved?.beanId" class="muted small">Its bean is updated to match.</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !parsed.values" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink v-if="editing && props.id" class="btn btn-secondary" :to="{ name: 'roast', params: { id: props.id } }">Cancel</RouterLink>
        <RouterLink v-else class="btn btn-secondary" :to="{ name: 'roasts' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save roast' }}</button>
      </div>
    </form>
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
.short {
  max-width: 14rem;
}
.warn {
  color: var(--warning);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

<script setup lang="ts">
// Green coffee editor (docs/api/green-coffees.md §4e): add one, or edit one
// (route param). Only the name is required; the origin fields are a bean's,
// so a roast can copy them onto the bean it makes. Optional fields can be
// hidden under Settings → Fields (green.*).
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { beanProcessesApi } from '../api/beanProcesses';
import { ApiError, errorMessage } from '../api/client';
import { greenCoffeesApi } from '../api/greenCoffees';
import type { BeanProcess, CoffeeSpecies, GreenCoffee } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import DeleteSection from '../components/DeleteSection.vue';
import NameInput from '../components/NameInput.vue';
import NamesInput from '../components/NamesInput.vue';
import { useFieldVisibility } from '../composables/useFieldVisibility';
import { usePreferences } from '../composables/usePreferences';
import { COFFEE_SPECIES, lastCurrency, rememberCurrency } from '../lib/beans';
import { localDateInput } from '../lib/format';
import { distinctNames } from '../lib/nameSuggest';
import { areaForCountry, COUNTRY_AREAS, ORIGIN_AREAS } from '../lib/origins';
import { greenForm, greenPrice, parseGreenForm } from '../lib/roasting';
import { ALTITUDE_LABELS } from '../lib/units';
import { COMMON_VARIETIES } from '../lib/varieties';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const workspaces = useWorkspaceStore();
const router = useRouter();
const { altitudeUnit } = usePreferences();
const { show, reveal } = useFieldVisibility();
const editing = computed(() => props.id !== undefined);
// As saved, for the Delete section (editing only).
const saved = ref<{ name: string; archived: boolean } | null>(null);
const deleteUsage = () => greenCoffeesApi.usage(workspaces.current?.id ?? '', props.id ?? '');
const deleteIt = () => greenCoffeesApi.remove(workspaces.current?.id ?? '', props.id ?? '');

const form = ref(greenForm(altitudeUnit.value, undefined, lastCurrency()));
const parsed = computed(() => parseGreenForm(form.value, altitudeUnit.value));
const errors = computed(() => parsed.value.errors);
const loading = ref(true);
const saving = ref(false);
const submitted = ref(false);
const error = ref('');
const today = localDateInput();

const processes = ref<BeanProcess[]>([]);
const processChoices = computed(() => processes.value.filter((p) => !p.hidden || p.id === form.value.processId));
// The workspace's other green coffees: the names the producer and supplier suggest.
const others = ref<GreenCoffee[]>([]);
const producerNames = computed(() => distinctNames(others.value.map((g) => g.producer)));
const supplierNames = computed(() => distinctNames(others.value.map((g) => g.supplier)));
const varietyNames = computed(() => distinctNames([...others.value.flatMap((g) => g.varieties ?? []), ...COMMON_VARIETIES]));
const countries = Object.keys(COUNTRY_AREAS);
const SPECIES_KEYS = Object.keys(COFFEE_SPECIES) as CoffeeSpecies[];
function toggleSpecies(s: CoffeeSpecies): void {
  const on = form.value.species;
  form.value.species = on.includes(s) ? on.filter((x) => x !== s) : SPECIES_KEYS.filter((x) => x === s || on.includes(x));
}
// A known country fills in its growing area, unless one is already chosen.
watch(
  () => form.value.country,
  (c) => {
    const area = areaForCountry(c);
    if (area && !form.value.originArea) form.value.originArea = area;
  },
);
const priceLine = computed(() => {
  const v = parsed.value.values;
  return v && v.weightBoughtGrams ? greenPrice(v) : null;
});

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [list, procs] = await Promise.all([greenCoffeesApi.list(ws), beanProcessesApi.list(ws)]);
    processes.value = procs.processes;
    others.value = list.greenCoffees.filter((g) => g.id !== props.id);
    if (editing.value) {
      const green = list.greenCoffees.find((g) => g.id === props.id);
      if (!green) {
        error.value = 'This green coffee no longer exists.';
        return;
      }
      saved.value = { name: green.name, archived: !!green.archivedAt };
      form.value = greenForm(altitudeUnit.value, green);
      reveal({
        'green.process': green.processId,
        'green.origin': green.originArea ?? green.country,
        'green.region': green.region,
        'green.producer': green.producer,
        'green.altitude': green.altitudeMasl,
        'green.varieties': green.varieties,
        'green.species': green.species,
        'green.supplier': green.supplier,
        'green.lot': green.lot,
        'green.price': green.priceAmount,
        'green.lowStock': green.lowStockGrams,
        'green.purchaseDate': green.purchaseDate,
        'green.notes': green.notes,
      });
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  const values = parsed.value.values;
  if (!ws || !values) return;
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await greenCoffeesApi.update(ws, props.id, values);
    else await greenCoffeesApi.create(ws, values);
    if (values.priceCurrency) rememberCurrency(values.priceCurrency);
    await router.push({ name: 'green-coffees' });
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? 'A green coffee with that name already exists.' : errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>{{ editing ? 'Edit green coffee' : 'Add green coffee' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <h2>The coffee</h2>
        <div class="field">
          <label for="green-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="green-name" v-model="form.name" maxlength="255" aria-required="true" placeholder="e.g. Ethiopia Guji Hambela" :aria-invalid="submitted && !!errors.name" />
          <span v-if="submitted && errors.name" class="field-error">{{ errors.name }}</span>
        </div>
        <div v-if="show('green.process')" class="field">
          <label for="green-process">Process</label>
          <select id="green-process" v-model="form.processId">
            <option value="">Not sure</option>
            <option v-for="p in processChoices" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div v-if="show('green.origin')" class="form-row">
          <div class="field">
            <label for="green-area">Growing area</label>
            <select id="green-area" v-model="form.originArea">
              <option value="">Not sure</option>
              <option v-for="(a, key) in ORIGIN_AREAS" :key="key" :value="key">{{ a.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="green-country">Country</label>
            <input id="green-country" v-model="form.country" maxlength="100" list="green-country-suggestions" placeholder="e.g. Ethiopia" />
            <datalist id="green-country-suggestions">
              <option v-for="c in countries" :key="c" :value="c" />
            </datalist>
          </div>
        </div>
        <div v-if="show('green.region') || show('green.producer')" class="form-row">
          <div v-if="show('green.region')" class="field">
            <label for="green-region">Region</label>
            <input id="green-region" v-model="form.region" maxlength="255" placeholder="e.g. Guji" />
          </div>
          <div v-if="show('green.producer')" class="field">
            <label for="green-producer">Producer</label>
            <NameInput id="green-producer" v-model="form.producer" :names="producerNames" maxlength="255" placeholder="e.g. a farm, co-op or washing station" />
          </div>
        </div>
        <div v-if="show('green.altitude')" class="field short">
          <label for="green-altitude">Altitude ({{ ALTITUDE_LABELS[altitudeUnit] }})</label>
          <input id="green-altitude" v-model="form.altitude" inputmode="numeric" :placeholder="altitudeUnit === 'ft' ? 'e.g. 6400' : 'e.g. 1950'" :aria-invalid="submitted && !!errors.altitude" />
          <span v-if="submitted && errors.altitude" class="field-error">{{ errors.altitude }}</span>
        </div>
        <div v-if="show('green.varieties')" class="field">
          <label for="green-varieties">Variety</label>
          <NamesInput id="green-varieties" v-model="form.varieties" :names="varietyNames" placeholder="e.g. 74110, Heirloom" />
        </div>
        <fieldset v-if="show('green.species')" class="field species">
          <legend>Species</legend>
          <div class="species-choices">
            <button v-for="s in SPECIES_KEYS" :key="s" type="button" class="species-choice" :aria-pressed="form.species.includes(s)" @click="toggleSpecies(s)">
              {{ COFFEE_SPECIES[s].label }}
            </button>
          </div>
        </fieldset>
      </section>

      <section class="card stack">
        <h2>Stock</h2>
        <div class="form-row">
          <div class="field">
            <label for="green-bought">Bought (g)</label>
            <input id="green-bought" v-model="form.bought" inputmode="numeric" placeholder="e.g. 2270" :aria-invalid="submitted && !!errors.bought" />
            <span v-if="submitted && errors.bought" class="field-error">{{ errors.bought }}</span>
          </div>
          <div class="field">
            <label for="green-left">Left (g)</label>
            <input id="green-left" v-model="form.left" inputmode="numeric" :placeholder="editing ? '' : form.bought.trim() ? `${form.bought.trim()} (all of it)` : ''" :aria-invalid="submitted && !!errors.left" />
            <span v-if="submitted && errors.left" class="field-error">{{ errors.left }}</span>
          </div>
        </div>
        <div v-if="show('green.lowStock')" class="field short">
          <label for="green-low">Low stock at (g)</label>
          <input id="green-low" v-model="form.lowStock" inputmode="numeric" placeholder="e.g. 500" aria-describedby="green-low-hint" :aria-invalid="submitted && !!errors.lowStock" />
          <span id="green-low-hint" class="muted small">Below it, the coffee shows as low.</span>
          <span v-if="submitted && errors.lowStock" class="field-error">{{ errors.lowStock }}</span>
        </div>
        <div v-if="show('green.price')" class="price-row">
          <div class="field">
            <label for="green-price">Price paid</label>
            <input id="green-price" v-model="form.price" inputmode="decimal" placeholder="e.g. 42.50" :aria-invalid="submitted && !!errors.price" />
            <span v-if="submitted && errors.price" class="field-error">{{ errors.price }}</span>
          </div>
          <div class="field">
            <label for="green-currency">Currency<span v-if="form.price.trim()" class="req" aria-hidden="true">*</span></label>
            <input id="green-currency" v-model="form.currency" class="currency" maxlength="3" autocapitalize="characters" placeholder="USD" :aria-required="!!form.price.trim()" :aria-invalid="submitted && !!errors.currency" />
            <span v-if="submitted && errors.currency" class="field-error">{{ errors.currency }}</span>
          </div>
        </div>
        <p v-if="show('green.price') && priceLine" class="muted small" aria-live="polite">{{ priceLine }}</p>
        <div v-if="show('green.supplier') || show('green.lot')" class="form-row">
          <div v-if="show('green.supplier')" class="field">
            <label for="green-supplier">Supplier</label>
            <NameInput id="green-supplier" v-model="form.supplier" :names="supplierNames" maxlength="255" />
          </div>
          <div v-if="show('green.lot')" class="field">
            <label for="green-lot">Lot</label>
            <input id="green-lot" v-model="form.lot" maxlength="100" placeholder="The supplier’s lot or reference" />
          </div>
        </div>
        <div v-if="show('green.purchaseDate')" class="field short">
          <label for="green-purchased">Purchase date</label>
          <input id="green-purchased" v-model="form.purchaseDate" type="date" :max="today" :aria-invalid="submitted && !!errors.purchaseDate" />
          <span v-if="submitted && errors.purchaseDate" class="field-error">{{ errors.purchaseDate }}</span>
        </div>
      </section>

      <section v-if="show('green.notes')" class="card stack">
        <div class="field">
          <label for="green-notes">Notes</label>
          <textarea id="green-notes" v-model="form.notes" rows="3" maxlength="2000" placeholder="e.g. Dense; likes a high charge." />
        </div>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !parsed.values" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'green-coffees' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save green coffee' : 'Add green coffee' }}</button>
      </div>
    </form>
    <DeleteSection
      v-if="props.id && saved && workspaces.canEdit"
      kind="green"
      :name="saved.name"
      :archived="saved.archived"
      :load="deleteUsage"
      :remove="deleteIt"
      :back="{ name: 'green-coffees' }"
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
.short {
  max-width: 14rem;
}
/* As on the bean form. */
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
.price-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--space-3);
  max-width: 24rem;
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

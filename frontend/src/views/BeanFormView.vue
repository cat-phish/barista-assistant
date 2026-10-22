<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { beansApi, type BeanInput } from '../api/beans';
import { errorMessage } from '../api/client';
import AppHeader from '../components/AppHeader.vue';
import { localDateInput, parseDecimal, toDateInput } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';
import type { BlendType, DetailedRoastLevel, RoastLevel, RoastType } from '../api/types';
import { ROAST_LEVELS } from '../lib/scale';
import {
  BLEND_TYPES,
  DETAILED_ROAST_LEVELS,
  ROAST_TYPES,
  formatPricePerGram,
  lastCurrency,
  pricePerGram,
  rememberCurrency,
} from '../lib/beans';

const props = defineProps<{ id?: string }>(); // set when editing (route param)

const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Wet-hulled'];

const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const roasterName = ref('');
const beanName = ref('');
const process = ref('');
const roastLevel = ref<RoastLevel | ''>('');
const detailedRoastLevel = ref<DetailedRoastLevel | ''>('');
const roastType = ref<RoastType | ''>('');
const blendType = ref<BlendType | ''>('');
const decaf = ref(false);
const roastDate = ref('');
const inventory = ref('0');
const showOnPublicMenu = ref(true);
const price = ref('');
const currency = ref(editing.value ? '' : lastCurrency());
const bagWeight = ref('');
const website = ref('');
const notes = ref('');

const loading = ref(editing.value);
const saving = ref(false);
const error = ref('');
const submitted = ref(false); // show field errors only after a save attempt

// A detailed level implies a 5-step one (docs/api/beans.md §4); it stays editable.
function pickDetailedLevel(): void {
  if (detailedRoastLevel.value) roastLevel.value = DETAILED_ROAST_LEVELS[detailedRoastLevel.value].roastLevel;
}

const inventoryParsed = computed(() => parseDecimal(inventory.value, { scale: 0, min: 0, max: 1_000_000 }));
const priceParsed = computed(() =>
  price.value.trim() ? parseDecimal(price.value, { scale: 2, min: 0, max: 1_000_000, exclusiveMin: true, exclusiveMax: true }) : null,
);
const currencyCode = computed(() => currency.value.trim().toUpperCase());
const bagParsed = computed(() => (bagWeight.value.trim() ? parseDecimal(bagWeight.value, { scale: 0, min: 1, max: 100_000 }) : null));
const websiteTrimmed = computed(() => website.value.trim());

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const today = localDateInput();
const fieldErrors = computed(() => ({
  roasterName: roasterName.value.trim() ? '' : 'Required',
  beanName: beanName.value.trim() ? '' : 'Required',
  inventory: inventoryParsed.value.ok ? '' : inventoryParsed.value.error,
  price: priceParsed.value && !priceParsed.value.ok ? priceParsed.value.error : '',
  // Without a price the currency (often prefilled) is ignored, not an error.
  currency:
    priceParsed.value && currencyCode.value && !/^[A-Z]{3}$/.test(currencyCode.value)
      ? 'Use a 3-letter code, e.g. USD'
      : priceParsed.value && !currencyCode.value
        ? 'Required with a price'
        : '',
  bagWeight: bagParsed.value && !bagParsed.value.ok ? bagParsed.value.error : '',
  website: websiteTrimmed.value && !isHttpUrl(websiteTrimmed.value) ? 'Enter a web address starting with https://' : '',
}));
const valid = computed(() => Object.values(fieldErrors.value).every((e) => !e));

const perGram = computed(() => {
  if (!priceParsed.value?.ok || !bagParsed.value?.ok || !/^[A-Z]{3}$/.test(currencyCode.value)) return null;
  const p = pricePerGram({ priceAmount: priceParsed.value.value, priceCurrency: currencyCode.value, bagWeightGrams: bagParsed.value.value });
  return p ? formatPricePerGram(p) : null;
});

onMounted(async () => {
  if (!editing.value) return;
  const ws = workspaces.current?.id;
  try {
    const bean = ws ? (await beansApi.list(ws)).beans.find((b) => b.id === props.id) : undefined;
    if (!bean) {
      error.value = 'This bean no longer exists.';
      return;
    }
    roasterName.value = bean.roasterName;
    beanName.value = bean.beanName;
    process.value = bean.process ?? '';
    roastLevel.value = bean.roastLevel ?? '';
    detailedRoastLevel.value = bean.detailedRoastLevel ?? '';
    roastType.value = bean.roastType ?? '';
    blendType.value = bean.blendType ?? '';
    decaf.value = bean.decaf;
    roastDate.value = toDateInput(bean.roastDate);
    inventory.value = String(bean.inventoryWeightGrams);
    showOnPublicMenu.value = bean.showOnPublicMenu;
    price.value = bean.priceAmount === null ? '' : bean.priceAmount.toFixed(2);
    currency.value = bean.priceCurrency ?? '';
    bagWeight.value = bean.bagWeightGrams === null ? '' : String(bean.bagWeightGrams);
    website.value = bean.website ?? '';
    notes.value = bean.notes ?? '';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!valid.value || !ws || !inventoryParsed.value.ok) return;
  const priceAmount = priceParsed.value?.ok ? priceParsed.value.value : null;
  const input: BeanInput = {
    roasterName: roasterName.value.trim(),
    beanName: beanName.value.trim(),
    process: process.value.trim() || null,
    roastLevel: roastLevel.value || null,
    detailedRoastLevel: detailedRoastLevel.value || null,
    roastType: roastType.value || null,
    blendType: blendType.value || null,
    decaf: decaf.value,
    roastDate: roastDate.value || null,
    inventoryWeightGrams: inventoryParsed.value.value,
    showOnPublicMenu: showOnPublicMenu.value,
    priceAmount,
    priceCurrency: priceAmount === null ? null : currencyCode.value,
    bagWeightGrams: bagParsed.value?.ok ? bagParsed.value.value : null,
    website: websiteTrimmed.value || null,
    notes: notes.value.trim() || null,
  };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await beansApi.update(ws, props.id, input);
    else await beansApi.create(ws, input);
    if (input.priceCurrency) rememberCurrency(input.priceCurrency);
    await router.push({ name: 'beans' });
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
      <h1>{{ editing ? 'Edit bean' : 'Add bean' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="roaster">Roaster</label>
          <input id="roaster" v-model="roasterName" maxlength="255" placeholder="e.g. Onyx Coffee Lab" :aria-invalid="submitted && !!fieldErrors.roasterName" />
          <span v-if="submitted && fieldErrors.roasterName" class="field-error">{{ fieldErrors.roasterName }}</span>
        </div>
        <div class="field">
          <label for="bean">Coffee</label>
          <input id="bean" v-model="beanName" maxlength="255" placeholder="e.g. Ethiopia Guji" :aria-invalid="submitted && !!fieldErrors.beanName" />
          <span v-if="submitted && fieldErrors.beanName" class="field-error">{{ fieldErrors.beanName }}</span>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="process">Process <span class="muted">(optional)</span></label>
            <input id="process" v-model="process" list="processes" maxlength="100" />
            <datalist id="processes">
              <option v-for="p in PROCESSES" :key="p" :value="p" />
            </datalist>
          </div>
          <div class="field">
            <label for="blend-type">Origin <span class="muted">(optional)</span></label>
            <select id="blend-type" v-model="blendType">
              <option value="">Not sure</option>
              <option v-for="(b, key) in BLEND_TYPES" :key="key" :value="key">{{ b.label }}</option>
            </select>
          </div>
        </div>
        <label class="checkbox">
          <input v-model="decaf" type="checkbox" />
          Decaf
        </label>
      </section>

      <section class="card stack">
        <h2>Roast</h2>
        <div class="form-row">
          <div class="field">
            <label for="roast-type">Roasted for <span class="muted">(optional)</span></label>
            <select id="roast-type" v-model="roastType">
              <option value="">Not sure</option>
              <option v-for="(r, key) in ROAST_TYPES" :key="key" :value="key">{{ r.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="roast-date">Roast date <span class="muted">(optional)</span></label>
            <input id="roast-date" v-model="roastDate" type="date" :max="today" />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="detailed-roast">Roast name <span class="muted">(optional)</span></label>
            <select id="detailed-roast" v-model="detailedRoastLevel" @change="pickDetailedLevel">
              <option value="">Not sure</option>
              <option v-for="(d, key) in DETAILED_ROAST_LEVELS" :key="key" :value="key">{{ d.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="roast-level">Roast level <span class="muted">(optional)</span></label>
            <select id="roast-level" v-model="roastLevel">
              <option value="">Not sure</option>
              <option v-for="(r, key) in ROAST_LEVELS" :key="key" :value="key">{{ r.label }}</option>
            </select>
          </div>
        </div>
        <p class="muted small">Roast level helps estimate how much coffee ends up in the cup when you scale a recipe. Picking a roast name sets it for you.</p>
      </section>

      <section class="card stack">
        <h2>Stock and buying</h2>
        <div class="field">
          <label for="inventory">In stock (grams)</label>
          <input id="inventory" v-model="inventory" inputmode="numeric" :aria-invalid="submitted && !!fieldErrors.inventory" />
          <span v-if="submitted && fieldErrors.inventory" class="field-error">{{ fieldErrors.inventory }}</span>
        </div>
        <div class="price-row">
          <div class="field">
            <label for="price">Bag price <span class="muted">(optional)</span></label>
            <input id="price" v-model="price" inputmode="decimal" placeholder="e.g. 21.50" :aria-invalid="submitted && !!fieldErrors.price" />
            <span v-if="submitted && fieldErrors.price" class="field-error">{{ fieldErrors.price }}</span>
          </div>
          <div class="field">
            <label for="currency">Currency</label>
            <input
              id="currency"
              v-model="currency"
              class="currency"
              maxlength="3"
              autocapitalize="characters"
              placeholder="USD"
              :aria-invalid="submitted && !!fieldErrors.currency"
            />
            <span v-if="submitted && fieldErrors.currency" class="field-error">{{ fieldErrors.currency }}</span>
          </div>
          <div class="field">
            <label for="bag-weight">Bag (g)</label>
            <input id="bag-weight" v-model="bagWeight" inputmode="numeric" placeholder="e.g. 340" :aria-invalid="submitted && !!fieldErrors.bagWeight" />
            <span v-if="submitted && fieldErrors.bagWeight" class="field-error">{{ fieldErrors.bagWeight }}</span>
          </div>
        </div>
        <p v-if="perGram" class="muted small" aria-live="polite">≈ {{ perGram }}</p>
        <div class="field">
          <label for="website">Website <span class="muted">(optional)</span></label>
          <input id="website" v-model="website" type="url" inputmode="url" maxlength="500" placeholder="https://" :aria-invalid="submitted && !!fieldErrors.website" />
          <span v-if="submitted && fieldErrors.website" class="field-error">{{ fieldErrors.website }}</span>
        </div>
        <label class="checkbox">
          <input v-model="showOnPublicMenu" type="checkbox" />
          Show on the public menu
        </label>
      </section>

      <section class="card stack">
        <div class="field">
          <label for="notes">Notes <span class="muted">(optional)</span></label>
          <textarea id="notes" v-model="notes" rows="4" maxlength="2000" placeholder="e.g. Roaster suggests 1:16. Best after 10 days." />
        </div>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !valid" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'beans' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save bean' }}</button>
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
.price-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
}
@media (max-width: 380px) {
  .price-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
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

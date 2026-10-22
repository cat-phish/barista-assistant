<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { beansApi, type BeanInput } from '../api/beans';
import { errorMessage } from '../api/client';
import AppHeader from '../components/AppHeader.vue';
import RatingInput from '../components/RatingInput.vue';
import { localDateInput, parseDecimal, toDateInput } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';
import type { BeanProcess, BlendType, DetailedRoastLevel, RoastLevel, RoastType } from '../api/types';
import { ROAST_LEVELS } from '../lib/scale';
import {
  BEAN_PROCESSES,
  BLEND_TYPES,
  DETAILED_ROAST_LEVELS,
  ROAST_TYPES,
  formatPricePerGram,
  lastCurrency,
  pricePerGram,
  rememberCurrency,
} from '../lib/beans';

const props = defineProps<{ id?: string }>(); // set when editing (route param)

const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const roasterName = ref('');
const beanName = ref('');
const process = ref<BeanProcess | ''>('');
const producer = ref('');
const region = ref('');
const altitude = ref('');
const flavorProfile = ref('');
const blendType = ref<BlendType | ''>('');
const decaf = ref(false);
const roastType = ref<RoastType | ''>('');
const roastDate = ref('');
const detailedRoastLevel = ref<DetailedRoastLevel | ''>('');
const inventory = ref('0');
const price = ref('');
const currency = ref(editing.value ? '' : lastCurrency());
const bagWeight = ref('');
const purchaseDate = ref('');
const greenSupplier = ref('');
const website = ref('');
const showOnPublicMenu = ref(true);
const rating = ref<number | null>(null);
const notes = ref('');

// As saved, for beans from before detailed levels: their 5-step level shows
// until a detailed one is picked.
const savedRoastLevel = ref<RoastLevel | null>(null);
const savedDetailed = ref<DetailedRoastLevel | null>(null);

const loading = ref(editing.value);
const saving = ref(false);
const error = ref('');
const submitted = ref(false); // show field errors only after a save attempt

// The 5-step level the API will store (docs/api/beans.md §4), shown read-only.
const impliedRoastLevel = computed<RoastLevel | null>(() => {
  if (detailedRoastLevel.value) return DETAILED_ROAST_LEVELS[detailedRoastLevel.value].roastLevel;
  return savedDetailed.value ? null : savedRoastLevel.value; // clearing a detailed level clears it
});

const inventoryParsed = computed(() => parseDecimal(inventory.value, { scale: 0, min: 0, max: 1_000_000 }));
const altitudeParsed = computed(() => (altitude.value.trim() ? parseDecimal(altitude.value, { scale: 0, min: 0, max: 9000 }) : null));
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
  altitude: altitudeParsed.value && !altitudeParsed.value.ok ? altitudeParsed.value.error : '',
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
  purchaseDate: purchaseDate.value > today ? "Can't be in the future" : '',
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
    producer.value = bean.producer ?? '';
    region.value = bean.region ?? '';
    altitude.value = bean.altitudeMasl === null ? '' : String(bean.altitudeMasl);
    flavorProfile.value = bean.flavorProfile ?? '';
    blendType.value = bean.blendType ?? '';
    decaf.value = bean.decaf;
    roastType.value = bean.roastType ?? '';
    roastDate.value = toDateInput(bean.roastDate);
    detailedRoastLevel.value = bean.detailedRoastLevel ?? '';
    savedDetailed.value = bean.detailedRoastLevel;
    savedRoastLevel.value = bean.roastLevel;
    inventory.value = String(bean.inventoryWeightGrams);
    price.value = bean.priceAmount === null ? '' : bean.priceAmount.toFixed(2);
    currency.value = bean.priceCurrency ?? '';
    bagWeight.value = bean.bagWeightGrams === null ? '' : String(bean.bagWeightGrams);
    purchaseDate.value = bean.purchaseDate ?? '';
    greenSupplier.value = bean.greenSupplier ?? '';
    website.value = bean.website ?? '';
    showOnPublicMenu.value = bean.showOnPublicMenu;
    rating.value = bean.rating;
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
    process: process.value || null,
    producer: producer.value.trim() || null,
    region: region.value.trim() || null,
    altitudeMasl: altitudeParsed.value?.ok ? altitudeParsed.value.value : null,
    flavorProfile: flavorProfile.value.trim() || null,
    blendType: blendType.value || null,
    decaf: decaf.value,
    roastType: roastType.value || null,
    roastDate: roastDate.value || null,
    detailedRoastLevel: detailedRoastLevel.value || null,
    inventoryWeightGrams: inventoryParsed.value.value,
    priceAmount,
    priceCurrency: priceAmount === null ? null : currencyCode.value,
    bagWeightGrams: bagParsed.value?.ok ? bagParsed.value.value : null,
    purchaseDate: purchaseDate.value || null,
    greenSupplier: greenSupplier.value.trim() || null,
    website: websiteTrimmed.value || null,
    showOnPublicMenu: showOnPublicMenu.value,
    rating: rating.value,
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
            <select id="process" v-model="process">
              <option value="">Not sure</option>
              <option v-for="(p, key) in BEAN_PROCESSES" :key="key" :value="key">{{ p.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="blend-type">Origin <span class="muted">(optional)</span></label>
            <select id="blend-type" v-model="blendType">
              <option value="">Not sure</option>
              <option v-for="(b, key) in BLEND_TYPES" :key="key" :value="key">{{ b.label }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="producer">Producer <span class="muted">(optional)</span></label>
            <input id="producer" v-model="producer" maxlength="255" placeholder="e.g. Finca El Paraíso" />
          </div>
          <div class="field">
            <label for="region">Region <span class="muted">(optional)</span></label>
            <input id="region" v-model="region" maxlength="255" placeholder="e.g. Huila" />
          </div>
        </div>
        <div class="field altitude">
          <label for="altitude">Altitude (m) <span class="muted">(optional)</span></label>
          <input id="altitude" v-model="altitude" inputmode="numeric" placeholder="e.g. 1950" :aria-invalid="submitted && !!fieldErrors.altitude" />
          <span v-if="submitted && fieldErrors.altitude" class="field-error">{{ fieldErrors.altitude }}</span>
        </div>
        <div class="field">
          <label for="flavor-profile">Flavor profile <span class="muted">(optional)</span></label>
          <textarea id="flavor-profile" v-model="flavorProfile" rows="2" maxlength="500" placeholder="e.g. Milk chocolate, plum, cane sugar" />
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
            <label for="detailed-roast">Roast Level <span class="muted">(optional)</span></label>
            <select id="detailed-roast" v-model="detailedRoastLevel">
              <option value="">Not sure</option>
              <option v-for="(d, key) in DETAILED_ROAST_LEVELS" :key="key" :value="key">{{ d.label }}</option>
            </select>
          </div>
          <div class="field">
            <span id="implied-roast-label" class="label">Light to dark</span>
            <output class="readonly" for="detailed-roast" aria-labelledby="implied-roast-label" aria-live="polite">
              {{ impliedRoastLevel ? ROAST_LEVELS[impliedRoastLevel].label : '—' }}
            </output>
          </div>
        </div>
        <p class="muted small">The roast helps estimate how much coffee ends up in the cup when you scale a recipe.</p>
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
            <label for="bag-weight">Bag Weight (g)</label>
            <input id="bag-weight" v-model="bagWeight" inputmode="numeric" placeholder="e.g. 340" :aria-invalid="submitted && !!fieldErrors.bagWeight" />
            <span v-if="submitted && fieldErrors.bagWeight" class="field-error">{{ fieldErrors.bagWeight }}</span>
          </div>
        </div>
        <p v-if="perGram" class="muted small" aria-live="polite">≈ {{ perGram }}</p>
        <div class="form-row">
          <div class="field">
            <label for="purchase-date">Purchase date <span class="muted">(optional)</span></label>
            <input id="purchase-date" v-model="purchaseDate" type="date" :max="today" :aria-invalid="submitted && !!fieldErrors.purchaseDate" />
            <span v-if="submitted && fieldErrors.purchaseDate" class="field-error">{{ fieldErrors.purchaseDate }}</span>
          </div>
          <div class="field">
            <label for="green-supplier">Green bean supplier <span class="muted">(optional)</span></label>
            <input id="green-supplier" v-model="greenSupplier" maxlength="255" />
          </div>
        </div>
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
        <RatingInput v-model="rating" name="bean-rating" label="Rating" />
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
.altitude {
  max-width: 12rem;
}
/* Looks like a field, but is computed: the 5-step level the roast implies. */
.label {
  font-weight: 600;
  font-size: 0.9rem;
}
.readonly {
  display: flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
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

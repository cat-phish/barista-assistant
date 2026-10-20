<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { beansApi, type BeanInput } from '../api/beans';
import { errorMessage } from '../api/client';
import AppHeader from '../components/AppHeader.vue';
import { localDateInput, parseDecimal, toDateInput } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';
import type { RoastLevel } from '../api/types';
import { ROAST_LEVELS } from '../lib/scale';

const props = defineProps<{ id?: string }>(); // set when editing (route param)

const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Wet-hulled'];

const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const roasterName = ref('');
const beanName = ref('');
const process = ref('');
const roastLevel = ref<RoastLevel | ''>('');
const roastDate = ref('');
const inventory = ref('0');
const showOnPublicMenu = ref(true);

const loading = ref(editing.value);
const saving = ref(false);
const error = ref('');
const submitted = ref(false); // show field errors only after a save attempt

const inventoryParsed = computed(() => parseDecimal(inventory.value, { scale: 0, min: 0, max: 1_000_000 }));
const today = localDateInput();
const fieldErrors = computed(() => ({
  roasterName: roasterName.value.trim() ? '' : 'Required',
  beanName: beanName.value.trim() ? '' : 'Required',
  inventory: inventoryParsed.value.ok ? '' : inventoryParsed.value.error,
}));
const valid = computed(() => Object.values(fieldErrors.value).every((e) => !e));

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
    roastDate.value = toDateInput(bean.roastDate);
    inventory.value = String(bean.inventoryWeightGrams);
    showOnPublicMenu.value = bean.showOnPublicMenu;
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
  const input: BeanInput = {
    roasterName: roasterName.value.trim(),
    beanName: beanName.value.trim(),
    process: process.value.trim() || null,
    roastLevel: roastLevel.value || null,
    roastDate: roastDate.value || null,
    inventoryWeightGrams: inventoryParsed.value.value,
    showOnPublicMenu: showOnPublicMenu.value,
  };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await beansApi.update(ws, props.id, input);
    else await beansApi.create(ws, input);
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

    <form v-else class="card stack" novalidate @submit.prevent="save">
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
          <label for="roast-level">Roast level <span class="muted">(optional)</span></label>
          <select id="roast-level" v-model="roastLevel">
            <option value="">Not sure</option>
            <option v-for="(r, key) in ROAST_LEVELS" :key="key" :value="key">{{ r.label }}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="roast-date">Roast date <span class="muted">(optional)</span></label>
        <input id="roast-date" v-model="roastDate" type="date" :max="today" />
      </div>
      <p class="muted small roast-hint">Roast level helps estimate how much coffee ends up in the cup when you scale a recipe.</p>
      <div class="field">
        <label for="inventory">In stock (grams)</label>
        <input id="inventory" v-model="inventory" inputmode="numeric" :aria-invalid="submitted && !!fieldErrors.inventory" />
        <span v-if="submitted && fieldErrors.inventory" class="field-error">{{ fieldErrors.inventory }}</span>
      </div>
      <label class="checkbox">
        <input v-model="showOnPublicMenu" type="checkbox" />
        Show on the public menu
      </label>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'beans' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save bean' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
.small {
  font-size: 0.85rem;
}
.roast-hint {
  margin: calc(-1 * var(--space-2)) 0 0;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

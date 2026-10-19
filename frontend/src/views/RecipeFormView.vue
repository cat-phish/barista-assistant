<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { brewMethodsApi, recipesApi, type RecipeInput } from '../api/recipes';
import type { BrewMethod } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { formatGrams, formatRatio, formatTime, parseDecimal, parseSteps, type StepDraft } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ id?: string }>(); // set when editing (route param)
const NEW_METHOD = '__new__';

const workspaces = useWorkspaceStore();
const router = useRouter();
const editing = computed(() => props.id !== undefined);

const methods = ref<BrewMethod[]>([]);
const name = ref('');
const methodId = ref('');
const dose = ref('');
const yieldGrams = ref('');
const temp = ref('');
const grind = ref('');
const showOnPublicMenu = ref(true);
const steps = ref<StepDraft[]>([]);

// Inline "add a new brew method" (methods are a per-workspace list, §3).
const newMethodName = ref('');
const addingMethod = ref(false);
const methodError = ref('');
const newMethodInput = ref<HTMLInputElement | null>(null);

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const submitted = ref(false);

const doseParsed = computed(() => parseDecimal(dose.value, { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true }));
const yieldParsed = computed(() => parseDecimal(yieldGrams.value, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true }));
const tempParsed = computed(() => (temp.value.trim() ? parseDecimal(temp.value, { scale: 1, min: 0, max: 100 }) : null));
const stepsParsed = computed(() => parseSteps(steps.value));

const fieldErrors = computed(() => ({
  name: name.value.trim() ? '' : 'Required',
  method: methodId.value && methodId.value !== NEW_METHOD ? '' : 'Choose a brew method',
  dose: doseParsed.value.ok ? '' : doseParsed.value.error,
  yield: yieldParsed.value.ok ? '' : yieldParsed.value.error,
  temp: tempParsed.value && !tempParsed.value.ok ? tempParsed.value.error : '',
}));
const valid = computed(
  () => Object.values(fieldErrors.value).every((e) => !e) && Object.keys(stepsParsed.value.errors).length === 0,
);
const ratio = computed(() =>
  doseParsed.value.ok && yieldParsed.value.ok ? formatRatio(doseParsed.value.value, yieldParsed.value.value) : null,
);

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [methodList, recipeList] = await Promise.all([
      brewMethodsApi.list(ws),
      editing.value ? recipesApi.list(ws) : Promise.resolve(null),
    ]);
    methods.value = methodList.brewMethods;
    if (!editing.value) return;
    const recipe = recipeList?.recipes.find((r) => r.id === props.id);
    if (!recipe) {
      error.value = 'This recipe no longer exists.';
      return;
    }
    name.value = recipe.name;
    methodId.value = recipe.method.id;
    dose.value = formatGrams(recipe.targetDoseGrams);
    yieldGrams.value = formatGrams(recipe.targetYieldGrams);
    temp.value = recipe.targetTempC === null ? '' : String(recipe.targetTempC);
    grind.value = recipe.targetGrindSetting ?? '';
    showOnPublicMenu.value = recipe.showOnPublicMenu;
    steps.value = recipe.steps.map((s) => ({
      actionName: s.actionName,
      time: formatTime(s.targetTimeSec),
      water: formatGrams(s.targetWaterGrams),
    }));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function onMethodChange(): Promise<void> {
  if (methodId.value !== NEW_METHOD) return;
  methodError.value = '';
  await nextTick();
  newMethodInput.value?.focus();
}

async function addMethod(): Promise<void> {
  const ws = workspaces.current?.id;
  const trimmed = newMethodName.value.trim();
  if (!ws || !trimmed) return;
  addingMethod.value = true;
  methodError.value = '';
  try {
    const { brewMethod } = await brewMethodsApi.create(ws, trimmed);
    methods.value = [...methods.value, brewMethod].sort((a, b) => a.name.localeCompare(b.name));
    methodId.value = brewMethod.id;
    newMethodName.value = '';
  } catch (err) {
    methodError.value =
      err instanceof ApiError && err.status === 409 ? 'That method already exists. Pick it from the list.' : errorMessage(err);
  } finally {
    addingMethod.value = false;
  }
}

function addStep(): void {
  // Suggest the next step continuing from the last one.
  const last = stepsParsed.value.steps[stepsParsed.value.steps.length - 1];
  steps.value.push({
    actionName: steps.value.length === 0 ? 'Bloom' : '',
    time: last ? formatTime(last.targetTimeSec + 30) : '0:45',
    water: last ? formatGrams(last.targetWaterGrams) : '',
  });
}

function removeStep(index: number): void {
  steps.value.splice(index, 1);
}

async function save(): Promise<void> {
  submitted.value = true;
  const ws = workspaces.current?.id;
  if (!valid.value || !ws || !doseParsed.value.ok || !yieldParsed.value.ok) return;
  const input: RecipeInput = {
    name: name.value.trim(),
    methodId: methodId.value,
    targetDoseGrams: doseParsed.value.value,
    targetYieldGrams: yieldParsed.value.value,
    targetTempC: tempParsed.value?.ok ? tempParsed.value.value : null,
    targetGrindSetting: grind.value.trim() || null,
    showOnPublicMenu: showOnPublicMenu.value,
    steps: stepsParsed.value.steps,
  };
  saving.value = true;
  error.value = '';
  try {
    if (props.id) await recipesApi.update(ws, props.id, input);
    else await recipesApi.create(ws, input);
    await router.push({ name: 'recipes' });
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
      <h1>{{ editing ? 'Edit recipe' : 'Add recipe' }}</h1>
    </div>
    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>

    <form v-else class="stack" novalidate @submit.prevent="save">
      <section class="card stack">
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="name" maxlength="255" placeholder="e.g. House V60" :aria-invalid="submitted && !!fieldErrors.name" />
          <span v-if="submitted && fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </div>

        <div class="field">
          <label for="method">Brew method</label>
          <select id="method" v-model="methodId" :aria-invalid="submitted && !!fieldErrors.method" @change="onMethodChange">
            <option value="" disabled>Choose…</option>
            <option v-for="m in methods" :key="m.id" :value="m.id">{{ m.name }}</option>
            <option :value="NEW_METHOD">+ Add a new method…</option>
          </select>
          <span v-if="submitted && fieldErrors.method" class="field-error">{{ fieldErrors.method }}</span>
        </div>
        <div v-if="methodId === NEW_METHOD" class="new-method">
          <div class="field grow">
            <label for="new-method">New method name</label>
            <input
              id="new-method"
              ref="newMethodInput"
              v-model="newMethodName"
              maxlength="100"
              placeholder="e.g. Chemex"
              @keydown.enter.prevent="addMethod"
            />
          </div>
          <button class="btn btn-secondary" type="button" :disabled="addingMethod || !newMethodName.trim()" @click="addMethod">
            Add
          </button>
          <span v-if="methodError" class="field-error full">{{ methodError }}</span>
        </div>

        <div class="form-row">
          <div class="field">
            <label for="dose">Dose (g)</label>
            <input id="dose" v-model="dose" inputmode="decimal" placeholder="15" :aria-invalid="submitted && !!fieldErrors.dose" />
            <span v-if="submitted && fieldErrors.dose" class="field-error">{{ fieldErrors.dose }}</span>
          </div>
          <div class="field">
            <label for="yield">Yield (g)</label>
            <input id="yield" v-model="yieldGrams" inputmode="decimal" placeholder="250" :aria-invalid="submitted && !!fieldErrors.yield" />
            <span v-if="submitted && fieldErrors.yield" class="field-error">{{ fieldErrors.yield }}</span>
          </div>
        </div>
        <p v-if="ratio" class="muted ratio">Ratio {{ ratio }}</p>

        <div class="form-row">
          <div class="field">
            <label for="temp">Water temp (°C) <span class="muted">(optional)</span></label>
            <input id="temp" v-model="temp" inputmode="decimal" placeholder="94" :aria-invalid="submitted && !!fieldErrors.temp" />
            <span v-if="submitted && fieldErrors.temp" class="field-error">{{ fieldErrors.temp }}</span>
          </div>
          <div class="field">
            <label for="grind">Grind <span class="muted">(optional)</span></label>
            <input id="grind" v-model="grind" maxlength="100" placeholder="e.g. 20 clicks" />
          </div>
        </div>

        <label class="checkbox">
          <input v-model="showOnPublicMenu" type="checkbox" />
          Show on the public menu
        </label>
      </section>

      <section class="card stack">
        <div class="steps-head">
          <h2>Pour steps</h2>
          <span class="muted">Times and water are running totals.</span>
        </div>
        <p v-if="steps.length === 0" class="muted">No steps. Fine for espresso; add pours for the pour-over timer.</p>
        <ol v-else class="steps">
          <li v-for="(step, i) in steps" :key="i" class="step">
            <span class="num" aria-hidden="true">{{ i + 1 }}</span>
            <div class="step-fields">
              <div class="field">
                <label :for="`step-name-${i}`" class="visually-hidden">Step {{ i + 1 }} name</label>
                <input :id="`step-name-${i}`" v-model="step.actionName" maxlength="255" placeholder="e.g. First pour" />
              </div>
              <div class="field">
                <label :for="`step-time-${i}`">Ends at</label>
                <input :id="`step-time-${i}`" v-model="step.time" inputmode="numeric" placeholder="m:ss" />
              </div>
              <div class="field">
                <label :for="`step-water-${i}`">Scale (g)</label>
                <input :id="`step-water-${i}`" v-model="step.water" inputmode="decimal" />
              </div>
              <span v-if="stepsParsed.errors[i]" class="field-error full">{{ stepsParsed.errors[i] }}</span>
            </div>
            <button class="btn-link danger" type="button" :aria-label="`Remove step ${i + 1}`" @click="removeStep(i)">✕</button>
          </li>
        </ol>
        <button class="btn btn-secondary" type="button" :disabled="steps.length >= 20" @click="addStep">Add step</button>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="submitted && !valid" class="form-error" role="alert">Fix the highlighted fields to save.</p>
      <div class="buttons">
        <RouterLink class="btn btn-secondary" :to="{ name: 'recipes' }">Cancel</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save recipe' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
}
p {
  margin: 0;
}
.ratio {
  margin-top: calc(-1 * var(--space-2));
  font-size: 0.9rem;
}
.new-method {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.grow {
  flex: 1;
  min-width: 10rem;
}
.full {
  flex-basis: 100%;
  grid-column: 1 / -1;
}
.steps-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.steps-head .muted {
  font-size: 0.85rem;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2);
}
.num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  margin-top: 0.6rem;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
}
.step-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
.step-fields .field:first-child {
  grid-column: 1 / -1;
}
.step-fields label {
  font-size: 0.8rem;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

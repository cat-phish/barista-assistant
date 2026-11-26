<script setup lang="ts">
// Key and models, for a workspace (Settings → AI) or the server (Settings →
// Server → AI). The key is write-only: only its last four come back. Each
// feature can have its own model, and its own key and provider
// (docs/api/workspaces.md §2d "Per feature"); without them it uses the main.
import { computed, reactive, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { AI_FEATURES, AI_PROVIDERS, type AiCheck, type AiFeature, type AiOverrides, type AiOverridesInput, type AiProvider } from '../api/server';

export interface AiKeyValues {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string | null;
  model: string;
  visionModel: string | null;
  webModel: string | null;
  overrides: AiOverridesInput;
}
const props = defineProps<{
  id: string;
  saved: {
    provider: AiProvider;
    keyLast4: string | null;
    model: string | null;
    visionModel: string | null;
    webModel: string | null;
    baseUrl?: string | null;
    overrides?: AiOverrides;
  } | null;
  canSaveKeys: boolean;
  disabled?: boolean;
  withBaseUrl?: boolean;
  save: (values: AiKeyValues) => Promise<unknown>;
  remove: () => Promise<unknown>;
  listModels: (feature?: AiFeature) => Promise<AiCheck>;
  test: (feature?: AiFeature) => Promise<AiCheck>;
}>();

// The default offered for a new Anthropic key; it can be changed like any other.
const ANTHROPIC_MODEL = 'claude-opus-5-5';
const FEATURES = Object.keys(AI_FEATURES) as AiFeature[];
// Label photos and web lookup's model on the main provider is the vision and
// web model, which chat with photos also falls back to.
const MODEL_FIELD: Partial<Record<AiFeature, 'visionModel' | 'webModel'>> = { label: 'visionModel', web: 'webModel' };

interface Row {
  provider: AiProvider | ''; // '': the main one
  apiKey: string;
  replacing: boolean; // typing a new key over the saved one
  dropKey: boolean; // back to the main key
  model: string;
  note: string;
  error: string;
  models: string[];
}
const blankRow = (): Row => ({ provider: '', apiKey: '', replacing: false, dropKey: false, model: '', note: '', error: '', models: [] });

const form = reactive({ provider: 'openai' as AiProvider, apiKey: '', baseUrl: '', model: '' });
const rows = reactive(Object.fromEntries(FEATURES.map((f) => [f, blankRow()])) as Record<AiFeature, Row>);
const replacing = ref(false);
const busy = ref(false);
const error = ref('');
const note = ref('');
const models = ref<string[]>([]);
const hasKey = computed(() => !!props.saved?.keyLast4);
// Another provider's key won't do.
const needsKey = computed(() => !hasKey.value || replacing.value || form.provider !== props.saved?.provider);

const providerOf = (f: AiFeature): AiProvider => rows[f].provider || form.provider;
const otherProvider = (f: AiFeature): boolean => providerOf(f) !== form.provider;
// The feature's saved key, while it's still the one that would be used.
function keptKey(f: AiFeature): string | null {
  const o = props.saved?.overrides?.[f];
  const r = rows[f];
  return o?.keyLast4 && o.provider === providerOf(f) && !r.replacing && !r.dropKey ? o.keyLast4 : null;
}
const rowReady = (f: AiFeature): boolean => !otherProvider(f) || (rows[f].model.trim() !== '' && (rows[f].apiKey.trim() !== '' || keptKey(f) !== null));
// What the feature uses now, for its summary line.
// Blank web model: the vision one, as the server does (modelsFor).
const fallbackModel = (f: AiFeature): string => (f === 'web' && sideModel('label')) || form.model;
function inUse(f: AiFeature): string {
  const model = rows[f].model.trim() || fallbackModel(f) || '—';
  const key = rows[f].apiKey.trim() || keptKey(f) ? 'own key' : 'main key';
  return [otherProvider(f) ? AI_PROVIDERS[providerOf(f)] : '', model, key].filter(Boolean).join(' · ');
}
const otherProviders = computed(() => (Object.keys(AI_PROVIDERS) as AiProvider[]).filter((p) => p !== form.provider));

watch(
  () => props.saved,
  (s) => {
    Object.assign(form, { provider: s?.provider ?? 'openai', apiKey: '', baseUrl: s?.baseUrl ?? '', model: s?.model ?? '' });
    for (const f of FEATURES) {
      const o = s?.overrides?.[f];
      const field = MODEL_FIELD[f];
      Object.assign(rows[f], blankRow(), {
        provider: o && o.provider !== s?.provider ? o.provider : '',
        model: o?.model ?? (field ? (s?.[field] ?? '') : ''),
      });
    }
    replacing.value = false;
  },
  { immediate: true },
);
const ready = computed(() => form.model.trim() !== '' && (!needsKey.value || form.apiKey.trim() !== '') && FEATURES.every(rowReady));

function overridesInput(): AiOverridesInput {
  const out: AiOverridesInput = {};
  for (const f of FEATURES) {
    const r = rows[f];
    const key = r.apiKey.trim();
    const apiKey = key ? key : r.dropKey ? null : undefined;
    const model = r.model.trim() || null;
    const hasOwnKey = key !== '' || keptKey(f) !== null;
    if (!otherProvider(f) && !hasOwnKey && !model) continue;
    out[f] = { provider: providerOf(f), model, ...(apiKey !== undefined ? { apiKey } : {}) };
  }
  return out;
}
// On the main provider, a label or web model is the vision or web model.
function sideModel(f: 'label' | 'web'): string | null {
  return otherProvider(f) ? null : rows[f].model.trim() || null;
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  note.value = '';
  try {
    await action();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
const submit = () =>
  run(async () => {
    await props.save({
      provider: form.provider,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(props.withBaseUrl ? { baseUrl: form.baseUrl.trim() || null } : {}),
      model: form.model.trim(),
      visionModel: sideModel('label'),
      webModel: sideModel('web'),
      overrides: overridesInput(),
    });
    note.value = 'Saved.';
    await loadModels();
  });
async function loadModels(): Promise<void> {
  const r = await props.listModels().catch(() => null);
  if (r?.ok) models.value = r.models; // otherwise models are simply typed
}
// A feature on another provider lists that provider's models, once its key is saved.
async function openRow(f: AiFeature, open: boolean): Promise<void> {
  if (!open || !otherProvider(f) || !keptKey(f) || rows[f].models.length) return;
  const r = await props.listModels(f).catch(() => null);
  if (r?.ok) rows[f].models = r.models;
}
const tryIt = () =>
  run(async () => {
    const r = await props.test();
    if (r.ok) note.value = `${form.model} answered.`;
    else error.value = r.error ?? "It didn't answer.";
  });
async function tryFeature(f: AiFeature): Promise<void> {
  const r = rows[f];
  r.note = '';
  r.error = '';
  busy.value = true;
  try {
    const answer = await props.test(f);
    if (answer.ok) r.note = 'It answered.';
    else r.error = answer.error ?? "It didn't answer.";
  } catch (err) {
    r.error = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
function changeProvider(): void {
  models.value = [];
  // A feature now on the main provider is "Same as above".
  for (const f of FEATURES) if (rows[f].provider === form.provider) rows[f].provider = '';
  if (form.provider === 'anthropic' && !form.model) form.model = ANTHROPIC_MODEL;
}
function changeRowProvider(f: AiFeature): void {
  const r = rows[f];
  r.models = [];
  r.replacing = false;
  if (otherProvider(f) && providerOf(f) === 'anthropic' && !r.model) r.model = ANTHROPIC_MODEL;
}
const forget = () => run(() => props.remove().then(() => undefined));
watch(hasKey, (has) => has && void loadModels(), { immediate: true });
</script>

<template>
  <form class="stack" novalidate @submit.prevent="submit">
    <fieldset class="stack" :disabled="disabled || busy">
      <p v-if="!canSaveKeys" class="muted small">Keys can't be saved until <code>AI_CONFIG_SECRET</code> is set on the server.</p>
      <div class="field">
        <label :for="`${id}-provider`">Provider</label>
        <select :id="`${id}-provider`" v-model="form.provider" @change="changeProvider">
          <option v-for="(label, value) in AI_PROVIDERS" :key="value" :value="value">{{ label }}</option>
        </select>
      </div>
      <div v-if="!needsKey" class="key-line">
        <span>Key set, ends in …{{ saved?.keyLast4 }}</span>
        <button class="btn-link small" type="button" @click="replacing = true">Replace</button>
        <button class="btn-link small" type="button" @click="forget">Remove</button>
      </div>
      <div v-else class="field">
        <label :for="`${id}-key`">API key<span class="req" aria-hidden="true">*</span></label>
        <input :id="`${id}-key`" v-model="form.apiKey" type="password" autocomplete="off" aria-required="true" :disabled="!canSaveKeys" />
      </div>
      <div v-if="withBaseUrl" class="field">
        <label :for="`${id}-url`">Base URL</label>
        <input :id="`${id}-url`" v-model="form.baseUrl" type="url" inputmode="url" placeholder="https://api.openai.com/v1" />
        <p class="muted small">For a server compatible with this provider.</p>
      </div>
      <div class="field">
        <label :for="`${id}-model`">Model<span class="req" aria-hidden="true">*</span></label>
        <input :id="`${id}-model`" v-model="form.model" :list="`${id}-models`" autocomplete="off" aria-required="true" />
      </div>
      <datalist :id="`${id}-models`">
        <option v-for="m in models" :key="m" :value="m" />
      </datalist>

      <div class="stack features">
        <h3 class="features-title">Per feature</h3>
        <p class="muted small">A feature can use its own model, and its own key or provider. Left blank, it uses the ones above.</p>
        <details v-for="f in FEATURES" :key="f" class="feature" @toggle="openRow(f, ($event.target as HTMLDetailsElement).open)">
          <summary>
            <span class="feature-name">{{ AI_FEATURES[f].label }}</span>
            <span class="muted small">{{ inUse(f) }}</span>
          </summary>
          <div class="stack feature-body">
            <p class="muted small">{{ AI_FEATURES[f].hint }}</p>
            <div class="field">
              <label :for="`${id}-${f}-provider`">Provider</label>
              <select :id="`${id}-${f}-provider`" v-model="rows[f].provider" @change="changeRowProvider(f)">
                <option value="">Same as above</option>
                <option v-for="p in otherProviders" :key="p" :value="p">{{ AI_PROVIDERS[p] }}</option>
              </select>
            </div>
            <div v-if="keptKey(f)" class="key-line">
              <span>Own key, ends in …{{ keptKey(f) }}</span>
              <button class="btn-link small" type="button" @click="rows[f].replacing = true">Replace</button>
              <button v-if="!otherProvider(f)" class="btn-link small" type="button" @click="rows[f].dropKey = true">Use the main key</button>
            </div>
            <div v-else class="field">
              <label :for="`${id}-${f}-key`">API key<span v-if="otherProvider(f)" class="req" aria-hidden="true">*</span></label>
              <input
                :id="`${id}-${f}-key`"
                v-model="rows[f].apiKey"
                type="password"
                autocomplete="off"
                :aria-required="otherProvider(f)"
                :disabled="!canSaveKeys"
                :placeholder="otherProvider(f) ? '' : 'Uses the main key'"
              />
            </div>
            <div class="field">
              <label :for="`${id}-${f}-model`">Model<span v-if="otherProvider(f)" class="req" aria-hidden="true">*</span></label>
              <input
                :id="`${id}-${f}-model`"
                v-model="rows[f].model"
                :list="otherProvider(f) ? `${id}-${f}-models` : `${id}-models`"
                autocomplete="off"
                :aria-required="otherProvider(f)"
                :placeholder="otherProvider(f) ? '' : fallbackModel(f)"
              />
              <datalist v-if="otherProvider(f)" :id="`${id}-${f}-models`">
                <option v-for="m in rows[f].models" :key="m" :value="m" />
              </datalist>
            </div>
            <div v-if="saved?.overrides?.[f]" class="key-line">
              <button class="btn btn-secondary small" type="button" @click="tryFeature(f)">Test</button>
              <span v-if="rows[f].error" class="form-error small" role="alert">{{ rows[f].error }}</span>
              <span v-else-if="rows[f].note" class="muted small" aria-live="polite">{{ rows[f].note }}</span>
            </div>
          </div>
        </details>
      </div>

      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="!ready">{{ busy ? 'Working…' : 'Save' }}</button>
        <button v-if="hasKey" class="btn btn-secondary" type="button" @click="tryIt">Test</button>
      </div>
    </fieldset>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="note" class="muted small" aria-live="polite">{{ note }}</p>
  </form>
</template>

<style scoped>
fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.key-line,
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.small {
  font-size: 0.85rem;
}
.features-title {
  margin: 0;
  font-size: 1rem;
}
.feature {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
}
.feature summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  cursor: pointer;
}
.feature-name {
  font-weight: 600;
}
.feature-body {
  margin-top: var(--space-3);
}
</style>

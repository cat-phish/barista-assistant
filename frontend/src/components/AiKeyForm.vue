<script setup lang="ts">
// Key and models, for a workspace (Settings → AI) or the server (Settings →
// Server → AI). The key is write-only: only its last four come back.
import { computed, reactive, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { AI_PROVIDERS, type AiCheck, type AiProvider } from '../api/server';

export interface AiKeyValues {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string | null;
  model: string;
  visionModel: string | null;
  webModel: string | null;
}
const props = defineProps<{
  id: string;
  saved: { provider: AiProvider; keyLast4: string | null; model: string | null; visionModel: string | null; webModel: string | null; baseUrl?: string | null } | null;
  canSaveKeys: boolean;
  disabled?: boolean;
  withBaseUrl?: boolean;
  save: (values: AiKeyValues) => Promise<unknown>;
  remove: () => Promise<unknown>;
  listModels: () => Promise<AiCheck>;
  test: () => Promise<AiCheck>;
}>();

// The default offered for a new Anthropic key; it can be changed like any other.
const ANTHROPIC_MODEL = 'claude-opus-5-5';
const form = reactive({ provider: 'openai' as AiProvider, apiKey: '', baseUrl: '', model: '', visionModel: '', webModel: '' });
const replacing = ref(false);
const busy = ref(false);
const error = ref('');
const note = ref('');
const models = ref<string[]>([]);
const hasKey = computed(() => !!props.saved?.keyLast4);
// Another provider's key won't do.
const needsKey = computed(() => !hasKey.value || replacing.value || form.provider !== props.saved?.provider);

watch(
  () => props.saved,
  (s) => {
    Object.assign(form, { provider: s?.provider ?? 'openai', apiKey: '', baseUrl: s?.baseUrl ?? '', model: s?.model ?? '', visionModel: s?.visionModel ?? '', webModel: s?.webModel ?? '' });
    replacing.value = false;
  },
  { immediate: true },
);
const ready = computed(() => form.model.trim() !== '' && (!needsKey.value || form.apiKey.trim() !== ''));

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
      visionModel: form.visionModel.trim() || null,
      webModel: form.webModel.trim() || null,
    });
    note.value = 'Saved.';
    await loadModels();
  });
async function loadModels(): Promise<void> {
  const r = await props.listModels().catch(() => null);
  if (r?.ok) models.value = r.models; // otherwise models are simply typed
}
const tryIt = () =>
  run(async () => {
    const r = await props.test();
    if (r.ok) note.value = `${form.model} answered.`;
    else error.value = r.error ?? "It didn't answer.";
  });
function changeProvider(): void {
  models.value = [];
  if (form.provider === 'anthropic' && !form.model) form.model = ANTHROPIC_MODEL;
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
      <div class="field">
        <label :for="`${id}-vision`">Vision model</label>
        <input :id="`${id}-vision`" v-model="form.visionModel" :list="`${id}-models`" autocomplete="off" :placeholder="form.model" />
        <p class="muted small">Reads bean labels from photos.</p>
      </div>
      <div class="field">
        <label :for="`${id}-web`">Web model</label>
        <input :id="`${id}-web`" v-model="form.webModel" :list="`${id}-models`" autocomplete="off" :placeholder="form.visionModel || form.model" />
        <p class="muted small">Looks beans up on the web.</p>
      </div>
      <datalist :id="`${id}-models`">
        <option v-for="m in models" :key="m" :value="m" />
      </datalist>
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
</style>

<script setup lang="ts">
// What was sent to the AI for an analysis or a suggestion
// (docs/api/analysis.md §8c): the prompt sections used, the system prompt,
// and the input, each top-level part of it folded. Loaded when opened.
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import type { AiRequest } from '../api/types';

const props = defineProps<{ open: boolean; load: () => Promise<AiRequest | null> }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);

const request = ref<AiRequest | null>(null);
const state = ref<'loading' | 'done' | 'none' | 'error'>('loading');
const error = ref('');
const copied = ref(false);

watch(
  () => props.open,
  async (open) => {
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
    if (!open) return;
    state.value = 'loading';
    copied.value = false;
    try {
      request.value = await props.load();
      state.value = request.value ? 'done' : 'none';
    } catch (err) {
      error.value = errorMessage(err);
      state.value = 'error';
    }
  },
  { flush: 'post' },
);

const parts = computed(() => Object.entries(request.value?.input ?? {}).map(([key, value]) => ({ key, json: JSON.stringify(value, null, 2) })));
const size = computed(() => {
  const r = request.value;
  if (!r) return '';
  const chars = r.system.length + JSON.stringify(r.input).length;
  return `about ${Math.round(chars / 4).toLocaleString()} tokens`; // ~4 characters a token
});

async function copy(): Promise<void> {
  if (!request.value) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(request.value, null, 2));
    copied.value = true;
  } catch {
    copied.value = false; // no clipboard (insecure origin, denied): nothing to do
  }
}
</script>

<template>
  <dialog ref="dialog" class="ai-request" aria-label="What was sent to the AI" @cancel.prevent="emit('close')">
    <h2>What was sent to the AI</h2>
    <p v-if="state === 'loading'" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="state === 'error'" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="state === 'none'" class="muted">Not saved for this one: it was made before the app kept what it sent, or it was restored from a backup without it.</p>
    <template v-else-if="request">
      <p class="muted small">{{ size }}, from {{ request.sections.length }} prompt sections.</p>
      <details>
        <summary>Instructions (system prompt)</summary>
        <p class="sections small">
          <span v-for="s in request.sections" :key="s" class="badge">{{ s }}</span>
        </p>
        <pre>{{ request.system }}</pre>
      </details>
      <h3>The brew details sent</h3>
      <details v-for="p in parts" :key="p.key">
        <summary><code>{{ p.key }}</code></summary>
        <pre>{{ p.json }}</pre>
      </details>
    </template>
    <div class="actions">
      <button v-if="request && state === 'done'" class="btn btn-secondary" type="button" @click="copy">{{ copied ? 'Copied' : 'Copy all' }}</button>
      <button class="btn btn-primary" type="button" @click="emit('close')">Close</button>
    </div>
  </dialog>
</template>

<style scoped>
.ai-request {
  width: min(720px, calc(100vw - 2 * var(--space-3)));
  max-height: calc(100dvh - 2 * var(--space-4));
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: var(--text);
}
.ai-request::backdrop {
  background: rgb(0 0 0 / 0.45);
}
h2 {
  font-size: 1.2rem;
  margin-bottom: var(--space-2);
}
h3 {
  font-size: 1rem;
  margin: var(--space-3) 0 var(--space-1);
}
details {
  border-top: 1px solid var(--border);
  padding: var(--space-2) 0;
}
summary {
  cursor: pointer;
  min-height: var(--tap);
  display: flex;
  align-items: center;
}
pre {
  margin: var(--space-2) 0 0;
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--brand-tint);
  font-size: 0.8rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sections {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: var(--space-1) 0 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
</style>

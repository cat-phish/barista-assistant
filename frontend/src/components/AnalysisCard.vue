<script setup lang="ts">
// An AI suggestion (docs/api/llm-contract.md §9): the next step first, then
// the diagnosis and the changes, and "Was this useful?" for who can analyze
// the brew (docs/api/analysis.md §8). Older analyses have no next step,
// confidence or RPM change and show what they have.
import { computed, ref, watch } from 'vue';
import { analysisApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { LlmAnalysis } from '../api/types';
import { GRIND_LABELS } from '../lib/suggest';
import { formatTempChange } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';

const props = defineProps<{ analysis: LlmAnalysis; canRate?: boolean }>();
const { temperatureUnit } = usePreferences();
const tempLabel = computed(() => formatTempChange(props.analysis.suggestedTempDelta, temperatureUnit.value));
const rpmLabel = computed(() => {
  const d = props.analysis.suggestedRpmDelta;
  if (!d) return null;
  return `${d > 0 ? 'Raise' : 'Lower'} the grinder speed by ${Math.abs(d)} RPM`;
});
const CONFIDENCE = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const;

const helpful = ref<boolean | null>(props.analysis.helpful);
watch(
  () => props.analysis,
  (a) => (helpful.value = a.helpful),
);
const saving = ref(false);
const error = ref('');
// Tapping the chosen answer again takes it back.
async function rate(value: boolean): Promise<void> {
  const next = helpful.value === value ? null : value;
  saving.value = true;
  error.value = '';
  try {
    helpful.value = (await analysisApi.rateAnalysis(props.analysis.brewLogId, props.analysis.id, next)).helpful;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="analysis" aria-live="polite">
    <p v-if="analysis.nextStep" class="next">
      <strong>Next time:</strong> {{ analysis.nextStep }}
      <span v-if="analysis.confidence" class="badge" :class="`conf-${analysis.confidence}`">{{ CONFIDENCE[analysis.confidence] }}</span>
    </p>
    <p class="reasoning">“{{ analysis.reasoning }}”</p>
    <ul>
      <li><strong>{{ GRIND_LABELS[analysis.suggestedGrindDelta] }}</strong></li>
      <li><strong>{{ tempLabel }}</strong></li>
      <li v-if="rpmLabel"><strong>{{ rpmLabel }}</strong></li>
    </ul>
    <div v-if="canRate" class="feedback" role="group" aria-label="Was this suggestion useful?">
      <span class="muted small">Was this useful?</span>
      <button class="vote" type="button" :aria-pressed="helpful === true" :disabled="saving" title="Useful" @click="rate(true)">👍</button>
      <button class="vote" type="button" :aria-pressed="helpful === false" :disabled="saving" title="Not useful" @click="rate(false)">👎</button>
      <span v-if="helpful !== null" class="muted small">Thanks.</span>
      <span v-if="error" class="form-error" role="alert">{{ error }}</span>
    </div>
  </div>
</template>

<style scoped>
.analysis {
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--brand-tint);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.next {
  margin: 0;
}
.next .badge {
  margin-left: var(--space-1);
  white-space: nowrap;
}
.conf-low {
  opacity: 0.75;
}
.reasoning {
  margin: 0;
  font-style: italic;
}
ul {
  margin: 0;
  padding-left: 1.2rem;
}
.feedback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.vote {
  min-width: var(--tap);
  min-height: var(--tap);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 1.1rem;
  cursor: pointer;
}
.vote[aria-pressed='true'] {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-tint);
}
</style>

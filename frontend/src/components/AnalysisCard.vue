<script setup lang="ts">
// An AI suggestion (docs/api/llm-contract.md §9): the next step first, then
// the diagnosis and the changes, and a small Feedback link for who can
// analyze the brew, with Learn about me on (docs/api/analysis.md §8,
// docs/api/auth.md §1d). Older analyses have no next step,
// confidence, RPM, dose or shot weight change and show what they have.
// "What was sent" shows the prompt and input it came from (§8c).
import { computed, ref, watch } from 'vue';
import { analysisApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { LlmAnalysis } from '../api/types';
import { CONFIDENCE_LABELS, GRIND_LABELS, gramsAdvice, rpmAdvice } from '../lib/suggest';
import { formatTempChange } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';
import AiRequestDialog from './AiRequestDialog.vue';
import FeedbackDialog, { type FeedbackPart } from './FeedbackDialog.vue';

const props = defineProps<{ analysis: LlmAnalysis; canRate?: boolean }>();
const { temperatureUnit, prefs } = usePreferences();
const tempLabel = computed(() => formatTempChange(props.analysis.suggestedTempDelta, temperatureUnit.value));
const rpmLabel = computed(() => rpmAdvice(props.analysis.suggestedRpmDelta));

const helpful = ref<boolean | null>(props.analysis.helpful);
const reason = ref(props.analysis.feedbackReason ?? '');
watch(
  () => props.analysis,
  (a) => {
    helpful.value = a.helpful;
    reason.value = a.feedbackReason ?? '';
  },
);
const showSent = ref(false);
const loadSent = async () => (await analysisApi.sent(props.analysis.brewLogId, props.analysis.id)).request;

const canGive = computed(() => props.canRate && prefs.value.learnAboutMe);
const feedbackOpen = ref(false);
const saving = ref(false);
const error = ref('');
const parts = computed((): FeedbackPart[] => [
  { key: 'analysis', label: 'This advice', vote: helpful.value === null ? null : helpful.value ? 'up' : 'down', reason: reason.value },
]);
async function saveFeedback([p]: FeedbackPart[]): Promise<void> {
  if (!p) return;
  saving.value = true;
  error.value = '';
  try {
    const res = await analysisApi.rateAnalysis(props.analysis.brewLogId, props.analysis.id, p.vote === null ? null : p.vote === 'up', p.reason.trim() || null);
    helpful.value = res.helpful;
    reason.value = res.feedbackReason ?? '';
    feedbackOpen.value = false;
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
      <span v-if="analysis.confidence" class="badge" :class="`conf-${analysis.confidence}`">{{ CONFIDENCE_LABELS[analysis.confidence] }}</span>
    </p>
    <p class="reasoning">“{{ analysis.reasoning }}”</p>
    <ul>
      <li><strong>{{ GRIND_LABELS[analysis.suggestedGrindDelta] }}</strong></li>
      <li><strong>{{ tempLabel }}</strong></li>
      <li v-if="rpmLabel"><strong>{{ rpmLabel }}</strong></li>
      <li v-if="gramsAdvice('Dose', analysis.suggestedDoseDelta)"><strong>{{ gramsAdvice('Dose', analysis.suggestedDoseDelta) }}</strong></li>
      <li v-if="gramsAdvice('Shot weight', analysis.suggestedYieldDelta)"><strong>{{ gramsAdvice('Shot weight', analysis.suggestedYieldDelta) }}</strong></li>
    </ul>
    <button v-if="canGive" class="btn-link small sent" type="button" @click="feedbackOpen = true">
      Feedback<template v-if="helpful !== null"> · {{ helpful ? '👍' : '👎' }}</template>
    </button>
    <FeedbackDialog :open="feedbackOpen" title="Feedback on this advice" :parts="parts" :saving="saving" :error="error" @close="feedbackOpen = false" @save="saveFeedback" />
    <button v-if="analysis.hasRequest" class="btn-link small sent" type="button" @click="showSent = true">What was sent to the AI</button>
    <AiRequestDialog :open="showSent" :load="loadSent" @close="showSent = false" />
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
.sent {
  align-self: flex-start;
}
</style>

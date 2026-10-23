<script setup lang="ts">
import { computed } from 'vue';
import type { LlmAnalysis } from '../api/types';
import { GRIND_LABELS } from '../lib/suggest';
import { formatTempChange } from '../lib/units';
import { usePreferences } from '../composables/usePreferences';

const props = defineProps<{ analysis: LlmAnalysis }>();
const { temperatureUnit } = usePreferences();
const tempLabel = computed(() => formatTempChange(props.analysis.suggestedTempDelta, temperatureUnit.value));
</script>

<template>
  <div class="analysis" aria-live="polite">
    <p class="reasoning">“{{ analysis.reasoning }}”</p>
    <ul>
      <li><strong>{{ GRIND_LABELS[analysis.suggestedGrindDelta] }}</strong></li>
      <li><strong>{{ tempLabel }}</strong></li>
    </ul>
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
.reasoning {
  margin: 0;
  font-style: italic;
}
ul {
  margin: 0;
  padding-left: 1.2rem;
}
</style>

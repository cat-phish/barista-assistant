<script setup lang="ts">
// Like or dislike a suggestion or one of its routes (docs/api/analysis.md
// §8b, "Feedback"), with a reason once voted. Tapping the chosen thumb again
// takes the vote back.
import { computed, ref, watch } from 'vue';
import { suggestionsApi } from '../api/brews';
import type { ParameterSuggestion, SuggestionVoteKind } from '../api/types';
import { errorMessage } from '../api/client';

const props = defineProps<{
  workspaceId: string;
  suggestion: ParameterSuggestion;
  route: number | null; // null: the whole suggestion
  what: string; // for screen readers: "this route", "the suggestion"
}>();
const emit = defineEmits<{ saved: [suggestion: ParameterSuggestion] }>();
const MAX = 300; // MAX_FEEDBACK_REASON

const current = computed(() => {
  const f = props.suggestion.feedback;
  return (props.route === null ? f?.suggestion : f?.routes[props.route]) ?? null;
});
const reason = ref(current.value?.reason ?? '');
watch(current, (c) => (reason.value = c?.reason ?? ''));
const saving = ref(false);
const error = ref('');
const reasonId = computed(() => `vote-reason-${props.suggestion.id}-${props.route ?? 'all'}`);

async function save(vote: SuggestionVoteKind | null, why: string | null): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    const { suggestion } = await suggestionsApi.vote(props.workspaceId, props.suggestion.id, { route: props.route, vote, reason: why });
    emit('saved', suggestion);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
function tap(vote: SuggestionVoteKind): void {
  if (current.value?.vote === vote) void save(null, null);
  else void save(vote, reason.value.trim() || null);
}
</script>

<template>
  <div class="vote">
    <button
      class="btn-link thumb"
      type="button"
      :aria-pressed="current?.vote === 'up'"
      :aria-label="`Good idea: ${what}`"
      :disabled="saving"
      @click="tap('up')"
    >
      👍
    </button>
    <button
      class="btn-link thumb"
      type="button"
      :aria-pressed="current?.vote === 'down'"
      :aria-label="`Not for me: ${what}`"
      :disabled="saving"
      @click="tap('down')"
    >
      👎
    </button>
    <form v-if="current" class="reason" @submit.prevent="save(current.vote, reason.trim() || null)">
      <label :for="reasonId" class="visually-hidden">Why</label>
      <input
        :id="reasonId"
        v-model="reason"
        type="text"
        :maxlength="MAX"
        :placeholder="current.vote === 'down' ? 'Why not? e.g. I never want cooler water' : 'Why? e.g. more water suits me'"
      />
      <button v-if="reason.trim() !== (current.reason ?? '')" class="btn btn-secondary" type="submit" :disabled="saving">Save</button>
    </form>
    <p v-if="error" class="form-error small" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.vote {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}
.thumb {
  min-width: var(--tap);
  min-height: var(--tap);
  font-size: 1.1rem;
  opacity: 0.45;
  filter: grayscale(1);
}
.thumb[aria-pressed='true'] {
  opacity: 1;
  filter: none;
}
.reason {
  display: flex;
  flex: 1 1 14rem;
  gap: var(--space-1);
}
.reason input {
  flex: 1;
  min-width: 0;
}
.vote .form-error {
  flex-basis: 100%;
  margin: 0;
}
</style>

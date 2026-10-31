<script setup lang="ts">
// "Write with AI" on a bean's Review (docs/api/analysis.md §8e): which brews to
// send, then the draft. Nothing reaches the form until Use, and nothing is
// saved until the bean is.
import { computed, ref, watch } from 'vue';
import { beansApi, type BeanBrewSummary } from '../api/beans';
import { errorMessage } from '../api/client';
import { MAX_REVIEW_BREWS } from '../api/types';
import { usePreferences } from '../composables/usePreferences';
import { reviewRequest, startingBrewers } from '../lib/beanReview';
import { ratingLabel } from '../lib/rating';
import { useWorkspaceStore } from '../stores/workspace';
import AiNoteField from './AiNoteField.vue';
import AiRequestDialog from './AiRequestDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{ open: boolean; beanId: string; summary: BeanBrewSummary; offerRating: boolean }>();
const emit = defineEmits<{ close: []; useReview: [text: string]; useRating: [rating: number] }>();

const workspaces = useWorkspaceStore();
const { aiHidden, settings } = usePreferences();
const ratedLocked = computed(() => aiHidden.value.includes('unratedHistory')); // kept from the AI

const maxBrews = ref(10);
const ratedOnly = ref(true);
const ticked = ref<string[]>([]);
const note = ref('');
const busy = ref(false);
const error = ref('');
const draft = ref<{ review: string; suggestedRating: number; brewCount: number } | null>(null);
const usedReview = ref(false);
const usedRating = ref(false);
const previewing = ref(false);
let asking = 0; // an answer after closing or asking again is dropped

watch(
  () => props.open,
  (open) => {
    asking++;
    busy.value = false;
    if (!open) return;
    maxBrews.value = settings.value.beanReviewMaxBrews;
    ratedOnly.value = settings.value.beanReviewRatedOnly || ratedLocked.value;
    ticked.value = startingBrewers(settings.value.beanReviewBrewers, props.summary.brewers);
    note.value = '';
    error.value = '';
    draft.value = null;
  },
);

const request = () => reviewRequest({ ticked: ticked.value, used: props.summary.brewers, maxBrews: maxBrews.value, ratedOnly: ratedOnly.value, note: note.value });
const canAsk = computed(() => !busy.value && (ticked.value.length > 0 || props.summary.brewers.length === 0));

async function write(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  const mine = ++asking;
  busy.value = true;
  error.value = '';
  try {
    const answer = await beansApi.reviewDraft(ws, props.beanId, request());
    if (mine !== asking) return;
    draft.value = answer;
    usedReview.value = false;
    usedRating.value = false;
  } catch (err) {
    if (mine === asking) error.value = errorMessage(err);
  } finally {
    if (mine === asking) busy.value = false;
  }
}
async function loadPreview() {
  const ws = workspaces.current?.id;
  return ws ? (await beansApi.reviewPreview(ws, props.beanId, request())).request : null;
}
function useReview(): void {
  if (!draft.value) return;
  emit('useReview', draft.value.review);
  usedReview.value = true;
}
function useRating(): void {
  if (!draft.value) return;
  emit('useRating', draft.value.suggestedRating);
  usedRating.value = true;
}
</script>

<template>
  <ConfirmDialog :open="open" title="Write the review with AI" @cancel="emit('close')">
    <div v-if="draft" class="stack">
      <p class="muted small">From {{ draft.brewCount }} {{ draft.brewCount === 1 ? 'brew' : 'brews' }}</p>
      <p class="draft">{{ draft.review }}</p>
      <p v-if="offerRating" class="small">Suggested rating: <strong>{{ ratingLabel(draft.suggestedRating) }}</strong></p>
    </div>
    <form v-else id="bean-review-choices" class="stack" novalidate @submit.prevent="write">
      <div class="field">
        <label for="review-brews">Up to</label>
        <select id="review-brews" v-model.number="maxBrews" :disabled="busy">
          <option v-for="n in MAX_REVIEW_BREWS" :key="n" :value="n">{{ n }} {{ n === 1 ? 'brew' : 'brews' }}</option>
        </select>
      </div>
      <fieldset v-if="summary.brewers.length > 1" class="brewers" :disabled="busy">
        <legend>Brewers</legend>
        <label v-for="b in summary.brewers" :key="b.id" class="checkbox">
          <input v-model="ticked" type="checkbox" :value="b.id" />
          {{ b.name }} <span class="muted small">{{ b.brewCount }}</span>
        </label>
      </fieldset>
      <label class="checkbox">
        <input v-model="ratedOnly" type="checkbox" :disabled="busy || ratedLocked" />
        Rated brews only
      </label>
      <AiNoteField id="review-note" v-model="note" />
      <button class="btn-link small preview-link" type="button" @click="previewing = true">Preview what's sent</button>
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template #actions>
      <template v-if="draft">
        <button class="btn btn-primary" type="button" :disabled="usedReview" @click="useReview">{{ usedReview ? 'Review filled in' : 'Use this review' }}</button>
        <button v-if="offerRating" class="btn btn-secondary" type="button" :disabled="usedRating" @click="useRating">{{ usedRating ? 'Rating set' : 'Use this rating' }}</button>
        <button class="btn btn-secondary" type="button" @click="draft = null">Change and try again</button>
        <button class="btn btn-secondary" type="button" @click="emit('close')">Done</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" type="submit" form="bean-review-choices" :disabled="!canAsk">{{ busy ? 'Writing…' : 'Write review' }}</button>
        <button class="btn btn-secondary" type="button" @click="emit('close')">Cancel</button>
      </template>
    </template>
  </ConfirmDialog>
  <AiRequestDialog :open="previewing" :load="loadPreview" preview @close="previewing = false" />
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.draft {
  white-space: pre-line;
}
.brewers {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.preview-link {
  align-self: flex-start;
}
</style>

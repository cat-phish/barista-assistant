<script setup lang="ts">
// Feedback on AI advice (docs/api/analysis.md §8 and §8b "Feedback"): a 👍 or
// 👎 and a reason for each part (an analysis, a suggestion and its routes),
// opened from a small Feedback link so it stays out of the way. Only offered
// with Learn about me on (docs/api/auth.md §1d): a 👎 teaches the AI at once.
import { ref, watch } from 'vue';

export interface FeedbackPart {
  key: string;
  label: string;
  vote: 'up' | 'down' | null;
  reason: string;
}
const props = defineProps<{ open: boolean; title: string; parts: FeedbackPart[]; saving: boolean; error: string }>();
const emit = defineEmits<{ close: []; save: [parts: FeedbackPart[]] }>();
const MAX = 300; // MAX_FEEDBACK_REASON

const dialog = ref<HTMLDialogElement | null>(null);
const drafts = ref<FeedbackPart[]>([]);
watch(
  () => props.open,
  (open) => {
    if (open) drafts.value = props.parts.map((p) => ({ ...p }));
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
  },
  { flush: 'post' },
);

const QUICK = {
  down: ["Not a change I'd make", 'Too big a change', "Didn't help the taste", 'Wrong read of the brew'],
  up: ['Tasted better', 'Simple and clear'],
} as const;
function tap(p: FeedbackPart, vote: 'up' | 'down'): void {
  p.vote = p.vote === vote ? null : vote;
  if (p.vote === null) p.reason = '';
}
function quick(p: FeedbackPart, text: string): void {
  const now = p.reason.trim();
  p.reason = (now ? `${now}; ${text}` : text).slice(0, MAX);
}
const changed = () => drafts.value.some((d, i) => d.vote !== props.parts[i]?.vote || d.reason.trim() !== props.parts[i]?.reason);
</script>

<template>
  <dialog ref="dialog" class="feedback-dialog" :aria-label="title" @cancel.prevent="emit('close')">
    <h2>{{ title }}</h2>
    <div v-for="p in drafts" :key="p.key" class="part">
      <div class="head">
        <span class="small"><strong>{{ p.label }}</strong></span>
        <span class="thumbs" role="group" :aria-label="`Feedback on ${p.label}`">
          <button class="btn-link thumb" type="button" :aria-pressed="p.vote === 'up'" :aria-label="`Good: ${p.label}`" @click="tap(p, 'up')">👍</button>
          <button class="btn-link thumb" type="button" :aria-pressed="p.vote === 'down'" :aria-label="`Not for me: ${p.label}`" @click="tap(p, 'down')">👎</button>
        </span>
      </div>
      <template v-if="p.vote">
        <label :for="`fb-${p.key}`" class="visually-hidden">Why</label>
        <input
          :id="`fb-${p.key}`"
          v-model="p.reason"
          type="text"
          :maxlength="MAX"
          :placeholder="p.vote === 'down' ? 'Why not? e.g. I never want cooler water' : 'Why? e.g. more water suits me'"
        />
        <div class="quick">
          <button v-for="q in QUICK[p.vote]" :key="q" class="chip small" type="button" @click="quick(p, q)">{{ q }}</button>
        </div>
      </template>
    </div>
    <p class="muted small">A 👎 teaches the AI right away, so it stops suggesting that. See and edit what it learned in Settings → Learned preferences.</p>
    <p v-if="error" class="form-error small" role="alert">{{ error }}</p>
    <div class="actions">
      <button class="btn btn-primary" type="button" :disabled="saving || !changed()" @click="emit('save', drafts)">{{ saving ? 'Saving…' : 'Save' }}</button>
      <button class="btn btn-secondary" type="button" :disabled="saving" @click="emit('close')">Close</button>
    </div>
  </dialog>
</template>

<style scoped>
.feedback-dialog {
  width: min(480px, calc(100vw - 2 * var(--space-3)));
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: var(--text);
}
.feedback-dialog::backdrop {
  background: rgb(0 0 0 / 0.45);
}
h2 {
  font-size: 1.2rem;
  margin: 0 0 var(--space-3);
}
p {
  margin: var(--space-2) 0 0;
}
.part {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
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
.part input {
  width: 100%;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: none;
  color: var(--text);
  padding: 2px var(--space-2);
  cursor: pointer;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>

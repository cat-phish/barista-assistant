<script setup lang="ts">
// A chat reply's proposal (docs/api/chat.md §12, "Proposals"): what it would
// set, with Open (fills in the brew page or recipe form, nothing saved until
// you save there) and Dismiss. A dismissed one folds to a line, with Undo.
// Recipe steps that fail the step checks are flagged, not hidden.
import { computed } from 'vue';
import type { ChatProposal } from '../api/chats';
import { usePreferences } from '../composables/usePreferences';
import { PROPOSAL_KIND_LABELS, proposalLines } from '../lib/chatProposal';

const props = defineProps<{ proposal: ChatProposal; canOpen: boolean; busy: boolean }>();
const emit = defineEmits<{ open: []; state: [state: ChatProposal['state']] }>();
const { temperatureUnit } = usePreferences();
const lines = computed(() => proposalLines(props.proposal, temperatureUnit.value));
const warnings = computed(() => (props.proposal.kind === 'brew' ? [] : (props.proposal.warnings ?? [])));
const openLabel = computed(() => (props.proposal.kind === 'brew' ? 'Open on brew page' : props.proposal.kind === 'recipeChange' ? 'Open recipe' : 'Open as new recipe'));
</script>

<template>
  <p v-if="proposal.state === 'dismissed'" class="dismissed muted small">
    Dismissed: {{ proposal.title }}
    <button type="button" class="btn-link" :disabled="busy" @click="emit('state', 'open')">Undo</button>
  </p>
  <article v-else class="proposal" :aria-label="`${PROPOSAL_KIND_LABELS[proposal.kind]}: ${proposal.title}`">
    <p class="kind">{{ PROPOSAL_KIND_LABELS[proposal.kind] }}</p>
    <h4>{{ proposal.title }}</h4>
    <p class="why">{{ proposal.why }}</p>
    <ul v-if="lines.length" class="values">
      <li v-for="l in lines" :key="l">{{ l }}</li>
    </ul>
    <div v-if="warnings.length" class="warnings small" role="note">
      <p>Check the steps before saving:</p>
      <ul>
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
    </div>
    <div class="actions">
      <button v-if="canOpen" type="button" class="btn btn-secondary" @click="emit('open')">{{ openLabel }}</button>
      <button type="button" class="btn-link" :disabled="busy" @click="emit('state', 'dismissed')">Dismiss</button>
    </div>
    <p v-if="canOpen" class="muted small">Opens it filled in. Nothing changes until you save.</p>
  </article>
</template>

<style scoped>
.proposal {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--brand-line);
  border-left: 3px solid var(--brand);
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.kind {
  margin: 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
h4 {
  margin: var(--space-1) 0;
}
.why {
  margin: 0 0 var(--space-2);
}
.values {
  margin: 0 0 var(--space-3);
  padding-left: 1.1rem;
}
.warnings {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  color: var(--warning);
  background: var(--warning-tint);
}
.warnings p {
  margin: 0;
  font-weight: 600;
}
.warnings ul {
  margin: var(--space-1) 0 0;
  padding-left: 1.1rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.actions + .small {
  margin: var(--space-2) 0 0;
}
.dismissed {
  margin: var(--space-2) 0 0;
}
</style>

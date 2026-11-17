<script setup lang="ts">
// Who a brew is for (docs/api/brew-logs.md §6, "Who it's for"; backlog 67):
// off, it's yours alone; on, you and/or the workspace's guests (Settings →
// Guests, §2d) and unnamed ones. Its volume and caffeine split among them.
import { computed } from 'vue';
import type { Guest } from '../api/types';
import type { BrewDraft } from '../lib/brewDraft';

const draft = defineModel<BrewDraft>({ required: true });
const props = defineProps<{
  guests: Guest[]; // the workspace's
  error?: string; // shown once the form was submitted
}>();

// Active guests, plus archived ones this brew already names.
const options = computed(() => props.guests.filter((g) => !g.archivedAt || draft.value.guestIds.includes(g.id)));

const unnamed = computed({
  get: () => String(draft.value.unnamedGuests),
  set: (v: string) => {
    const n = Math.trunc(Number(v));
    draft.value.unnamedGuests = Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 0;
  },
});
</script>

<template>
  <div class="stack for-who">
    <label class="checkbox">
      <input v-model="draft.forGuests" type="checkbox" />
      For a guest
    </label>
    <fieldset v-if="draft.forGuests" class="who">
      <legend>Who drank it</legend>
      <div class="who-list">
        <label class="checkbox">
          <input v-model="draft.forMe" type="checkbox" />
          Me
        </label>
        <label v-for="g in options" :key="g.id" class="checkbox">
          <input v-model="draft.guestIds" type="checkbox" :value="g.id" />
          {{ g.name }}{{ g.archivedAt ? ' (archived)' : '' }}
        </label>
      </div>
      <div class="field unnamed">
        <label for="brew-unnamed-guests">Other guests</label>
        <input id="brew-unnamed-guests" v-model="unnamed" type="number" inputmode="numeric" min="0" max="50" step="1" />
      </div>
      <span v-if="error" class="field-error" role="alert">{{ error }}</span>
      <span class="hint">
        Its volume and caffeine are shared equally among them.
        <RouterLink :to="{ name: 'settings-guests' }">{{ guests.length ? 'Manage guests' : 'Add guests by name' }}</RouterLink>
      </span>
    </fieldset>
  </div>
</template>

<style scoped>
.who {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.who-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
}
.unnamed input {
  max-width: 6rem;
}
</style>

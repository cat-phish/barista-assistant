<script setup lang="ts">
// How a yield was weighed, beside its box in BrewFields: directly, or in a
// vessel whose weight is subtracted (docs/api/brew-logs.md §6).
import { computed } from 'vue';
import type { Vessel } from '../api/types';
import { setVessel, type BrewDraft } from '../lib/brewDraft';
import { formatGrams } from '../lib/format';

const draft = defineModel<BrewDraft>({ required: true });
const props = defineProps<{ vessels: Vessel[] }>();

// Active vessels, plus the brew's own even if it's since been archived, at
// the weight the brew saved.
const options = computed(() =>
  props.vessels
    .filter((v) => !v.archivedAt || v.id === draft.value.vesselId)
    .map((v) => ({ id: v.id, label: `${v.name} (${formatGrams(v.id === draft.value.vesselId ? (draft.value.vesselGrams ?? v.weightGrams) : v.weightGrams)} g)` })),
);
function pick(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  setVessel(draft.value, props.vessels.find((v) => v.id === id) ?? null);
}
</script>

<template>
  <div class="field">
    <label for="brew-vessel">Weighed</label>
    <select id="brew-vessel" :value="draft.vesselId" @change="pick">
      <option value="">Directly</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
    </select>
  </div>
</template>

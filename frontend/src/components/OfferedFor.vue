<script setup lang="ts">
// "Offered for" on the prep item and brew problem editors
// (docs/api/prep-tools.md §3d, docs/api/brew-problems.md §6b): every brew,
// or chosen methods and brewers. The form sends [] for both when everyBrew
// is set (lib/prepTools.ts offeredFor).
import { computed } from 'vue';
import type { Brewer, MethodKind } from '../api/types';
import { METHOD_KINDS, METHOD_ORDER } from '../lib/equipment';
import { offeredError } from '../lib/prepTools';

const props = defineProps<{
  brewers: Brewer[];
  hint: string; // where it shows, under the heading
  submitted: boolean; // show the error only after a save was tried
}>();
const everyBrew = defineModel<boolean>('everyBrew', { required: true });
const methodKinds = defineModel<MethodKind[]>('methodKinds', { required: true });
const brewerIds = defineModel<string[]>('brewerIds', { required: true });

// Brewers by method, active ones plus any archived one already chosen.
const brewerGroups = computed(() =>
  METHOD_ORDER.map((kind) => ({
    kind,
    brewers: props.brewers.filter((b) => b.kind === kind && (!b.archivedAt || brewerIds.value.includes(b.id))),
  })).filter((g) => g.brewers.length),
);
const error = computed(() => offeredError(everyBrew.value, methodKinds.value, brewerIds.value));
</script>

<template>
  <section class="card stack" aria-labelledby="offered-title">
    <h2 id="offered-title">Offered for</h2>
    <p class="muted small">{{ hint }}</p>
    <fieldset class="choices">
      <legend class="visually-hidden">Offered for</legend>
      <label class="checkbox"><input v-model="everyBrew" type="radio" :value="true" name="offered" /> Every brew</label>
      <label class="checkbox"><input v-model="everyBrew" type="radio" :value="false" name="offered" /> Only some methods or brewers</label>
    </fieldset>
    <template v-if="!everyBrew">
      <fieldset class="choices">
        <legend>Methods</legend>
        <p class="muted small">Every brewer of the method.</p>
        <label v-for="k in METHOD_ORDER" :key="k" class="checkbox">
          <input v-model="methodKinds" type="checkbox" :value="k" />
          {{ METHOD_KINDS[k].label }}
        </label>
      </fieldset>
      <fieldset class="choices">
        <legend>Brewers</legend>
        <p class="muted small">Just these, on top of the methods above.</p>
        <div v-for="g in brewerGroups" :key="g.kind" class="group">
          <p class="group-name muted">{{ METHOD_KINDS[g.kind].label }}</p>
          <p v-if="methodKinds.includes(g.kind)" class="muted small">Already offered for all of these.</p>
          <label v-for="b in g.brewers" :key="b.id" class="checkbox">
            <input v-model="brewerIds" type="checkbox" :value="b.id" />
            {{ b.name }}<template v-if="b.archivedAt"> (archived)</template>
          </label>
        </div>
        <p v-if="!brewerGroups.length" class="muted small">No brewers yet.</p>
      </fieldset>
      <p v-if="submitted && error" class="field-error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
  margin: 0;
}
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.choices {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.choices legend {
  font-weight: 600;
  margin-bottom: var(--space-1);
}
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.group-name {
  font-size: 0.9rem;
  margin-top: var(--space-1);
}
</style>

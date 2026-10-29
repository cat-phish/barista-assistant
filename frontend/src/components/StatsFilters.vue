<script setup lang="ts">
// The Stats filter bar: one row above the charts, wrapping on a phone.
import { computed } from 'vue';
import type { VolumeUnit } from '../api/types';
import { GROUPINGS, RANGES, useStats, type Grouping, type RangeKey } from '../composables/useStats';
import { beanLabel } from '../lib/beans';
import { VOLUME_LABELS } from '../lib/units';

const stats = useStats();
const f = computed(() => stats.filters.value);
const lookups = computed(() => stats.data.value?.lookups);
const byName = <T extends { name: string }>(list: readonly T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
const beanOptions = computed(() => [...stats.beans.value].map((b) => ({ id: b.id, label: beanLabel(b) })).sort((a, b) => a.label.localeCompare(b.label)));

const value = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
</script>

<template>
  <div class="filters" role="group" aria-label="Filters">
    <div class="field">
      <label for="stats-range">Period</label>
      <select id="stats-range" :value="f.range" @change="stats.setFilters({ range: value($event) as RangeKey })">
        <option v-for="(label, key) in RANGES" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <template v-if="f.range === 'custom'">
      <div class="field">
        <label for="stats-from">From</label>
        <input id="stats-from" type="date" :value="f.from" @change="stats.setFilters({ from: value($event) })" />
      </div>
      <div class="field">
        <label for="stats-to">To</label>
        <input id="stats-to" type="date" :value="f.to" @change="stats.setFilters({ to: value($event) })" />
      </div>
    </template>
    <div class="field">
      <label for="stats-bean">Bean</label>
      <select id="stats-bean" :value="f.bean" @change="stats.setFilters({ bean: value($event) })">
        <option value="">All beans</option>
        <option v-for="b in beanOptions" :key="b.id" :value="b.id">{{ b.label }}</option>
      </select>
    </div>
    <div class="field">
      <label for="stats-recipe">Recipe</label>
      <select id="stats-recipe" :value="f.recipe" @change="stats.setFilters({ recipe: value($event) })">
        <option value="">All recipes</option>
        <option v-for="r in byName(lookups?.recipes ?? [])" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
    </div>
    <div class="field">
      <label for="stats-brewer">Brewer</label>
      <select id="stats-brewer" :value="f.brewer" @change="stats.setFilters({ brewer: value($event) })">
        <option value="">All brewers</option>
        <option v-for="b in byName(lookups?.brewers ?? [])" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
    </div>
    <div class="field">
      <label for="stats-by">Group by</label>
      <select id="stats-by" :value="f.by" @change="stats.setFilters({ by: value($event) as Grouping })">
        <option v-for="(label, key) in GROUPINGS" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <div class="field">
      <label for="stats-unit">Volume</label>
      <select id="stats-unit" :value="f.unit" @change="stats.setFilters({ unit: value($event) as VolumeUnit })">
        <option v-for="(label, key) in VOLUME_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <label class="checkbox mine">
      <input type="checkbox" :checked="f.mine" @change="stats.setFilters({ mine: ($event.target as HTMLInputElement).checked })" />
      Only mine
    </label>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2) var(--space-3);
  align-items: end;
}
.field {
  min-width: 0;
}
.field select,
.field input {
  width: 100%;
}
.mine {
  align-self: end;
}
</style>

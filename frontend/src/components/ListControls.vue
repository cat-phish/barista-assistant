<script setup lang="ts">
// The filter and sort selects above a list table (Recipes, Drinks, Brewers,
// Grinders). Sort options come from lib/listSort.ts sortOptions.
type Option = { value: string; label: string };
const filter = defineModel<string>('filter', { required: true });
const sort = defineModel<string>('sort', { required: true });
defineProps<{ idPrefix: string; filterLabel: string; filterOptions: Option[]; sortOptions: Option[] }>();
</script>

<template>
  <div class="controls">
    <div class="field">
      <label :for="`${idPrefix}-filter`">{{ filterLabel }}</label>
      <select :id="`${idPrefix}-filter`" v-model="filter">
        <option v-for="o in filterOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
    </div>
    <div class="field">
      <label :for="`${idPrefix}-sort`">Sort</label>
      <select :id="`${idPrefix}-sort`" v-model="sort">
        <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
</style>

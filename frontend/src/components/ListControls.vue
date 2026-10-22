<script setup lang="ts">
// The filter, Sort by and Order selects above a list table (Beans, Recipes,
// Drinks, Ingredients, Brewers, Grinders). The sort stays one key,
// "<column>_<asc|desc>" (lib/listSort.ts), shared with the column headers;
// columns come from sortColumnOptions.
import { computed } from 'vue';
import { parseSortKey, type SortColumnOption, type SortDir } from '../lib/listSort';

type Option = { value: string; label: string };
const filter = defineModel<string>('filter', { required: true });
const sort = defineModel<string>('sort', { required: true });
const props = defineProps<{ idPrefix: string; filterLabel: string; filterOptions: Option[]; sortColumns: SortColumnOption[] }>();

const parsed = computed(() => parseSortKey(sort.value));
// Changing the column keeps the chosen order.
const column = computed({
  get: () => parsed.value?.column ?? props.sortColumns[0]?.value ?? '',
  set: (c: string) => (sort.value = `${c}_${direction.value}`),
});
const direction = computed<SortDir>({
  get: () => parsed.value?.dir ?? 'asc',
  set: (d) => (sort.value = `${column.value}_${d}`),
});
const current = computed(() => props.sortColumns.find((c) => c.value === column.value));
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
      <label :for="`${idPrefix}-sort`">Sort by</label>
      <select :id="`${idPrefix}-sort`" v-model="column">
        <option v-for="c in sortColumns" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
    </div>
    <div class="field">
      <label :for="`${idPrefix}-order`">Order</label>
      <select :id="`${idPrefix}-order`" v-model="direction">
        <option value="asc">{{ current?.asc ?? 'Ascending' }}</option>
        <option value="desc">{{ current?.desc ?? 'Descending' }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
/* Phones: the filter on its own row, Sort by and Order side by side. */
@media (max-width: 480px) {
  .controls {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .controls > :first-child {
    grid-column: 1 / -1;
  }
}
</style>

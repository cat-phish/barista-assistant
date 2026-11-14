<script setup lang="ts">
// Batch add's "Carry over" box (docs/api/beans.md §4, "Frontend (batch
// add)"): ticked, Next batch keeps this field for the next bean. Sits on
// its field's label row, or its card's heading row.
import { computed } from 'vue';
import { CARRY, type BeanCarryKey } from '../lib/beanCarry';

const carry = defineModel<BeanCarryKey[]>({ required: true });
const props = defineProps<{ item: BeanCarryKey }>();

const on = computed({
  get: () => carry.value.includes(props.item),
  set: (value: boolean) => {
    carry.value = value ? [...carry.value, props.item] : carry.value.filter((k) => k !== props.item);
  },
});
</script>

<template>
  <label class="carry-toggle">
    <input v-model="on" type="checkbox" :aria-label="`Carry over ${CARRY[item].label} to the next batch`" />
    <span aria-hidden="true">Carry over</span>
  </label>
</template>

<style scoped>
/* A small control on its field's label row (BeanFormView lays the row out). */
.carry-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
  font-size: 0.8rem;
  font-weight: normal;
  color: var(--text-muted);
  cursor: pointer;
}
/* Not a text box: undo .field input's width, height, padding and border. */
.carry-toggle input {
  flex: none;
  width: 1rem;
  height: 1rem;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  accent-color: var(--brand);
}
</style>

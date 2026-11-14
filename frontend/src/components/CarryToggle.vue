<script setup lang="ts">
// Batch add's "Carry over" box (docs/api/beans.md §4, "Frontend (batch
// add)"): ticked, Next batch keeps this field for the next bean. Sits in
// the top right of its field or card (the parent is position: relative).
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
.carry-toggle {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 0.8rem;
  font-weight: normal;
  color: var(--text-muted);
  cursor: pointer;
}
.carry-toggle input {
  margin: 0;
}
</style>

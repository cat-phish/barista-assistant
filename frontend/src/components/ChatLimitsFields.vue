<script setup lang="ts">
// The two limits on AI chats, size and age (docs/api/chat.md §12), each
// switchable to "no limit". Used for a person and for the server.
import { ref, watch } from 'vue';
import type { ChatLimits } from '../api/chats';
import { fromBytes, SIZE_UNITS, toBytes, type SizeUnit } from '../lib/chatSize';

const props = defineProps<{ limits: ChatLimits; idPrefix: string; noLimitText: string }>();
const emit = defineEmits<{ change: [limits: ChatLimits | null] }>();

const sized = ref(false);
const size = ref(1);
const unit = ref<SizeUnit>('GB');
const aged = ref(false);
const days = ref(90);

watch(
  () => props.limits,
  (limits) => {
    sized.value = limits.maxBytes !== null;
    if (limits.maxBytes !== null) ({ value: size.value, unit: unit.value } = fromBytes(limits.maxBytes));
    aged.value = limits.maxDays !== null;
    if (limits.maxDays !== null) days.value = limits.maxDays;
  },
  { immediate: true },
);

// null while what's typed can't be saved.
function report(): void {
  const okSize = !sized.value || (Number.isFinite(size.value) && size.value > 0);
  const okDays = !aged.value || (Number.isInteger(days.value) && days.value >= 1);
  emit('change', okSize && okDays ? { maxBytes: sized.value ? toBytes(size.value, unit.value) : null, maxDays: aged.value ? days.value : null } : null);
}
watch([sized, size, unit, aged, days], report);
</script>

<template>
  <fieldset class="limit">
    <legend>Size on disk</legend>
    <label class="checkbox"><input v-model="sized" type="checkbox" /> Limit the size</label>
    <div v-if="sized" class="row">
      <label class="visually-hidden" :for="`${idPrefix}-size`">Largest size</label>
      <input :id="`${idPrefix}-size`" v-model.number="size" type="number" min="0.01" step="any" inputmode="decimal" />
      <label class="visually-hidden" :for="`${idPrefix}-unit`">Unit</label>
      <select :id="`${idPrefix}-unit`" v-model="unit">
        <option v-for="u in SIZE_UNITS" :key="u" :value="u">{{ u }}</option>
      </select>
    </div>
    <p v-else class="muted small">{{ noLimitText }}</p>
  </fieldset>
  <fieldset class="limit">
    <legend>Time kept</legend>
    <label class="checkbox"><input v-model="aged" type="checkbox" /> Delete chats after a while</label>
    <div v-if="aged" class="row">
      <label :for="`${idPrefix}-days`">Days since the last message</label>
      <input :id="`${idPrefix}-days`" v-model.number="days" type="number" min="1" max="36500" step="1" inputmode="numeric" />
    </div>
    <p v-else class="muted small">{{ noLimitText }}</p>
  </fieldset>
</template>

<style scoped>
.limit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: none;
}
legend {
  padding: 0;
  font-weight: 600;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.row input {
  width: 110px;
}
.small {
  margin: 0;
  font-size: 0.9rem;
}
</style>

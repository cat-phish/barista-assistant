<script setup lang="ts">
// An over-time chart's own period, under its title: the page's Period until
// changed (docs/roadmap.md, "Insights"). Custom starts from the dates shown.
import { computed } from 'vue';
import type { ChartView } from '../../composables/useStats';
import { RANGES, type RangeKey } from '../../lib/statsRange';

const props = defineProps<{ view: ChartView; label: string }>();

const p = computed(() => props.view.period.value);
const PAGE = '';

function pick(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  if (v === PAGE) return props.view.setPeriod(null);
  if (v !== 'custom') return props.view.setPeriod({ range: v as RangeKey, from: '', to: '' });
  const { from, to } = props.view.axis.value;
  props.view.setPeriod({ range: 'custom', from, to });
}
const setDay = (side: 'from' | 'to', e: Event) => props.view.setPeriod({ ...p.value!, [side]: (e.target as HTMLInputElement).value });
</script>

<template>
  <div class="period">
    <select :value="p?.range ?? PAGE" :aria-label="`${label}: period`" @change="pick">
      <option :value="PAGE">Page period</option>
      <option v-for="(text, key) in RANGES" :key="key" :value="key">{{ text }}</option>
    </select>
    <template v-if="p?.range === 'custom'">
      <input type="date" :value="p.from" :aria-label="`${label}: from`" @change="setDay('from', $event)" />
      <input type="date" :value="p.to" :aria-label="`${label}: to`" @change="setDay('to', $event)" />
    </template>
  </div>
</template>

<style scoped>
.period {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
}
.period select,
.period input {
  font-size: 0.85rem;
  min-width: 0;
  flex: 0 1 auto;
}
</style>

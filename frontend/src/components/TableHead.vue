<script setup lang="ts">
// A list table's header row for the columns on screen (lib/tableColumns.ts):
// a sort button for each column (every column sorts; useTableColumns makes
// sure of it), and the resize handles (ColumnResizers) over it.
import ColumnResizers from './ColumnResizers.vue';
import { sortArrow, sortLabel, toggleHeader } from '../lib/listSort';
import type { TableColumnsState } from '../lib/tableColumns';

defineProps<{ state: TableColumnsState }>();
const sort = defineModel<string>('sort', { required: true });
</script>

<template>
  <div class="data-row data-head">
    <ColumnResizers :state="state.widths" :labels="state.shown.map((c) => c.title ?? c.label)" />
    <template v-for="c in state.shown" :key="c.id">
      <button
        class="data-th"
        :class="[c.class, { end: state.isEnd(c) }]"
        type="button"
        :title="c.title"
        :aria-label="sortLabel(sort, c.id, c.title ?? c.label)"
        @click="sort = toggleHeader(sort, c.id, state.sortColumns)"
      >
        {{ c.header ?? c.label }} <span aria-hidden="true">{{ sortArrow(sort, c.id) }}</span>
      </button>
    </template>
  </div>
</template>

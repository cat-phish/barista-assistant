<script setup lang="ts" generic="T">
// A list table's header row for the columns on screen (lib/tableColumns.ts):
// a sort button for each sortable column, plain text for the rest, and the
// resize handles (ColumnResizers) over it.
import ColumnResizers from './ColumnResizers.vue';
import { sortArrow, sortLabel, toggleHeader, type SortColumns } from '../lib/listSort';
import type { TableColumnsState } from '../lib/tableColumns';

const props = defineProps<{ state: TableColumnsState; sortColumns: SortColumns<T> }>();
const sort = defineModel<string>('sort', { required: true });
const sortable = (id: string) => id in props.sortColumns;
</script>

<template>
  <div class="data-row data-head">
    <ColumnResizers :state="state.widths" :labels="state.shown.map((c) => c.title ?? c.label)" />
    <template v-for="c in state.shown" :key="c.id">
      <button
        v-if="sortable(c.id)"
        class="data-th"
        :class="[c.class, { end: state.isEnd(c) }]"
        type="button"
        :title="c.title"
        :aria-label="sortLabel(sort, c.id, c.title ?? c.label)"
        @click="sort = toggleHeader(sort, c.id, sortColumns)"
      >
        {{ c.header ?? c.label }} <span aria-hidden="true">{{ sortArrow(sort, c.id) }}</span>
      </button>
      <span v-else class="data-th" :class="[c.class, { end: state.isEnd(c) }]" :title="c.title">{{ c.header ?? c.label }}</span>
    </template>
  </div>
</template>

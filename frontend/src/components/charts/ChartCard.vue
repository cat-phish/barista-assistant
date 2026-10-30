<script setup lang="ts">
// A chart's card on the Insights page: title, the chart, and the same numbers as
// a table (some series colours are light on a white card, so the figures are
// always one tap away). Empty: says so instead of drawing nothing. An over-time
// chart puts its own period picker in the `period` slot, shown even when empty.
// With `kind` (v-model), a bar chart can be drawn as a line instead.
import { ref } from 'vue';
import type { SwitchableKind } from '../../lib/chartKind';

const kind = defineModel<SwitchableKind>('kind');
defineProps<{
  title: string;
  note?: string; // a line under the title: what's counted
  empty?: boolean;
  emptyText?: string;
  table?: { head: string[]; rows: Array<Array<string | number>> };
}>();

const asTable = ref(false);
</script>

<template>
  <section class="card chart-card">
    <header>
      <div>
        <h2>{{ title }}</h2>
        <p v-if="note" class="muted note">{{ note }}</p>
      </div>
      <div v-if="!empty" class="actions">
        <button v-if="kind && !asTable" type="button" class="btn-link" :aria-label="`Show ${title} as a ${kind === 'bar' ? 'line' : 'bar'} chart`" @click="kind = kind === 'bar' ? 'line' : 'bar'">
          {{ kind === 'bar' ? 'Line' : 'Bars' }}
        </button>
        <button v-if="table" type="button" class="btn-link" :aria-pressed="asTable" @click="asTable = !asTable">
          {{ asTable ? 'Chart' : 'Table' }}
        </button>
      </div>
    </header>
    <slot name="period" />
    <p v-if="empty" class="muted empty-text">{{ emptyText ?? 'Not enough brews yet.' }}</p>
    <div v-else-if="asTable && table" class="table-wrap">
      <table>
        <thead>
          <tr><th v-for="h in table.head" :key="h" scope="col">{{ h }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in table.rows" :key="i">
            <td v-for="(cell, j) in row" :key="j" :class="{ num: j > 0 }">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <slot v-else />
  </section>
</template>

<style scoped>
.chart-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  min-width: 0;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
h2 {
  font-size: 1rem;
  margin: 0;
}
.note {
  margin: 0;
  font-size: 0.85rem;
}
header .actions {
  display: flex;
  margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) 0 0;
  flex: none;
}
.empty-text {
  margin: 0;
  padding: var(--space-4) 0;
  text-align: center;
}
.table-wrap {
  max-height: 320px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th {
  text-align: left;
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--surface);
}
th,
td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
}
td.num,
th:not(:first-child) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>

<script setup lang="ts">
// Column resize handles for a list table (.data-table). It sits over the
// header row as a grid on the same --cols, so each handle lands on its
// column's right edge without touching the header buttons. Drag to resize,
// double-click to fit the widest cell, arrow keys for small steps. The last
// column keeps its width (it's the table's edge). Desktop only: the header
// row is hidden on phones, and these with it.
import { ref } from 'vue';
import type { ColumnWidthsState } from '../lib/columnWidths';
import { clampWidth } from '../lib/columnWidths';

const props = defineProps<{ state: ColumnWidthsState; labels: readonly string[] }>();

const cells = ref<HTMLElement[]>([]);
const measured = ref<number[]>([]);
const dragging = ref<number | null>(null);
let startX = 0;
let startWidth = 0;
let moved = false;

const widthOf = (i: number): number => cells.value[i]?.getBoundingClientRect().width ?? 0;
function measure(i: number): void {
  const next = [...measured.value];
  next[i] = Math.round(widthOf(i));
  measured.value = next;
}
const shownWidth = (i: number): number => props.state.widths[i] ?? measured.value[i] ?? 0;

function onPointerDown(i: number, e: PointerEvent): void {
  if (e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragging.value = i;
  startX = e.clientX;
  startWidth = widthOf(i);
  moved = false;
}
function onPointerMove(i: number, e: PointerEvent): void {
  if (dragging.value !== i) return;
  const dx = e.clientX - startX;
  if (!moved && Math.abs(dx) < 3) return; // a click or double-click, not a drag
  moved = true;
  props.state.setWidth(i, startWidth + dx, false);
}
function onPointerUp(i: number): void {
  if (dragging.value !== i) return;
  dragging.value = null;
  if (moved) props.state.save();
  measure(i);
}

// The widest cell in the column, header included. Cells clip with an
// ellipsis, so their scrollWidth is what the content needs.
function fit(i: number): void {
  const table = cells.value[i]?.closest('.data-table');
  if (!table) return;
  let widest = 0;
  for (const row of table.querySelectorAll(':scope > .data-head, :scope > .data-item > .data-row')) {
    const cell = row.querySelectorAll(':scope > .data-th, :scope > .data-td')[i];
    if (cell) widest = Math.max(widest, cell.scrollWidth);
  }
  if (widest > 0) props.state.setWidth(i, widest + 2);
  measure(i);
}

function onKey(i: number, e: KeyboardEvent): void {
  const step = e.shiftKey ? 64 : 16;
  const delta = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
  if (delta === 0) return;
  e.preventDefault();
  props.state.setWidth(i, clampWidth(widthOf(i) + delta));
  measure(i);
}
</script>

<template>
  <div class="col-resizers">
    <span v-for="(label, i) in labels" :key="i" ref="cells" class="col-resizer-cell">
      <span
        v-if="i < labels.length - 1"
        class="col-resizer"
        :class="{ dragging: dragging === i }"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        :aria-label="`Resize the ${label} column`"
        :aria-valuenow="shownWidth(i)"
        aria-valuemin="40"
        aria-valuemax="800"
        title="Drag to resize, double-click to fit"
        @focus="measure(i)"
        @pointerdown="onPointerDown(i, $event)"
        @pointermove="onPointerMove(i, $event)"
        @pointerup="onPointerUp(i)"
        @pointercancel="onPointerUp(i)"
        @click.stop
        @dblclick.prevent="fit(i)"
        @keydown="onKey(i, $event)"
      />
    </span>
  </div>
</template>

<style scoped>
.col-resizers {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: var(--cols);
  grid-template-rows: 100%;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  pointer-events: none;
}
.col-resizer-cell {
  position: relative;
  min-width: 0;
}
/* A 9px grab area centred on the gap after the column, a 1px line in it. */
.col-resizer {
  position: absolute;
  top: 25%;
  bottom: 25%;
  right: calc(-1 * var(--space-2) / 2 - 4.5px);
  width: 9px;
  cursor: col-resize;
  pointer-events: auto;
  touch-action: none;
}
.col-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: var(--border);
}
.col-resizer:hover::after,
.col-resizer:focus-visible::after,
.col-resizer.dragging::after {
  left: 3px;
  width: 3px;
  border-radius: 2px;
  background: var(--brand);
}
.col-resizer:focus-visible {
  outline: none;
}
</style>

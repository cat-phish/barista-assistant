<script setup lang="ts">
// One draggable list in Edit layout (LayoutEditor): a tab's charts, or on the
// Overview its tiles or its charts. Reordering a group leaves the other's
// order alone (withOrder keeps the ids it isn't given, after these).
import { computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import type { InsightTab } from '../../api/types';
import { useReorder } from '../../composables/useReorder';
import { useStats } from '../../composables/useStats';
import { INSIGHT_TAB_INFO, isPinLayoutId, isTileId, tabOfChart, withHidden, withOrder } from '../../lib/insightCharts';
import ReorderHandle from '../ReorderHandle.vue';

const props = defineProps<{ tab: InsightTab; group: 'tiles' | 'charts'; emptyText: string }>();
const stats = useStats();

const tabLabel = (chartId: string) => INSIGHT_TAB_INFO.find((t) => t.tab === tabOfChart(chartId))?.label ?? '';
interface Row {
  id: string;
  name: string;
}
const rows = computed<Row[]>({
  get: () =>
    stats
      .charts(props.tab)
      .filter((c) => isTileId(c.id) === (props.group === 'tiles'))
      // On the Overview a built-in chart says which tab it's from ("Coffee ground" is on two).
      .map((c) => ({ id: c.id, name: props.tab === 'overview' && props.group === 'charts' && !isPinLayoutId(c.id) ? `${c.title} · ${tabLabel(c.id)}` : c.title })),
  set: (next) => stats.setLayout(withOrder(stats.layout.value, props.tab, next.map((r) => r.id))),
});
const { announcement, onDragUpdate, move } = useReorder({
  items: rows,
  visible: () => rows.value,
  disabled: () => false,
  save: async () => true, // setLayout saves it
});

const hidden = (id: string) => !!stats.layout.value[props.tab]?.hidden?.includes(id);
// An added chart, or a chart pinned to the Overview, is removed rather than hidden.
const removable = (id: string) => isPinLayoutId(id) || (props.tab === 'overview' && !isTileId(id));
function setShown(id: string, on: boolean): void {
  stats.setLayout(withHidden(stats.layout.value, props.tab, id, !on));
}
function remove(id: string): void {
  if (isPinLayoutId(id)) stats.removeChart(id.slice('pin:'.length));
  else stats.toggleOverview(id);
}
</script>

<template>
  <span class="visually-hidden" aria-live="polite">{{ announcement }}</span>
  <VueDraggable v-if="rows.length" ref="reorder-list" :model-value="rows" tag="ol" class="rows"
    handle=".reorder-handle" :animation="150" ghost-class="drag-ghost" :custom-update="onDragUpdate">
    <li v-for="(r, i) in rows" :key="r.id" :data-reorder-id="r.id" :class="{ off: hidden(r.id) }">
      <ReorderHandle :name="r.name" :disabled="false" @move="move(i, $event)" />
      <label v-if="!removable(r.id)" class="checkbox name">
        <input type="checkbox" :checked="!hidden(r.id)" @change="setShown(r.id, ($event.target as HTMLInputElement).checked)" />
        {{ r.name }}
      </label>
      <span v-else class="name">{{ r.name }}</span>
      <div class="actions">
        <button class="btn-link" type="button" :disabled="i === 0" :aria-label="`Move ${r.name} up`" @click="move(i, -1)">↑</button>
        <button class="btn-link" type="button" :disabled="i === rows.length - 1" :aria-label="`Move ${r.name} down`" @click="move(i, 1)">↓</button>
        <button v-if="removable(r.id)" class="btn-link" type="button" :aria-label="`Remove ${r.name}`" @click="remove(r.id)">Remove</button>
      </div>
    </li>
  </VueDraggable>
  <p v-else class="muted small">{{ emptyText }}</p>
</template>

<style scoped>
.small {
  font-size: 0.85rem;
  margin: 0;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.rows li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
}
.rows li.off .name {
  color: var(--text-muted);
}
.name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.drag-ghost {
  opacity: 0.35;
}
</style>

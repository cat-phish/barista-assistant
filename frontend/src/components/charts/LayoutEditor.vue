<script setup lang="ts">
// Edit layout for one Insights tab: its charts by title, in order, to drag
// (or move with the arrows) and to show or hide. An added chart, and a chart
// pinned to the Overview, is removed instead of hidden. On the Overview the
// tiles are their own list, and can go above or below the charts. Changes
// show at once and are saved (useStats.setLayout).
import { computed } from 'vue';
import type { InsightTab } from '../../api/types';
import { useStats } from '../../composables/useStats';
import { withoutTab, withTilesBelow } from '../../lib/insightCharts';
import LayoutList from './LayoutList.vue';

const props = defineProps<{ tab: InsightTab }>();
const emit = defineEmits<{ done: [] }>();
const stats = useStats();

const anyHidden = computed(() => !!stats.layout.value[props.tab]?.hidden?.length);
const tilesBelow = computed(() => !!stats.layout.value.overview?.tilesBelow);
const reset = () => stats.setLayout(withoutTab(stats.layout.value, props.tab));
</script>

<template>
  <section class="card layout-editor" aria-label="Edit layout">
    <div class="head">
      <h2>Edit layout</h2>
      <p class="muted small">Drag ⠿ to reorder, or use the arrows. Untick one to hide it here.</p>
    </div>
    <template v-if="tab === 'overview'">
      <h3>Tiles</h3>
      <LayoutList :tab="tab" group="tiles" empty-text="No tiles." />
      <label class="checkbox">
        <input type="checkbox" :checked="tilesBelow" @change="stats.setLayout(withTilesBelow(stats.layout.value, ($event.target as HTMLInputElement).checked))" />
        Tiles below the charts
      </label>
      <h3>Charts</h3>
      <LayoutList :tab="tab" group="charts" empty-text="No charts added yet: use the pin on any chart, or “Add to a tab…” on Explore." />
    </template>
    <LayoutList v-else :tab="tab" group="charts" empty-text="No charts here yet." />
    <div class="foot">
      <button type="button" class="btn btn-primary" @click="emit('done')">Done</button>
      <button type="button" class="btn btn-secondary" :disabled="!stats.layout.value[tab]" @click="reset">
        Reset {{ tab === 'overview' ? 'Overview' : 'tab' }}<template v-if="anyHidden"> (show all)</template>
      </button>
    </div>
  </section>
</template>

<style scoped>
.layout-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}
.head h2 {
  font-size: 1rem;
  margin: 0;
}
h3 {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: var(--space-2) 0 0;
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>

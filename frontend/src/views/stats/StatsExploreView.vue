<script setup lang="ts">
// Insights → Explore: pick two numbers for a scatter with a trend line, or a
// group (Compare only) for the average of a number in each. Never one field
// against itself.
// The picks live in the URL (?x=&y=&color=&grinder=), so a view can be shared,
// and "Add to a tab…" keeps them on a tab (docs/api/stats.md §11b).
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { InsightTab } from '../../api/types';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ExploreChart from '../../components/charts/ExploreChart.vue';
import { useExplore, type ExplorePicks } from '../../composables/useExplore';
import { INSIGHT_TAB_INFO, newUuid, visibleTabs } from '../../lib/insightCharts';

const route = useRoute();
const router = useRouter();

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
function pick(key: string, value: string): void {
  const query = { ...route.query, [key]: value || undefined };
  void router.replace({ query });
}
const asked = computed<ExplorePicks>(() => ({ x: q('x'), y: q('y'), color: q('color') || undefined, grinder: q('grinder') || undefined }));
const { stats, numbers, groups, colorFields, x, y, color, label, grinders, onGrind, grinder } = useExplore(() => asked.value);
const resultNumbers = computed(() => numbers.value.filter((f) => f.group === 'result'));
const brewNumbers = computed(() => numbers.value.filter((f) => f.group === 'brew'));
// What's drawn, with the fallbacks filled in: what an added chart keeps.
const shown = computed<ExplorePicks>(() => ({ x: x.value.key, y: y.value.key, color: color.value?.key, grinder: grinder.value ?? undefined }));

// Both numbers: swap which goes across.
const swap = () => void router.replace({ query: { ...route.query, x: y.value.key, y: x.value.key } });

// Add to a tab: pick one, then it's kept there until removed on that tab.
const adding = ref(false);
const tabs = computed(() => visibleTabs(stats.hidden.value));
const target = ref<InsightTab>('overview');
const added = ref<InsightTab | null>(null);
const busy = ref(false);
const tabLabel = (t: InsightTab) => INSIGHT_TAB_INFO.find((i) => i.tab === t)?.label ?? t;
const tabRoute = (t: InsightTab) => INSIGHT_TAB_INFO.find((i) => i.tab === t)!.route;
function openAdd(): void {
  added.value = null;
  stats.pinError.value = '';
  adding.value = true;
}
async function add(): Promise<void> {
  busy.value = true;
  const ok = await stats.addChart({ id: newUuid(), kind: 'explore', tab: target.value, ...shown.value });
  busy.value = false;
  if (!ok) return;
  added.value = target.value;
  adding.value = false;
}
const otherQuery = computed(() => Object.fromEntries(Object.entries(route.query).filter(([k]) => !['x', 'y', 'color', 'grinder'].includes(k))));

const value = (e: Event) => (e.target as HTMLSelectElement).value;
</script>

<template>
  <div class="explore">
    <div class="picks" role="group" aria-label="What to compare">
      <div class="field">
        <label for="explore-x">Compare</label>
        <select id="explore-x" :value="x.key" @change="pick('x', value($event))">
          <optgroup label="Results">
            <option v-for="f in resultNumbers" :key="f.key" :value="f.key" :disabled="f.key === y.key">{{ label(f) }}</option>
          </optgroup>
          <optgroup label="Brew & bean">
            <option v-for="f in brewNumbers" :key="f.key" :value="f.key" :disabled="f.key === y.key">{{ label(f) }}</option>
          </optgroup>
          <optgroup label="Groups">
            <option v-for="f in groups" :key="f.key" :value="f.key">{{ f.label }}</option>
          </optgroup>
        </select>
      </div>
      <div class="field">
        <label for="explore-y">With</label>
        <div class="with">
          <select id="explore-y" :value="y.key" @change="pick('y', value($event))">
            <optgroup label="Results">
              <option v-for="f in resultNumbers" :key="f.key" :value="f.key" :disabled="f.key === x.key">{{ label(f) }}</option>
            </optgroup>
            <optgroup label="Brew & bean">
              <option v-for="f in brewNumbers" :key="f.key" :value="f.key" :disabled="f.key === x.key">{{ label(f) }}</option>
            </optgroup>
          </select>
          <button v-if="x.kind === 'number'" type="button" class="btn-link swap" aria-label="Swap the two" title="Swap the two" @click="swap">⇅</button>
        </div>
      </div>
      <div v-if="onGrind && grinders.length" class="field">
        <label for="explore-grinder">Grinder</label>
        <select id="explore-grinder" :value="grinder ?? ''" @change="pick('grinder', value($event))">
          <option v-for="g in grinders" :key="g.key" :value="g.key">{{ stats.name(g.key) ?? 'Removed grinder' }} ({{ g.n }})</option>
        </select>
      </div>
      <div v-if="x.kind === 'number'" class="field">
        <label for="explore-color">Colour by</label>
        <select id="explore-color" :value="color?.key ?? ''" @change="pick('color', value($event))">
          <option value="">Nothing</option>
          <option v-for="f in colorFields" :key="f.key" :value="f.key">{{ f.label }}</option>
        </select>
      </div>
    </div>

    <ExploreChart :picks="shown">
      <template #actions>
        <button type="button" class="btn-link" @click="openAdd">Add to a tab…</button>
      </template>
    </ExploreChart>
    <p v-if="added" class="muted added" role="status">
      Added to <RouterLink :to="{ name: tabRoute(added), query: otherQuery }">{{ tabLabel(added) }}</RouterLink>. Remove it there when you're done with it.
    </p>

    <ConfirmDialog :open="adding" title="Add this chart to a tab" @cancel="adding = false">
      <fieldset class="tabs">
        <legend class="muted">It stays there, with the page's filters, until you remove it.</legend>
        <label v-for="t in tabs" :key="t.tab" class="checkbox">
          <input v-model="target" type="radio" name="explore-tab" :value="t.tab" />
          {{ t.label }}
        </label>
      </fieldset>
      <p v-if="stats.pinError.value" class="form-error" role="alert">{{ stats.pinError.value }}</p>
      <template #actions>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="add">{{ busy ? 'Adding…' : `Add to ${tabLabel(target)}` }}</button>
        <button type="button" class="btn btn-secondary" @click="adding = false">Cancel</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.explore {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-2) var(--space-3);
}
.field select {
  width: 100%;
}
.with {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}
.added {
  margin: 0;
}
.tabs {
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tabs legend {
  margin-bottom: var(--space-2);
  padding: 0;
}
.swap {
  flex: none;
  font-size: 1.1rem;
  min-width: 44px;
  min-height: 44px;
}
</style>

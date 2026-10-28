<script setup lang="ts">
// Prep tools (docs/api/prep-tools.md §3d), one tab of Bar setup: the brew
// form's Prep checklist, in this order. Reorder here; add, edit (name,
// where it's offered), archive/restore and delete on
// PrepToolFormView.
import { computed, nextTick, onMounted, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import ReorderHandle from '../components/ReorderHandle.vue';
import { type DragUpdate, reorderVisible, undoDragMove } from '../lib/reorder';
import { errorMessage } from '../api/client';
import { prepToolsApi } from '../api/prepTools';
import { brewersApi } from '../api/brewers';
import type { Brewer, PrepTool } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { offeredLabel } from '../lib/prepTools';
import ListDataBar from '../components/ListDataBar.vue';
import { useSelection } from '../composables/useSelection';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const tools = ref<PrepTool[]>([]);
const brewers = ref<Brewer[]>([]); // for the badges' brewer names
const loading = ref(true);
const error = ref('');
const showArchived = ref(false);

const archivedCount = computed(() => tools.value.filter((t) => t.archivedAt).length);
const shown = computed(() => tools.value.filter((t) => !t.archivedAt || showArchived.value));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [list, b] = await Promise.all([prepToolsApi.list(ws), brewersApi.list(ws)]);
    tools.value = list.tools;
    brewers.value = b.brewers;
    if (archivedCount.value === 0) showArchived.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const busy = ref(false);
// Keep hidden archived items in their slots, including them in every save.
const reorderDisabled = computed(() => busy.value || !workspaces.canEdit || selection.selecting);
const orderList = ref<InstanceType<typeof VueDraggable> | null>(null);
const moveAnnouncement = ref('');
async function reorder(from: number, to: number): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || reorderDisabled.value) return;
  const previous = tools.value;
  const moved = shown.value[from];
  const next = reorderVisible(previous, shown.value, from, to);
  if (next.every((item, i) => item.id === previous[i]?.id)) return;
  busy.value = true;
  error.value = '';
  tools.value = next;
  try {
    tools.value = (await prepToolsApi.reorder(ws, next.map((item) => item.id))).tools;
    moveAnnouncement.value = `${moved?.name} moved to position ${to + 1} of ${shown.value.length}`;
  } catch (err) {
    tools.value = previous;
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
    await nextTick();
    orderList.value?.$el.querySelector(`[data-reorder-id="${moved?.id}"] .reorder-handle`)?.focus();
  }
}
function onDragUpdate(event: DragUpdate): void {
  undoDragMove(event);
  if (event.oldIndex !== undefined && event.newIndex !== undefined) void reorder(event.oldIndex, event.newIndex);
}
function move(t: PrepTool, by: -1 | 1): void {
  const from = shown.value.indexOf(t);
  void reorder(from, from + by);
}

// Select mode for exporting some tools (components/ExportBar.vue).
const selection = useSelection();
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
    </div>
    <SetupTabs />
    <p class="muted intro">The prep you can tick on each brew, in this order. Each shows on the brews it's offered for: every brew, or chosen methods and brewers; the AI sees what you ticked.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading prep…</p>
    <template v-else>
      <section class="card stack prep-card" aria-labelledby="tools-title" :inert="busy">
        <div class="head">
          <h2 id="tools-title">Prep</h2>
          <label v-if="archivedCount > 0" class="checkbox">
            <input v-model="showArchived" type="checkbox" :disabled="busy" />
            Show archived ({{ archivedCount }})
          </label>
        </div>
        <ListDataBar list="prep_tools" noun="prep items" :selection="selection" :visible-ids="shown.map((t) => t.id)" @imported="load()" />
        <p v-if="workspaces.canEdit && shown.length > 1" class="muted small">Drag ⠿ to reorder, or use the arrow buttons.</p>
        <span class="visually-hidden" aria-live="polite">{{ moveAnnouncement }}</span>
        <VueDraggable v-if="shown.length" ref="orderList" :model-value="shown" tag="ol" class="tools"
          handle=".reorder-handle" :animation="150" ghost-class="drag-ghost"
          :disabled="reorderDisabled" :custom-update="onDragUpdate">
          <li v-for="(t, i) in shown" :key="t.id" :data-reorder-id="t.id">
            <div class="row">
              <div class="row-controls">
                <ReorderHandle v-if="workspaces.canEdit" :name="t.name" :disabled="reorderDisabled" @move="move(t, $event)" />
                <input v-if="selection.selecting" type="checkbox" :checked="selection.has(t.id)" :aria-label="`Select ${t.name}`" @change="selection.toggle(t.id)" />
              </div>
              <div class="details">
                <span class="name" :class="{ muted: t.archivedAt }">{{ t.name }}<template v-if="t.archivedAt"> (archived)</template></span>
                <span class="badge">{{ offeredLabel(t, brewers) }}</span>
              </div>
              <div v-if="workspaces.canEdit" class="actions">
                <button class="btn-link" type="button" :disabled="reorderDisabled || i === 0" :aria-label="`Move ${t.name} up`" @click="move(t, -1)">↑</button>
                <button class="btn-link" type="button" :disabled="reorderDisabled || i === shown.length - 1" :aria-label="`Move ${t.name} down`" @click="move(t, 1)">↓</button>
                <RouterLink class="btn-link" :to="{ name: 'prep-tool-edit', params: { id: t.id } }">Edit</RouterLink>
              </div>
            </div>
          </li>
        </VueDraggable>
        <p v-else class="muted small">No prep items yet.</p>
        <RouterLink v-if="workspaces.canEdit" class="btn btn-secondary add" :to="{ name: 'prep-tool-new' }">Add prep item</RouterLink>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.drag-ghost { opacity: 0.35; }
h2 {
  font-size: 1.1rem;
  margin: 0;
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.small {
  font-size: 0.85rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.tools {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.prep-card {
  container-type: inline-size;
}
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
}
.row-controls,
.actions {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  align-self: start;
}
.actions {
  white-space: nowrap;
}
.details {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}
.details .badge {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
@container (max-width: 32rem) {
  .row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .actions {
    grid-column: 1 / -1;
    justify-self: end;
  }
}
.add {
  align-self: flex-start;
}
.name {
  padding-top: calc((var(--tap) - 1lh) / 2);
  overflow-wrap: anywhere;
}
</style>

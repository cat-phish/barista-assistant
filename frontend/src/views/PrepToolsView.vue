<script setup lang="ts">
// Prep tools (docs/api/prep-tools.md §3d), one tab of Bar setup: the brew
// form's Prep checklist, in this order. Move up/down and archive (keeps
// history) here; add, edit (name, where it's offered) and delete on
// PrepToolFormView.
import { computed, onMounted, ref } from 'vue';
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
async function run(action: (ws: string) => Promise<unknown>): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws) return false;
  busy.value = true;
  error.value = '';
  try {
    await action(ws);
    await load();
    return true;
  } catch (err) {
    error.value = errorMessage(err);
    return false;
  } finally {
    busy.value = false;
  }
}

// Swap with the neighbour on screen; the API takes the whole list (archived too).
async function move(t: PrepTool, by: -1 | 1): Promise<void> {
  const neighbour = shown.value[shown.value.indexOf(t) + by];
  if (!neighbour) return;
  const ids = tools.value.map((x) => x.id);
  const a = ids.indexOf(t.id);
  const b = ids.indexOf(neighbour.id);
  [ids[a], ids[b]] = [neighbour.id, t.id];
  await run((ws) => prepToolsApi.reorder(ws, ids));
}

const setArchived = (t: PrepTool, archived: boolean) => run((ws) => prepToolsApi.update(ws, t.id, { archived }));

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

    <p v-if="loading" class="muted" aria-live="polite">Loading tools…</p>
    <template v-else>
      <section class="card stack" aria-labelledby="tools-title">
        <div class="head">
          <h2 id="tools-title">Tools</h2>
          <label v-if="archivedCount > 0" class="checkbox">
            <input v-model="showArchived" type="checkbox" />
            Show archived ({{ archivedCount }})
          </label>
        </div>
        <ListDataBar list="prep_tools" noun="tools" :selection="selection" :visible-ids="shown.map((t) => t.id)" @imported="load()" />
        <ol v-if="shown.length" class="tools">
          <li v-for="(t, i) in shown" :key="t.id">
            <div class="row">
              <input v-if="selection.selecting" type="checkbox" :checked="selection.has(t.id)" :aria-label="`Select ${t.name}`" @change="selection.toggle(t.id)" />
              <span class="name" :class="{ muted: t.archivedAt }">{{ t.name }}<template v-if="t.archivedAt"> (archived)</template></span>
              <span class="badge">{{ offeredLabel(t, brewers) }}</span>
              <template v-if="workspaces.canEdit">
                <button class="btn-link" type="button" :disabled="busy || i === 0" :aria-label="`Move ${t.name} up`" @click="move(t, -1)">↑</button>
                <button class="btn-link" type="button" :disabled="busy || i === shown.length - 1" :aria-label="`Move ${t.name} down`" @click="move(t, 1)">↓</button>
                <RouterLink class="btn-link" :to="{ name: 'prep-tool-edit', params: { id: t.id } }">Edit</RouterLink>
                <template v-if="t.archivedAt">
                  <button class="btn-link" type="button" :disabled="busy" @click="setArchived(t, false)">Restore</button>
                </template>
                <template v-else>
                  <button class="btn-link" type="button" :disabled="busy" @click="setArchived(t, true)">Archive</button>
                </template>
              </template>
            </div>
          </li>
        </ol>
        <p v-else class="muted small">No tools yet.</p>
        <RouterLink v-if="workspaces.canEdit" class="btn btn-secondary add" :to="{ name: 'prep-tool-new' }">Add tool</RouterLink>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
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
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.add {
  align-self: flex-start;
}
.name {
  flex: 1;
}
</style>

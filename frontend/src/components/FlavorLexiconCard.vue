<script setup lang="ts">
// Settings → Lists → Flavor wheel (docs/api/flavor-lexicon.md §2c): which
// wheel the brew form offers. Download it as a file, import your own
// (docs/custom-flavor-wheel.md), or go back to the built-in one. Owners only.
// Both change it for everyone, so they confirm with "I understand" (CLAUDE.md
// rule 7).
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { flavorLexiconApi } from '../api/flavorLexicon';
import { setLexicon, useFlavorWheel } from '../composables/useFlavorWheel';
import { saveBlob } from '../lib/backup';
import { formatWhen } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';
import ConfirmDialog from './ConfirmDialog.vue';

const workspaces = useWorkspaceStore();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const { wheel, info } = useFlavorWheel();
const count = (flavors: ReadonlyArray<{ key: string }>) => ({ all: flavors.length, inner: flavors.filter((f) => !f.key.includes('.')).length });

const busy = ref(false);
const error = ref('');
const understood = ref(false);

function download(): void {
  const lexicon = info.value?.lexicon;
  if (!lexicon) return;
  const slug = workspaces.current?.slug ?? 'workspace';
  saveBlob(`${slug}-flavor-wheel.json`, new Blob([JSON.stringify(lexicon, null, 2) + '\n'], { type: 'application/json' }));
}

// Importing: read the file, show what's in it, then send it; the server
// checks it and says what's wrong, and where.
const chosen = ref<{ file: unknown; name: string; all: number; inner: number } | null>(null);
async function pick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    error.value = `${file.name} isn't a JSON file.`;
    return;
  }
  const raw = (typeof data === 'object' && data !== null ? data : {}) as { name?: unknown; flavors?: unknown };
  const flavors = Array.isArray(raw.flavors) ? raw.flavors.filter((f): f is { key: string } => typeof f?.key === 'string') : [];
  chosen.value = { file: data, name: typeof raw.name === 'string' ? raw.name : file.name, ...count(flavors) };
}
async function importChosen(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !chosen.value) return;
  busy.value = true;
  error.value = '';
  try {
    setLexicon(ws, await flavorLexiconApi.replace(ws, chosen.value.file));
    chosen.value = null;
  } catch (err) {
    error.value = errorMessage(err);
    chosen.value = null;
  } finally {
    busy.value = false;
  }
}

const resetting = ref(false);
// Each dialog starts unticked.
watch([chosen, resetting], () => (understood.value = false));
async function reset(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  error.value = '';
  try {
    setLexicon(ws, await flavorLexiconApi.reset(ws));
    resetting.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const now = computed(() => (info.value ? count(info.value.lexicon.flavors) : null));
</script>

<template>
  <section class="card stack" aria-labelledby="list-flavors" :inert="busy">
    <h2 id="list-flavors">Flavor wheel</h2>
    <p class="muted small">The flavors offered when you taste a brew. Use the built-in wheel, or import your own as a JSON file.</p>
    <p v-if="!info" class="muted" aria-live="polite">Loading…</p>
    <template v-else>
      <p>
        <strong>{{ wheel.name }}</strong>
        <span class="muted"> · {{ now!.inner }} groups, {{ now!.all }} flavors</span>
        <span v-if="info.custom && info.updatedAt" class="muted small"> · imported {{ formatWhen(info.updatedAt) }}</span>
      </p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" @click="download">Download as JSON</button>
        <template v-if="isOwner">
          <label class="btn btn-secondary" for="lexicon-file">Import a wheel…</label>
          <input id="lexicon-file" class="visually-hidden" type="file" accept="application/json,.json" @change="pick" />
          <button v-if="info.custom" type="button" class="btn-link" @click="resetting = true">Use the built-in wheel</button>
        </template>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="!isOwner" class="muted small">Only owners can change the wheel.</p>
      <details class="format">
        <summary>Building your own wheel</summary>
        <p class="small">
          A JSON file like the one below, from any list of flavors you like: up to three rings, at most 500 flavors. Download the current wheel
          for a full example. Each flavor's <code>key</code> is lowercase letters, digits and <code>_</code>; dots place it under another flavor,
          listed before it. <code>color</code> (<code>#rrggbb</code>) is optional: without it a flavor takes a lighter shade of the one it's under.
          Brews save each flavor's key and name, so keep a key the same when you rename it.
        </p>
        <pre><code>{
  "format": "barista-flavor-lexicon",
  "version": 1,
  "name": "House wheel",
  "flavors": [
    { "key": "fruity", "label": "Fruity", "color": "#d0453f" },
    { "key": "fruity.citrus", "label": "Citrus" },
    { "key": "fruity.citrus.lemon", "label": "Lemon" },
    { "key": "sweet", "label": "Sweet", "color": "#d98b2b" }
  ]
}</code></pre>
      </details>
    </template>

    <ConfirmDialog :open="!!chosen" title="Use this flavor wheel?" @cancel="chosen = null">
      <p>
        <strong>{{ chosen?.name }}</strong> ({{ chosen?.inner }} groups, {{ chosen?.all }} flavors) replaces the current wheel for everyone in this
        workspace.
      </p>
      <p>Brews keep their flavors. Ones the new wheel doesn't have still show by name, but can't be picked for new brews.</p>
      <label class="checkbox">
        <input v-model="understood" type="checkbox" />
        I understand
      </label>
      <template #actions>
        <button class="btn btn-danger" type="button" :disabled="busy || !understood" @click="importChosen">Use this wheel</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="chosen = null">Cancel</button>
      </template>
    </ConfirmDialog>
    <ConfirmDialog :open="resetting" title="Go back to the built-in wheel?" @cancel="resetting = false">
      <p>Your wheel is replaced for everyone in this workspace. Download it first if you may want it again.</p>
      <p>Brews keep their flavors; ones the built-in wheel doesn't have still show by name.</p>
      <label class="checkbox">
        <input v-model="understood" type="checkbox" />
        I understand
      </label>
      <template #actions>
        <button class="btn btn-danger" type="button" :disabled="busy || !understood" @click="reset">Use the built-in wheel</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="resetting = false">Cancel</button>
      </template>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.format summary {
  cursor: pointer;
  font-weight: 600;
  min-height: var(--tap);
  display: flex;
  align-items: center;
}
.format p {
  margin-bottom: var(--space-2);
}
.format pre {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  overflow-x: auto;
  border-radius: var(--radius);
  background: var(--brand-tint);
  font-size: 0.8rem;
}
</style>

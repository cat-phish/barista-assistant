<script setup lang="ts">
// Settings → AI → Research (docs/api/research.md §1f): every built-in research
// finding the AI's analyses and suggestions build on, each on, off or only
// as an experiment, with a note of your own; the workspace's defaults (owners)
// and your choice above them; and research you add yourself: yours (private,
// in every workspace) or the workspace's (owners, shared).
import { computed, onMounted, ref } from 'vue';
import { authApi } from '../api/auth';
import { errorMessage } from '../api/client';
import type { BuiltInFinding, MyResearch, OwnFinding, OwnFindingInput, ResearchDraft, ResearchLever, ResearchMode, ResearchSetting, ResearchSettings, WorkspaceResearch } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useAiAvailable } from '../composables/useAiAvailable';
import { defaultMode, effectiveMode, emptyFinding, EVIDENCE_LABELS, findingProblem, LEVER_LABELS, MODE_LABELS, OWN_EVIDENCE, RESEARCH_LEVERS, RESEARCH_MODES, RESEARCH_SCOPES, SCOPE_LABELS } from '../lib/research';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const aiAvailable = useAiAvailable();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const canWrite = computed(() => workspaces.canEdit);
const workspaceId = computed(() => workspaces.current?.id ?? null);

const mine = ref<MyResearch | null>(null);
const ws = ref<WorkspaceResearch | null>(null);
const loadError = ref('');
const busy = ref(false);
const error = ref('');
const message = ref('');

async function load(): Promise<void> {
  try {
    const [m, w] = await Promise.all([authApi.research(), workspaceId.value ? workspacesApi.research(workspaceId.value) : Promise.resolve(null)]);
    mine.value = m;
    ws.value = w;
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err);
  }
}
onMounted(load);

const builtIn = computed(() => mine.value?.builtIn ?? []);
const updated = computed(() => new Set(mine.value?.updated ?? []));
const limits = computed(() => mine.value?.limits ?? { findings: 20, title: 80, text: 600, source: 300, note: 200, draftText: 4000, drafts: 5 });

async function run(work: () => Promise<void>, done = 'Saved.'): Promise<void> {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await work();
    message.value = done;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

// ---- Built-in findings: your choice and the workspace's default -------------
const INHERIT = '';
const myChoice = (f: BuiltInFinding): ResearchMode | '' => mine.value?.research.settings[f.key]?.mode ?? INHERIT;
const wsChoice = (f: BuiltInFinding): ResearchMode | '' => ws.value?.research.settings[f.key]?.mode ?? INHERIT;
const inherited = (f: BuiltInFinding): ResearchMode => effectiveMode(f, null, ws.value?.research ?? null);
const effective = (f: BuiltInFinding): ResearchMode => effectiveMode(f, mine.value?.research ?? null, ws.value?.research ?? null);
const noteOf = (f: BuiltInFinding): string => mine.value?.research.settings[f.key]?.note ?? '';

const toPut = (r: ResearchSettings) => ({ settings: r.settings, own: r.own.map(({ createdAt: _c, ...o }) => o) });
// One setting changed (a mode, a note, or both); no choice and no note left
// means nothing to keep.
function withSetting(r: ResearchSettings, key: string, change: Partial<ResearchSetting>): Record<string, ResearchSetting> {
  const settings = { ...r.settings };
  const next = { mode: change.mode !== undefined ? change.mode : (settings[key]?.mode ?? null), note: change.note !== undefined ? change.note || null : (settings[key]?.note ?? null) };
  if (!next.mode && !next.note) delete settings[key];
  else settings[key] = next;
  return settings;
}
const saveMine = (settings: Record<string, ResearchSetting>, own: OwnFinding[] = mine.value!.research.own) =>
  run(async () => {
    mine.value = await authApi.setResearch(toPut({ settings, own }));
  });
const saveWs = (settings: Record<string, ResearchSetting>, own: OwnFinding[] = ws.value!.research.own) =>
  run(async () => {
    if (!workspaceId.value) return;
    ws.value = await workspacesApi.setResearch(workspaceId.value, toPut({ settings, own }));
  });
const asMode = (value: string): ResearchMode | null => (value === INHERIT ? null : (value as ResearchMode));
function setMine(f: BuiltInFinding, value: string): void {
  if (mine.value) void saveMine(withSetting(mine.value.research, f.key, { mode: asMode(value) }));
}
function setNote(f: BuiltInFinding, note: string): void {
  if (mine.value && note.trim() !== noteOf(f)) void saveMine(withSetting(mine.value.research, f.key, { note: note.trim() }));
}
function setWs(f: BuiltInFinding, value: string): void {
  if (ws.value) void saveWs(withSetting(ws.value.research, f.key, { mode: asMode(value) }));
}
const dismiss = () => run(async () => {
  mine.value = await authApi.researchSeen();
}, '');

// ---- Own findings ---------------------------------------------------------
type Scope = 'mine' | 'workspace';
const editing = ref<{ scope: Scope; id: string | null; draft: OwnFindingInput } | null>(null);
const problem = computed(() => (editing.value ? findingProblem(editing.value.draft, limits.value) : null));
function startAdd(scope: Scope): void {
  editing.value = { scope, id: null, draft: emptyFinding() };
}
function startEdit(scope: Scope, f: OwnFinding): void {
  const { id, createdAt: _c, ...rest } = f;
  editing.value = { scope, id, draft: { ...rest, levers: [...rest.levers] } };
}
function toggleLever(lever: OwnFindingInput['levers'][number]): void {
  const d = editing.value?.draft;
  if (!d) return;
  d.levers = d.levers.includes(lever) ? d.levers.filter((l) => l !== lever) : [...d.levers, lever];
}
const listOf = (scope: Scope): OwnFinding[] => (scope === 'mine' ? mine.value?.research.own : ws.value?.research.own) ?? [];
async function saveEditing(): Promise<void> {
  const e = editing.value;
  if (!e || problem.value) return;
  const current = listOf(e.scope);
  const sent = { ...e.draft, title: e.draft.title.trim(), text: e.draft.text.trim(), source: e.draft.source?.trim() || null };
  const own = e.id ? current.map((f) => (f.id === e.id ? { ...f, ...sent } : f)) : [...current, { ...sent, id: '', createdAt: '' }];
  const put = (r: ResearchSettings) => ({ settings: r.settings, own: own.map(({ id, createdAt: _c, ...o }) => (id ? { id, ...o } : o)) });
  await run(async () => {
    if (e.scope === 'mine' && mine.value) mine.value = await authApi.setResearch(put(mine.value.research));
    else if (ws.value && workspaceId.value) ws.value = await workspacesApi.setResearch(workspaceId.value, put(ws.value.research));
    editing.value = null;
  });
}
function remove(scope: Scope, f: OwnFinding): void {
  const own = listOf(scope).filter((o) => o.id !== f.id);
  if (scope === 'mine' && mine.value) void saveMine(mine.value.research.settings, own);
  else if (ws.value) void saveWs(ws.value.research.settings, own);
}
function setOwnMode(scope: Scope, f: OwnFinding, mode: ResearchMode): void {
  const own = listOf(scope).map((o) => (o.id === f.id ? { ...o, mode } : o));
  if (scope === 'mine' && mine.value) void saveMine(mine.value.research.settings, own);
  else if (ws.value) void saveWs(ws.value.research.settings, own);
}
const canEditScope = (scope: Scope) => scope === 'mine' || isOwner.value;
// Your own choice for a workspace finding (docs/api/research.md §1f, SEC-02):
// "own.<id>" in your settings, beating the mode the workspace gave it.
const myOwnChoice = (f: OwnFinding): ResearchMode | '' => mine.value?.research.settings[`own.${f.id}`]?.mode ?? INHERIT;
function setMyOwn(f: OwnFinding, value: string): void {
  if (mine.value) void saveMine(withSetting(mine.value.research, `own.${f.id}`, { mode: asMode(value) }));
}

// ---- Drafts from text (docs/api/research.md §1f, "Drafts") -----------------
// The AI turns pasted text into cards; each is edited and saved, or
// discarded, by hand. Nothing is saved until Save.
const pasted = ref('');
const drafting = ref(false);
const draftError = ref('');
const drafts = ref<OwnFindingInput[]>([]);
const draftedFrom = ref('');
async function makeDrafts(): Promise<void> {
  const id = workspaceId.value;
  if (!id || !pasted.value.trim()) return;
  drafting.value = true;
  draftError.value = '';
  try {
    const { drafts: made } = await workspacesApi.researchDrafts(id, pasted.value.trim());
    drafts.value = made.map((d: ResearchDraft) => ({ ...d, levers: [...d.levers] }));
    draftedFrom.value = made.length ? '' : 'Nothing in that text read as a finding about brewing.';
  } catch (err) {
    draftError.value = errorMessage(err);
  } finally {
    drafting.value = false;
  }
}
const draftProblem = (d: OwnFindingInput) => findingProblem(d, limits.value);
function toggleDraftLever(d: OwnFindingInput, lever: ResearchLever): void {
  d.levers = d.levers.includes(lever) ? d.levers.filter((l) => l !== lever) : [...d.levers, lever];
}
async function saveDraft(i: number, scope: Scope): Promise<void> {
  const d = drafts.value[i];
  if (!d || draftProblem(d) || full(scope)) return;
  const sent = { ...d, title: d.title.trim(), text: d.text.trim(), source: d.source?.trim() || null };
  const own = [...listOf(scope).map(({ id, createdAt: _c, ...o }) => ({ id, ...o })), sent];
  await run(async () => {
    if (scope === 'mine' && mine.value) mine.value = await authApi.setResearch({ settings: mine.value.research.settings, own });
    else if (ws.value && workspaceId.value) ws.value = await workspacesApi.setResearch(workspaceId.value, { settings: ws.value.research.settings, own });
    drafts.value.splice(i, 1);
  }, scope === 'mine' ? 'Saved to your findings.' : "Saved to the workspace's findings.");
}
const discardDraft = (i: number) => drafts.value.splice(i, 1);
const full = (scope: Scope) => listOf(scope).length >= limits.value.findings;
const leverNames = (f: { levers: ResearchLever[] }): string => f.levers.map((l) => LEVER_LABELS[l]).join(', ');
</script>

<template>
  <SettingsLayout title="Research">
    <p class="muted">
      The research the AI's analyses and suggestions build on, one finding at a time. Each is <strong>on</strong> (a rule the AI follows when it
      fits the brew), <strong>off</strong> (never sent) or <strong>only as an experiment</strong> (something to try, never a fix in an analysis or
      a suggestion). Your choice beats the workspace's default. Findings you add yourself are sent after the built-in ones, as data about brewing.
    </p>
    <p v-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
    <template v-else-if="mine">
      <div v-if="updated.size" class="notice" role="status">
        <p>
          The research list changed since you last looked ({{ mine.research.seenVersion }} → {{ mine.version }}): {{ updated.size }}
          {{ updated.size === 1 ? 'finding was' : 'findings were' }} added or reworded, marked <span class="badge">Updated</span> below. Your
          choices still apply to them.
        </p>
        <button class="btn small" type="button" :disabled="busy" @click="dismiss">Dismiss</button>
      </div>

      <section class="card stack" aria-labelledby="research-built-in">
        <h2 id="research-built-in">Built-in findings</h2>
        <p class="muted small">
          From the research the app ships with (<code>docs/research</code>). <template v-if="ws">The workspace's default is what everyone here
          gets unless they choose otherwise<template v-if="isOwner">; as an owner you set it</template>.</template> A note is for you only; it
          isn't sent to the AI.
        </p>
        <div v-for="f in builtIn" :key="f.key" class="finding">
          <div class="head">
            <h3>
              {{ f.title }}
              <span v-if="updated.has(f.key)" class="badge">Updated</span>
              <span v-if="f.experiment" class="badge muted-badge">Experiment</span>
            </h3>
            <span class="muted small">{{ EVIDENCE_LABELS[f.evidence] }} · {{ SCOPE_LABELS[f.scope] }} · {{ leverNames(f) }}</span>
          </div>
          <p class="text">{{ f.text }}</p>
          <div class="controls">
            <div class="field">
              <label :for="`mine-${f.key}`">You</label>
              <select :id="`mine-${f.key}`" :value="myChoice(f)" :disabled="busy" @change="setMine(f, ($event.target as HTMLSelectElement).value)">
                <option :value="INHERIT">{{ ws ? "Workspace default" : 'Default' }} ({{ MODE_LABELS[inherited(f)] }})</option>
                <option v-for="m in RESEARCH_MODES" :key="m" :value="m">{{ MODE_LABELS[m] }}</option>
              </select>
            </div>
            <div v-if="ws" class="field">
              <label :for="`ws-${f.key}`">Workspace default</label>
              <select :id="`ws-${f.key}`" :value="wsChoice(f)" :disabled="busy || !isOwner" @change="setWs(f, ($event.target as HTMLSelectElement).value)">
                <option :value="INHERIT">Built-in ({{ MODE_LABELS[defaultMode(f)] }})</option>
                <option v-for="m in RESEARCH_MODES" :key="m" :value="m">{{ MODE_LABELS[m] }}</option>
              </select>
            </div>
            <div class="field note">
              <label :for="`note-${f.key}`">Note</label>
              <input :id="`note-${f.key}`" type="text" :value="noteOf(f)" :maxlength="limits.note" :disabled="busy" @change="setNote(f, ($event.target as HTMLInputElement).value)" />
            </div>
          </div>
          <p class="muted small">Now: {{ MODE_LABELS[effective(f)] }}</p>
        </div>
      </section>

      <section v-for="scope in (['mine', 'workspace'] as const)" :key="scope" class="card stack" :aria-labelledby="`research-${scope}`">
        <template v-if="scope === 'mine' || ws">
          <h2 :id="`research-${scope}`">{{ scope === 'mine' ? 'Your findings' : 'Workspace findings' }}</h2>
          <p class="muted small">
            <template v-if="scope === 'mine'">Yours alone, in every workspace: other members see a placeholder where they'd be in a saved request.</template>
            <template v-else>Shared with everyone in the workspace<template v-if="isOwner">; owners add and change them</template>.</template>
            Write a finding as what was observed, not as an instruction: the AI reads it as data.
          </p>
          <p v-if="!listOf(scope).length" class="muted small">None yet.</p>
          <div v-for="f in listOf(scope)" :key="f.id" class="finding">
            <div class="head">
              <h3>{{ f.title }} <span class="badge">{{ scope === 'mine' ? 'Yours' : 'Workspace' }}</span></h3>
              <span class="muted small">{{ EVIDENCE_LABELS[f.evidence] }} · {{ SCOPE_LABELS[f.scope] }} · {{ leverNames(f) }}</span>
            </div>
            <p class="text">{{ f.text }}</p>
            <p v-if="f.source" class="muted small">Source: {{ f.source }}</p>
            <div class="controls">
              <div class="field">
                <label :for="`own-${f.id}`">{{ scope === 'mine' ? 'Mode' : 'Workspace' }}</label>
                <select :id="`own-${f.id}`" :value="f.mode" :disabled="busy || !canEditScope(scope)" @change="setOwnMode(scope, f, ($event.target as HTMLSelectElement).value as ResearchMode)">
                  <option v-for="m in RESEARCH_MODES" :key="m" :value="m">{{ MODE_LABELS[m] }}</option>
                </select>
              </div>
              <div v-if="scope === 'workspace' && mine" class="field">
                <label :for="`own-mine-${f.id}`">You</label>
                <select :id="`own-mine-${f.id}`" :value="myOwnChoice(f)" :disabled="busy" @change="setMyOwn(f, ($event.target as HTMLSelectElement).value)">
                  <option :value="INHERIT">Workspace ({{ MODE_LABELS[f.mode] }})</option>
                  <option v-for="m in RESEARCH_MODES" :key="m" :value="m">{{ MODE_LABELS[m] }}</option>
                </select>
              </div>
              <template v-if="canEditScope(scope)">
                <button class="btn-link small" type="button" :disabled="busy" @click="startEdit(scope, f)">Edit</button>
                <button class="btn-link small" type="button" :disabled="busy" @click="remove(scope, f)">Remove</button>
              </template>
            </div>
          </div>
          <form v-if="editing && editing.scope === scope" class="stack edit" @submit.prevent="saveEditing">
            <h3>{{ editing.id ? 'Edit finding' : 'New finding' }}</h3>
            <div class="field">
              <label :for="`f-title-${scope}`">Title <span class="req" aria-hidden="true">*</span></label>
              <input :id="`f-title-${scope}`" v-model="editing.draft.title" type="text" :maxlength="limits.title" aria-required="true" />
            </div>
            <div class="field">
              <label :for="`f-text-${scope}`">Finding <span class="req" aria-hidden="true">*</span></label>
              <textarea :id="`f-text-${scope}`" v-model="editing.draft.text" rows="3" :maxlength="limits.text" aria-required="true" />
              <span class="muted small">What was found, as a statement about brewing. {{ editing.draft.text.length }}/{{ limits.text }}</span>
            </div>
            <fieldset class="field">
              <legend>Levers <span class="req" aria-hidden="true">*</span></legend>
              <div class="levers">
                <label v-for="l in RESEARCH_LEVERS" :key="l" class="checkbox">
                  <input type="checkbox" :checked="editing.draft.levers.includes(l)" @change="toggleLever(l)" />
                  {{ LEVER_LABELS[l] }}
                </label>
              </div>
            </fieldset>
            <div class="controls">
              <div class="field">
                <label :for="`f-evidence-${scope}`">Evidence</label>
                <select :id="`f-evidence-${scope}`" v-model="editing.draft.evidence">
                  <option v-for="e in OWN_EVIDENCE" :key="e" :value="e">{{ EVIDENCE_LABELS[e] }}</option>
                </select>
              </div>
              <div class="field">
                <label :for="`f-scope-${scope}`">Brews</label>
                <select :id="`f-scope-${scope}`" v-model="editing.draft.scope">
                  <option v-for="s in RESEARCH_SCOPES" :key="s" :value="s">{{ SCOPE_LABELS[s] }}</option>
                </select>
              </div>
              <div class="field">
                <label :for="`f-mode-${scope}`">Mode</label>
                <select :id="`f-mode-${scope}`" v-model="editing.draft.mode">
                  <option v-for="m in RESEARCH_MODES" :key="m" :value="m">{{ MODE_LABELS[m] }}</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label :for="`f-source-${scope}`">Source</label>
              <input :id="`f-source-${scope}`" :value="editing.draft.source ?? ''" type="text" :maxlength="limits.source" @input="editing.draft.source = ($event.target as HTMLInputElement).value" />
              <span class="muted small">Where it comes from: a paper, a video, your own notes.</span>
            </div>
            <p v-if="problem" class="muted small">{{ problem }}</p>
            <div class="row">
              <button class="btn btn-primary" type="submit" :disabled="busy || !!problem">{{ busy ? 'Saving…' : 'Save' }}</button>
              <button class="btn" type="button" :disabled="busy" @click="editing = null">Cancel</button>
            </div>
          </form>
          <button v-else-if="canEditScope(scope)" class="btn-link small add" type="button" :disabled="busy || full(scope)" @click="startAdd(scope)">
            {{ full(scope) ? `At most ${limits.findings} findings` : 'Add a finding' }}
          </button>
        </template>
      </section>

      <section v-if="ws && canWrite" class="card stack" aria-labelledby="research-drafts">
        <h2 id="research-drafts">From text</h2>
        <p class="muted small">
          Paste what you read (a paper's abstract, a video's notes, a forum post, your own test notes) and the workspace's AI turns it into up to
          {{ limits.drafts }} draft findings in the form above. The text is sent as data only, without web access; the evidence level can't go
          beyond what the text itself says, and a source is only kept when the text names it. Check each card, then save or discard it: nothing
          is saved until you do.
        </p>
        <label for="research-paste" class="visually-hidden">Text to turn into findings</label>
        <textarea id="research-paste" v-model="pasted" rows="6" :maxlength="limits.draftText" :disabled="drafting || !aiAvailable" />
        <div class="row">
          <button class="btn" type="button" :disabled="drafting || !aiAvailable || !pasted.trim()" @click="makeDrafts">{{ drafting ? 'Drafting…' : 'Turn into findings' }}</button>
          <span class="muted small">{{ pasted.length }}/{{ limits.draftText }}</span>
        </div>
        <p v-if="!aiAvailable" class="muted small">No AI is set up for this workspace (Settings → AI).</p>
        <p v-if="draftError" class="form-error" role="alert">{{ draftError }}</p>
        <p v-else-if="draftedFrom" class="muted small" aria-live="polite">{{ draftedFrom }}</p>
        <div v-for="(d, i) in drafts" :key="i" class="stack draft">
          <h3>Draft {{ i + 1 }} <span class="badge">Not saved</span></h3>
          <div class="field">
            <label :for="`d-title-${i}`">Title <span class="req" aria-hidden="true">*</span></label>
            <input :id="`d-title-${i}`" v-model="d.title" type="text" :maxlength="limits.title" aria-required="true" />
          </div>
          <div class="field">
            <label :for="`d-text-${i}`">Finding <span class="req" aria-hidden="true">*</span></label>
            <textarea :id="`d-text-${i}`" v-model="d.text" rows="3" :maxlength="limits.text" aria-required="true" />
          </div>
          <fieldset class="field">
            <legend>Levers <span class="req" aria-hidden="true">*</span></legend>
            <div class="levers">
              <label v-for="l in RESEARCH_LEVERS" :key="l" class="checkbox">
                <input type="checkbox" :checked="d.levers.includes(l)" @change="toggleDraftLever(d, l)" />
                {{ LEVER_LABELS[l] }}
              </label>
            </div>
          </fieldset>
          <div class="controls">
            <div class="field">
              <label :for="`d-evidence-${i}`">Evidence</label>
              <select :id="`d-evidence-${i}`" v-model="d.evidence">
                <option v-for="e in OWN_EVIDENCE" :key="e" :value="e">{{ EVIDENCE_LABELS[e] }}</option>
              </select>
            </div>
            <div class="field">
              <label :for="`d-scope-${i}`">Brews</label>
              <select :id="`d-scope-${i}`" v-model="d.scope">
                <option v-for="s in RESEARCH_SCOPES" :key="s" :value="s">{{ SCOPE_LABELS[s] }}</option>
              </select>
            </div>
            <div class="field">
              <label :for="`d-mode-${i}`">Mode</label>
              <select :id="`d-mode-${i}`" v-model="d.mode">
                <option v-for="m in RESEARCH_MODES" :key="m" :value="m">{{ MODE_LABELS[m] }}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label :for="`d-source-${i}`">Source</label>
            <input :id="`d-source-${i}`" :value="d.source ?? ''" type="text" :maxlength="limits.source" placeholder="Not given" @input="d.source = ($event.target as HTMLInputElement).value" />
          </div>
          <p v-if="draftProblem(d)" class="muted small">{{ draftProblem(d) }}</p>
          <div class="row">
            <button class="btn btn-primary" type="button" :disabled="busy || !!draftProblem(d) || full('mine')" @click="saveDraft(i, 'mine')">Save to my findings</button>
            <button v-if="isOwner" class="btn" type="button" :disabled="busy || !!draftProblem(d) || full('workspace')" @click="saveDraft(i, 'workspace')">Save to the workspace</button>
            <button class="btn" type="button" :disabled="busy" @click="discardDraft(i)">Discard</button>
          </div>
        </div>
      </section>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="message" class="muted small" aria-live="polite">{{ message }}</p>
    </template>
    <p v-else class="muted" aria-live="polite">Loading…</p>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
  margin: 0;
}
h3 {
  font-size: 1rem;
  margin: 0;
}
p {
  margin: 0;
}
.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--brand);
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.finding {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.badge {
  margin-left: var(--space-1);
  font-size: 0.75rem;
  font-weight: 600;
  vertical-align: middle;
}
.muted-badge {
  color: var(--text-muted);
}
.controls,
.row,
.levers {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
}
.controls .field {
  flex: 1 1 10rem;
}
.controls .note {
  flex: 2 1 14rem;
}
.field input,
.field select,
.field textarea {
  width: 100%;
}
.levers {
  align-items: center;
}
.edit {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
.add {
  align-self: flex-start;
}
</style>

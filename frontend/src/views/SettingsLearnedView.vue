<script setup lang="ts">
// Settings → Learned preferences (docs/api/auth.md §1d): what the AI has
// learned you like and turn down, sent with your analyses and suggestions.
// Yours only, the same in every workspace. The AI's changes wait here for you
// to accept, unless you let it apply them.
import { computed, onMounted, ref } from 'vue';
import { authApi } from '../api/auth';
import { errorMessage } from '../api/client';
import type { AiPreferences, AiPreferencesSettings, PreferenceProposal } from '../api/types';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useAiAvailable } from '../composables/useAiAvailable';
import { usePreferences } from '../composables/usePreferences';
import { useWorkspaceStore } from '../stores/workspace';
import { useAuthStore } from '../stores/auth';

const workspaces = useWorkspaceStore();
const aiAvailable = useAiAvailable();
const { aiHidden, prefs: userPrefs } = usePreferences();
const auth = useAuthStore();

// Learn about me (docs/api/auth.md §1d): the person's own switch.
const learnOn = computed(() => userPrefs.value.learnAboutMe);
async function setLearn(on: boolean): Promise<void> {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await auth.setPreferences({ learnAboutMe: on });
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
// Your own updates so far, for the average.
const usage = computed(() => {
  const u = prefs.value?.usage;
  return u && u.runs > 0 ? { runs: u.runs, each: Math.round((u.promptTokens + u.completionTokens) / u.runs) } : null;
});

const data = ref<AiPreferencesSettings | null>(null);
const drafts = ref<Array<{ id?: string; text: string }>>([]);
const loadError = ref('');
const busy = ref(false);
const error = ref('');
const message = ref('');

function fill(s: AiPreferencesSettings): void {
  data.value = s;
  drafts.value = s.aiPreferences.items.map((i) => ({ id: i.id, text: i.text }));
}
async function load(): Promise<void> {
  try {
    fill(await authApi.aiPreferences());
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err);
  }
}
onMounted(load);

const prefs = computed(() => data.value?.aiPreferences ?? null);
const byId = computed(() => new Map((prefs.value?.items ?? []).map((i) => [i.id, i])));
const dirty = computed(() => {
  const items = prefs.value?.items ?? [];
  return drafts.value.length !== items.length || drafts.value.some((d, i) => d.id !== items[i]?.id || d.text.trim() !== items[i]?.text);
});
const full = computed(() => drafts.value.length >= (data.value?.limits.items ?? 20));
const learningHere = computed(() => learnOn.value && !!workspaces.current && workspaces.canEdit && aiAvailable.value && !aiHidden.value.includes('learnedPreferences'));

async function run(work: () => Promise<AiPreferencesSettings>, done = ''): Promise<void> {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    fill(await work());
    message.value = done;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
const put = (changes: Partial<Pick<AiPreferences, 'learn' | 'apply'>>, items = drafts.value) => {
  const p = prefs.value;
  if (!p) return Promise.resolve();
  const sent = items.map((d) => ({ ...(d.id ? { id: d.id } : {}), text: d.text.trim() })).filter((d) => d.text);
  return run(() => authApi.setAiPreferences({ learn: changes.learn ?? p.learn, apply: changes.apply ?? p.apply, items: sent }), 'Saved.');
};
// The settings save the list as stored, not unsaved edits.
const saveSetting = (changes: Partial<Pick<AiPreferences, 'learn' | 'apply'>>) => put(changes, (prefs.value?.items ?? []).map((i) => ({ id: i.id, text: i.text })));
const answer = (p: PreferenceProposal, action: 'accept' | 'dismiss') => run(() => authApi.answerProposal(p.id, action));

async function learnNow(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await authApi.learnNow(ws);
    message.value = 'Learning from what you did here. It takes a moment; refresh to see what changed.';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const CHANGE_LABELS = { add: 'Add', edit: 'Change', remove: 'Remove' } as const;
const target = (p: PreferenceProposal) => (p.targetId ? byId.value.get(p.targetId)?.text ?? null : null);
const basisText = (n: number) => (n > 0 ? `from ${n} ${n === 1 ? 'brew or vote' : 'brews and votes'}` : '');
</script>

<template>
  <SettingsLayout title="Learned preferences">
    <p class="muted">
      What the AI has learned you like and turn down, from your likes and dislikes on suggestions, how brews from suggested routes went and your
      brew profile. It goes with your brews' analyses and your Suggest parameters, in every workspace. Edit it as you like; a line you write is
      yours, and the AI only proposes changes to it.
    </p>
    <p v-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
    <template v-else-if="prefs && data">
      <section class="card stack" aria-labelledby="learn-me">
        <h2 id="learn-me">Learn about me</h2>
        <label class="checkbox">
          <input type="checkbox" :checked="learnOn" :disabled="busy" @change="setLearn(($event.target as HTMLInputElement).checked)" />
          Let the AI learn what I like
        </label>
        <p class="muted small">
          Off, nothing is learned, the Feedback links under analyses and suggestions are hidden, and neither your preferences nor your likes and
          dislikes go to the AI. Your list is kept for when you turn it back on. The workspace's own preferences still go.
        </p>
        <p class="muted small">
          Tokens: each update sends about 800–1,500 tokens and gets about 100 back, and your preferences add about 200–400 tokens to each analysis
          and suggestion. Learning after every brew comes to roughly a quarter more than an analysis and a suggestion use on their own.
          <template v-if="usage"> Your {{ usage.runs }} {{ usage.runs === 1 ? 'update has' : 'updates have' }} used about {{ usage.each.toLocaleString() }} tokens each.</template>
        </p>
        <p class="muted small">
          Everything is stored on this server, in your account. It's only sent anywhere when the AI this workspace uses is a hosted one (like OpenAI
          or Anthropic); with a local model it never leaves the server.
        </p>
      </section>

      <section v-if="learnOn" class="card stack" aria-labelledby="learn-how">
        <h2 id="learn-how">How it learns</h2>
        <div class="field">
          <label for="learn-when">Learn</label>
          <select id="learn-when" :value="prefs.learn" :disabled="busy" @change="saveSetting({ learn: ($event.target as HTMLSelectElement).value as AiPreferences['learn'] })">
            <option value="auto">After each like, dislike and analysis</option>
            <option value="manual">Only when I tap Update now</option>
          </select>
        </div>
        <div class="field">
          <label for="learn-apply">Changes</label>
          <select id="learn-apply" :value="prefs.apply" :disabled="busy" @change="saveSetting({ apply: ($event.target as HTMLSelectElement).value as AiPreferences['apply'] })">
            <option value="propose">Wait for me to accept them</option>
            <option value="apply">Apply right away</option>
          </select>
        </div>
        <p class="muted small">Either way, a change that comes from your 👎 applies right away: the dislike is your accepting it.</p>
        <p class="muted small">Each update is one small AI request, made only when there's something new to learn from.</p>
        <div v-if="learningHere" class="row">
          <button class="btn" type="button" :disabled="busy" @click="learnNow">Update now</button>
          <button class="btn-link small" type="button" :disabled="busy" @click="load">Refresh</button>
        </div>
        <p v-else-if="aiHidden.includes('learnedPreferences')" class="muted small">This workspace keeps learned preferences from the AI (Settings → AI), so nothing is learned here.</p>
      </section>

      <section v-if="learnOn && prefs.proposals.length" class="card stack" aria-labelledby="learn-proposals">
        <h2 id="learn-proposals">Proposed changes</h2>
        <div v-for="p in prefs.proposals" :key="p.id" class="proposal">
          <p>
            <span class="badge">{{ CHANGE_LABELS[p.change] }}</span>
            <template v-if="p.change === 'edit'"> <s v-if="target(p)" class="muted">{{ target(p) }}</s> → {{ p.text }}</template>
            <template v-else-if="p.change === 'remove'"> <s>{{ target(p) ?? 'a line that\'s gone' }}</s></template>
            <template v-else> {{ p.text }}</template>
          </p>
          <p class="muted small">{{ p.why }}<template v-if="basisText(p.basis)"> ({{ basisText(p.basis) }})</template></p>
          <div class="row">
            <button class="btn btn-primary small" type="button" :disabled="busy" @click="answer(p, 'accept')">Accept</button>
            <button class="btn small" type="button" :disabled="busy" @click="answer(p, 'dismiss')">Dismiss</button>
          </div>
        </div>
      </section>

      <form class="card stack" aria-labelledby="learn-list" @submit.prevent="put({})">
        <h2 id="learn-list">Your preferences</h2>
        <p v-if="!drafts.length" class="muted small">Nothing yet. Like or dislike suggestions, or add a line of your own.</p>
        <div v-for="(d, i) in drafts" :key="d.id ?? `new-${i}`" class="item">
          <label :for="`pref-${i}`" class="visually-hidden">Preference {{ i + 1 }}</label>
          <input :id="`pref-${i}`" v-model="d.text" type="text" :maxlength="data.limits.text" />
          <span v-if="d.id && byId.get(d.id)" class="muted small">
            {{ byId.get(d.id)!.source === 'person' ? 'Yours' : basisText(byId.get(d.id)!.basis) || 'Learned' }}
          </span>
          <button class="btn-link small" type="button" @click="drafts.splice(i, 1)">Remove</button>
        </div>
        <button class="btn-link small add" type="button" :disabled="full" @click="drafts.push({ text: '' })">Add a line</button>
        <button class="btn btn-primary" type="submit" :disabled="busy || !dirty">{{ busy ? 'Saving…' : 'Save' }}</button>
      </form>

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
p {
  margin: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.proposal,
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
.item input {
  width: 100%;
}
.add {
  align-self: flex-start;
}
</style>

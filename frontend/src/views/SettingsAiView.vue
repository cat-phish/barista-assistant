<script setup lang="ts">
// Settings → AI, for everyone in the workspace; owners change it, everyone
// else sees it:
//  - automatic analysis (docs/api/analysis.md §8): on or off, how long
//    after saving, and a daily cap;
//  - which earlier brews "Suggest parameters" sends by default (§8b);
//  - which details the AI gets (docs/api/llm-contract.md §9, "What the AI sees").
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { AUTO_ANALYZE_DELAYS, MAX_SUGGEST_BREWS, SUGGEST_SOURCES, type AutoAnalyzeDelay, type SuggestSource, type WorkspaceSettings } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { AI_GROUPS, aiDetailsFor, type AiDetail, type AiGroup } from '../lib/aiDetails';
import { SUGGEST_SOURCE_LABELS } from '../lib/suggest';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { aiHidden, settings } = usePreferences();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const saving = ref(false);
const error = ref('');
type Section = AiGroup | 'auto' | 'suggest';
const activeSection = ref<Section | null>(null); // the section last changed
const saved = ref(false);
const GROUPS = Object.keys(AI_GROUPS) as AiGroup[];

// Older stored settings may lack them until the API fills in defaults.
const autoOn = computed(() => settings.value.autoAnalyze ?? false);
const delay = computed(() => settings.value.autoAnalyzeDelayMinutes ?? 10);
const cap = computed(() => settings.value.autoAnalyzeDailyCap ?? null);
const MAX_CAP = 500;
const capDraft = ref('');
watch(cap, (c) => (capDraft.value = String(c ?? 20)), { immediate: true });
const capInvalid = computed(() => {
  const n = Number(capDraft.value);
  return !Number.isInteger(n) || n < 1 || n > MAX_CAP;
});

async function save(changes: Partial<WorkspaceSettings>, section: Section): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  saving.value = true;
  error.value = '';
  saved.value = false;
  activeSection.value = section;
  try {
    await workspacesApi.setSettings(ws, changes);
    await workspaces.load();
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

function setCapped(capped: boolean): void {
  if (capped && capInvalid.value) capDraft.value = '20';
  void save({ autoAnalyzeDailyCap: capped ? Number(capDraft.value) : null }, 'auto');
}
function saveCap(): void {
  if (cap.value !== null && !capInvalid.value && Number(capDraft.value) !== cap.value) void save({ autoAnalyzeDailyCap: Number(capDraft.value) }, 'auto');
}

// Water figures only matter while the water itself is sent.
const disabled = (key: AiDetail) => key === 'waterMinerals' && aiHidden.value.includes('water');

function toggle(key: AiDetail, group: AiGroup, sent: boolean): void {
  const next = sent ? aiHidden.value.filter((k) => k !== key) : [...aiHidden.value, key];
  void save({ aiHidden: next }, group);
}
</script>

<template>
  <SettingsLayout title="AI">
    <section class="card stack" aria-labelledby="ai-auto">
      <h2 id="ai-auto">Automatic analysis</h2>
      <p class="muted">
        Get an AI suggestion for every brew without asking. A rated brew is analyzed a little after it's saved, so a typo can still be fixed
        or a mistake deleted first; one saved to rate later is analyzed once it's rated.
      </p>
      <fieldset class="auto" :disabled="!isOwner || saving">
        <legend class="visually-hidden">Automatic analysis</legend>
        <label class="checkbox">
          <input type="checkbox" :checked="autoOn" @change="save({ autoAnalyze: ($event.target as HTMLInputElement).checked }, 'auto')" />
          Analyze every brew automatically
        </label>
        <template v-if="autoOn">
          <div class="field delay">
            <label for="auto-delay">Wait after saving</label>
            <select id="auto-delay" :value="delay" @change="save({ autoAnalyzeDelayMinutes: Number(($event.target as HTMLSelectElement).value) as AutoAnalyzeDelay }, 'auto')">
              <option v-for="m in AUTO_ANALYZE_DELAYS" :key="m" :value="m">{{ m === 0 ? 'No wait' : `${m} minutes` }}</option>
            </select>
          </div>
          <div class="caps" role="radiogroup" aria-label="Daily limit">
            <label class="checkbox">
              <input type="radio" name="auto-cap" :checked="cap === null" @change="setCapped(false)" />
              No daily limit
            </label>
            <label class="checkbox cap-line">
              <input type="radio" name="auto-cap" :checked="cap !== null" @change="setCapped(true)" />
              Up to
              <input
                v-model="capDraft"
                class="cap"
                type="number"
                inputmode="numeric"
                min="1"
                :max="MAX_CAP"
                aria-label="Automatic analyses a day"
                :aria-invalid="capInvalid"
                :disabled="cap === null"
                @change="saveCap"
              />
              a day
            </label>
            <p v-if="cap !== null && capInvalid" class="form-error small">A whole number from 1 to {{ MAX_CAP }}.</p>
            <p class="muted small">Counts automatic analyses in the last 24 hours. Asking for one yourself always works and doesn't count.</p>
          </div>
        </template>
      </fieldset>
      <p v-if="error && activeSection === 'auto'" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && activeSection === 'auto'" class="muted small" aria-live="polite">Saved.</p>
    </section>

    <section class="card stack" aria-labelledby="ai-suggest">
      <h2 id="ai-suggest">Suggest parameters</h2>
      <p class="muted">
        On the brew page, “Suggest parameters” sends earlier brews to the AI, each with the suggestion it got, and fills in starting values
        for the brew you're making. Pick which brews it starts with; anyone brewing can change it each time.
      </p>
      <fieldset class="suggest" :disabled="!isOwner || saving">
        <legend class="visually-hidden">Suggest parameters defaults</legend>
        <div class="field">
          <label for="suggest-source">Compare with</label>
          <select id="suggest-source" :value="settings.suggestSource" @change="save({ suggestSource: ($event.target as HTMLSelectElement).value as SuggestSource }, 'suggest')">
            <option v-for="src in SUGGEST_SOURCES" :key="src" :value="src">{{ SUGGEST_SOURCE_LABELS[src] }}</option>
          </select>
        </div>
        <div class="field">
          <label for="suggest-max">Up to</label>
          <select id="suggest-max" :value="settings.suggestMaxBrews" @change="save({ suggestMaxBrews: Number(($event.target as HTMLSelectElement).value) }, 'suggest')">
            <option v-for="n in MAX_SUGGEST_BREWS" :key="n" :value="n">{{ n }} {{ n === 1 ? 'brew' : 'brews' }}</option>
          </select>
        </div>
      </fieldset>
      <p v-if="error && activeSection === 'suggest'" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && activeSection === 'suggest'" class="muted small" aria-live="polite">Saved.</p>
    </section>

    <h2 class="what">What the AI sees</h2>
    <p class="muted">
      What the AI gets when it analyzes a brew in {{ workspaces.current?.name }}. Switching a detail off leaves it out of what's sent, and the AI
      won't base advice on it; what's recorded is kept. The bean and roaster names, roast date, dose, water and yield weights, time, grind setting,
      rating and tasting notes are always sent.
    </p>

    <section v-for="group in GROUPS" :key="group" class="card stack" :aria-labelledby="`ai-${group}`">
      <h2 :id="`ai-${group}`">{{ AI_GROUPS[group] }}</h2>
      <fieldset class="details" :disabled="!isOwner || saving">
        <legend class="visually-hidden">{{ AI_GROUPS[group] }}: details sent to the AI</legend>
        <label v-for="d in aiDetailsFor(group)" :key="d.key" class="checkbox detail-choice">
          <input
            type="checkbox"
            :checked="!aiHidden.includes(d.key) && !disabled(d.key)"
            :disabled="disabled(d.key)"
            @change="toggle(d.key, group, ($event.target as HTMLInputElement).checked)"
          />
          <span>
            {{ d.label }}
            <span v-if="d.hint" class="muted small hint">{{ d.hint }}</span>
          </span>
        </label>
      </fieldset>
      <p v-if="error && activeSection === group" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && activeSection === group" class="muted small" aria-live="polite">Saved.</p>
    </section>
    <p v-if="!isOwner" class="muted small">Only owners can change these.</p>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.details {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-2) var(--space-3);
}
.detail-choice {
  align-items: flex-start;
}
.detail-choice > span {
  display: flex;
  flex-direction: column;
}
.hint {
  font-weight: 400;
}
.suggest {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.suggest .field {
  flex: 1 1 12rem;
}
.auto {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.delay {
  max-width: 14rem;
}
.caps {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.cap-line {
  flex-wrap: wrap;
  align-items: center;
}
.cap {
  width: 5rem;
}
.what {
  margin-top: var(--space-2);
}
</style>

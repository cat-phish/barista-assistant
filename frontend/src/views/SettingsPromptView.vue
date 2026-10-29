<script setup lang="ts">
// Settings → Your AI prompt (docs/api/auth.md §1c): instructions of your
// own, added to every AI request made with your prompt (your brews'
// analyses, your Suggest parameters), others for reading bean labels, and
// with Advanced, your own text for any section that isn't locked. Yours
// only, the same in every workspace.
import { computed, onMounted, reactive, ref } from 'vue';
import { authApi } from '../api/auth';
import { errorMessage } from '../api/client';
import type { AiPromptSettings, PromptSectionText } from '../api/types';
import SettingsLayout from '../components/SettingsLayout.vue';

const settings = ref<AiPromptSettings | null>(null);
const instructions = ref('');
const labelInstructions = ref('');
const texts = reactive<Record<string, string>>({}); // section key → what the box shows
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');
const saved = ref(false);

// Advanced: on while you have edited sections; otherwise as you left it here.
const ADVANCED_KEY = 'aiPromptAdvanced';
const advanced = ref(false);
function setAdvanced(on: boolean): void {
  advanced.value = on;
  try {
    localStorage.setItem(ADVANCED_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: just not remembered
  }
}

function fill(s: AiPromptSettings): void {
  settings.value = s;
  instructions.value = s.aiPrompt.instructions ?? '';
  labelInstructions.value = s.aiPrompt.labelInstructions ?? '';
  for (const section of s.sections) texts[section.key] = s.aiPrompt.overrides[section.key] ?? section.text;
}
onMounted(async () => {
  try {
    fill(await authApi.aiPrompt());
  } catch (err) {
    loadError.value = errorMessage(err);
    return;
  }
  let remembered = false;
  try {
    remembered = localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    remembered = false;
  }
  advanced.value = remembered || Object.keys(settings.value?.aiPrompt.overrides ?? {}).length > 0;
});

const edited = (s: PromptSectionText) => !s.locked && texts[s.key]?.trim() !== s.text;
const editedCount = computed(() => settings.value?.sections.filter(edited).length ?? 0);
const PROMPT_NAMES = { analysis: 'Analyses', suggest: 'Suggest parameters', label: 'Reading bean labels' } as const;
const usedFor = (s: PromptSectionText) => s.prompts.map((p) => PROMPT_NAMES[p]).join(', ');
const tooLong = computed(() => {
  const s = settings.value;
  if (!s) return '';
  if (instructions.value.length > s.limits.instructions) return `Your instructions can be up to ${s.limits.instructions} characters.`;
  if (labelInstructions.value.length > s.limits.instructions) return `Your label instructions can be up to ${s.limits.instructions} characters.`;
  const long = s.sections.find((x) => (texts[x.key]?.length ?? 0) > s.limits.section);
  return long ? `“${long.label}” can be up to ${s.limits.section} characters.` : '';
});

async function save(): Promise<void> {
  const s = settings.value;
  if (!s || tooLong.value) return;
  saving.value = true;
  saveError.value = '';
  saved.value = false;
  // A box left empty would be refused: it goes back to the default instead.
  const overrides = Object.fromEntries(s.sections.filter((x) => edited(x) && texts[x.key]?.trim()).map((x) => [x.key, texts[x.key]!.trim()]));
  try {
    fill(
      await authApi.setAiPrompt({ instructions: instructions.value.trim() || null, labelInstructions: labelInstructions.value.trim() || null, overrides }),
    );
    saved.value = true;
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
function reset(s: PromptSectionText): void {
  texts[s.key] = s.text;
  saved.value = false;
}
</script>

<template>
  <SettingsLayout title="Your AI prompt">
    <p class="muted">
      Tune the AI to your taste. This is yours only and the same in every workspace: it's used when your brews are analyzed (by you, someone
      else, or automatically), when you tap Suggest parameters, and when you use Fill in with AI on a bean. Use Preview what's sent next to those buttons to see it in place.
    </p>
    <p v-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
    <form v-else-if="settings" class="stack" @submit.prevent="save">
      <section class="card stack" aria-labelledby="prompt-instructions">
        <h2 id="prompt-instructions">Your instructions</h2>
        <label for="ai-instructions" class="muted small">Added to analyses and Suggest parameters, just before the AI answers: “{{ settings.instructionsIntro }} …”</label>
        <textarea
          id="ai-instructions"
          v-model="instructions"
          rows="5"
          :maxlength="settings.limits.instructions"
          placeholder="e.g. I prefer bright, tea-like cups over body. My kettle runs about 2 °C hot. Keep advice to one change at a time."
          @input="saved = false"
        />
        <p class="muted small counter">{{ instructions.length }} / {{ settings.limits.instructions }}</p>
      </section>

      <section class="card stack" aria-labelledby="prompt-labels">
        <h2 id="prompt-labels">Reading bean labels</h2>
        <label for="ai-label-instructions" class="muted small">
          Added when you use Fill in with AI on the bean form (your brewing instructions above aren't sent there): “{{ settings.labelInstructionsIntro }} …”
        </label>
        <textarea
          id="ai-label-instructions"
          v-model="labelInstructions"
          rows="4"
          :maxlength="settings.limits.instructions"
          placeholder="e.g. My roaster prints the roast date as DD.MM.YY. Put the variety (e.g. Gesha) in the coffee's name."
          @input="saved = false"
        />
        <p class="muted small counter">{{ labelInstructions.length }} / {{ settings.limits.instructions }}</p>
        <p class="muted small">To change what the AI is told about reading labels, edit “Reading a bean label” under Advanced.</p>
      </section>

      <section class="card stack" aria-labelledby="prompt-advanced">
        <h2 id="prompt-advanced">Advanced</h2>
        <label class="checkbox">
          <input type="checkbox" :checked="advanced" @change="setAdvanced(($event.target as HTMLInputElement).checked)" />
          Edit each part of the prompt
          <span v-if="editedCount" class="badge">{{ editedCount }} edited</span>
        </label>
        <template v-if="advanced">
          <p class="muted small">
            The AI's built-in instructions, in the order they're sent. A part is only sent when it applies (the espresso part with espresso, the
            water part when there's a water profile…). Locked parts say what the answer must hold, so the app can read it.
          </p>
          <div v-for="s in settings.sections" :key="s.key" class="section" :class="{ locked: s.locked }">
            <div class="section-head">
              <label :for="`section-${s.key}`"><strong>{{ s.label }}</strong></label>
              <span v-if="s.locked" class="badge">Locked</span>
              <span v-else-if="edited(s)" class="badge edited">Edited</span>
            </div>
            <p class="muted small">{{ usedFor(s) }}</p>
            <p v-if="s.locked" class="locked-text small">{{ s.text }}</p>
            <template v-else>
              <textarea :id="`section-${s.key}`" v-model="texts[s.key]" rows="4" :maxlength="settings.limits.section" @input="saved = false" />
              <button v-if="edited(s)" class="btn-link small" type="button" @click="reset(s)">Reset to default</button>
            </template>
          </div>
        </template>
      </section>

      <p v-if="tooLong" class="form-error" role="alert">{{ tooLong }}</p>
      <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
      <p v-else-if="saved" class="muted small" aria-live="polite">Saved. Your next AI request uses it.</p>
      <button class="btn btn-primary" type="submit" :disabled="saving || !!tooLong">{{ saving ? 'Saving…' : 'Save' }}</button>
    </form>
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
textarea {
  width: 100%;
}
.counter {
  align-self: flex-end;
}
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.locked-text {
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--brand-tint);
  white-space: pre-wrap;
}
.section > .btn-link {
  align-self: flex-start;
}
</style>

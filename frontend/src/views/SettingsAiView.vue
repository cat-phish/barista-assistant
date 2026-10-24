<script setup lang="ts">
// Settings → AI (docs/api/llm-contract.md §9, "What the AI sees"): which
// details the AI gets when it analyzes a brew, for everyone in the
// workspace. Owners change them; everyone else sees them.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import { workspacesApi } from '../api/workspaces';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { AI_GROUPS, aiDetailsFor, type AiDetail, type AiGroup } from '../lib/aiDetails';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const { aiHidden } = usePreferences();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const saving = ref(false);
const error = ref('');
const activeGroup = ref<AiGroup | null>(null); // the section last changed
const saved = ref(false);
const GROUPS = Object.keys(AI_GROUPS) as AiGroup[];

// Water figures only matter while the water itself is sent.
const disabled = (key: AiDetail) => key === 'waterMinerals' && aiHidden.value.includes('water');

async function toggle(key: AiDetail, group: AiGroup, sent: boolean): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  const next = sent ? aiHidden.value.filter((k) => k !== key) : [...aiHidden.value, key];
  saving.value = true;
  error.value = '';
  saved.value = false;
  activeGroup.value = group;
  try {
    await workspacesApi.setSettings(ws, { aiHidden: next });
    await workspaces.load();
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="AI">
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
      <p v-if="error && activeGroup === group" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saved && activeGroup === group" class="muted small" aria-live="polite">Saved.</p>
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
</style>

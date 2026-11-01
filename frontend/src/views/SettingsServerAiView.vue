<script setup lang="ts">
// Settings → Server → AI (docs/api/server.md §10b): what workspaces without
// their own key use, for server admins.
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { serverApi, type ServerAi } from '../api/server';
import AiKeyForm, { type AiKeyValues } from '../components/AiKeyForm.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';

const data = ref<ServerAi | null>(null);
const error = ref('');
const confirming = ref(false);
const understood = ref(false);
const busy = ref(false);

onMounted(async () => {
  try {
    data.value = await serverApi.ai();
  } catch (err) {
    error.value = errorMessage(err);
  }
});

const saved = computed(() => (data.value ? { provider: data.value.provider, keyLast4: data.value.keyLast4, baseUrl: data.value.baseUrl, model: data.value.model, visionModel: data.value.visionModel, webModel: data.value.webModel } : null));
const source = computed(() => (data.value?.keyLast4 ? `the key below, ${data.value.model}` : data.value?.env.configured ? `the server's environment${data.value.env.model ? `, ${data.value.env.model}` : ''}` : null));

async function saveKey(values: AiKeyValues): Promise<void> {
  data.value = await serverApi.saveAi({ enabled: data.value?.enabled ?? true, ...values });
}
async function removeKey(): Promise<void> {
  data.value = await serverApi.removeAi();
}
async function setEnabled(enabled: boolean): Promise<void> {
  if (!data.value) return;
  const { provider, baseUrl, model, visionModel, webModel } = data.value;
  busy.value = true;
  error.value = '';
  try {
    data.value = await serverApi.saveAi({ enabled, provider, baseUrl, model, visionModel, webModel });
    confirming.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
function onSwitch(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.checked) {
    void setEnabled(true);
    return;
  }
  input.checked = true; // until it's confirmed
  understood.value = false;
  confirming.value = true;
}
</script>

<template>
  <SettingsLayout title="AI">
    <p class="muted">What workspaces use when they haven't set their own key. Owners can set one under Settings → AI.</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-if="data">
      <section class="card stack" aria-labelledby="server-ai-offer">
        <h2 id="server-ai-offer">For workspaces</h2>
        <label class="checkbox">
          <input type="checkbox" :checked="data.enabled" :disabled="busy" @change="onSwitch" />
          Offer the server's AI to workspaces
        </label>
        <p class="muted small">
          <template v-if="!data.enabled">Only workspaces with their own key have AI.</template>
          <template v-else-if="source">Workspaces without a key use {{ source }}.</template>
          <template v-else>Nothing is set up yet, so workspaces without a key have no AI.</template>
        </p>
      </section>
      <section class="card stack" aria-labelledby="server-ai-key">
        <h2 id="server-ai-key">Model and key</h2>
        <AiKeyForm id="server-ai" :saved="saved" :can-save-keys="data.canSaveKeys" with-base-url :save="saveKey" :remove="removeKey" :list-models="serverApi.aiModels" :test="serverApi.testAi" />
      </section>
    </template>
    <ConfirmDialog :open="confirming" title="Stop offering the server's AI?" @cancel="confirming = false">
      <p>Every workspace without its own key loses its AI features until this is turned back on.</p>
      <label class="checkbox">
        <input v-model="understood" type="checkbox" />
        I understand
      </label>
      <template #actions>
        <button class="btn btn-danger" type="button" :disabled="busy || !understood" @click="setEnabled(false)">Turn off</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="confirming = false">Cancel</button>
      </template>
    </ConfirmDialog>
  </SettingsLayout>
</template>

<style scoped>
.small {
  font-size: 0.85rem;
}
</style>

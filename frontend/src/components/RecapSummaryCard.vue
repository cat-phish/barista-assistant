<script setup lang="ts">
// A recap's AI summary (docs/api/recaps.md §11c, "AI summary"): written on
// request (Write summary), or by the server when a period ends (recapAi
// "auto"). Polled while it's being written. Shown only when the workspace
// has AI and the person hasn't turned summaries off.
import { computed, onUnmounted, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { recapsApi, type RecapKey, type RecapSummary } from '../api/recaps';
import { formatWhen } from '../lib/format';
import { addDays, periodLabel } from '../lib/recapPeriods';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ recapKey: RecapKey; inProgress: boolean; hasBrews: boolean }>();
// True while it's being asked for or written, so the slides can wait for it.
const emit = defineEmits<{ busy: [boolean] }>();
const workspaces = useWorkspaceStore();

const recap = ref<RecapSummary | null>(null);
const loading = ref(false);
const asking = ref(false);
const error = ref('');
const noun = computed(() => ({ weekly: 'week', monthly: 'month', yearly: 'year', yearInCoffee: 'year' })[props.recapKey.kind]);
const keyText = computed(() => `${props.recapKey.kind}|${props.recapKey.periodStart}|${props.recapKey.scope}`);

let timer: ReturnType<typeof setTimeout> | undefined;
let polls = 0;
const POLL_MS = 3000;
const MAX_POLLS = 60; // three minutes
function stopPolling(): void {
  clearTimeout(timer);
  timer = undefined;
}
function pollIfPending(): void {
  stopPolling();
  if (recap.value?.status !== 'pending' || polls >= MAX_POLLS) return;
  timer = setTimeout(() => {
    polls++;
    void load(true);
  }, POLL_MS);
}

let request = 0;
async function load(quiet = false): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || props.inProgress) {
    recap.value = null;
    return;
  }
  const n = ++request;
  if (!quiet) loading.value = true;
  try {
    const res = await recapsApi.get(ws, props.recapKey);
    if (n !== request) return;
    recap.value = res.recap;
    error.value = '';
    pollIfPending();
  } catch (err) {
    if (n === request) error.value = errorMessage(err);
  } finally {
    if (n === request) loading.value = false;
  }
}
watch(
  [keyText, () => props.inProgress, () => workspaces.current?.id],
  () => {
    stopPolling();
    polls = 0;
    recap.value = null;
    void load();
  },
  { immediate: true },
);
onUnmounted(stopPolling);

async function write(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  asking.value = true;
  error.value = '';
  try {
    recap.value = (await recapsApi.write(ws, props.recapKey)).recap;
    polls = 0;
    pollIfPending();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    asking.value = false;
  }
}

const status = computed(() => recap.value?.status ?? 'none');
// Written for the old week start (docs/api/recaps.md §11c, "After changing
// the week start"): the days it covers, so it isn't taken for this week's.
const oldWeek = computed(() =>
  recap.value && props.recapKey.kind === 'weekly' && recap.value.periodStart !== props.recapKey.periodStart
    ? periodLabel('weekly', { start: recap.value.periodStart, end: addDays(recap.value.periodStart, 6) })
    : null,
);
watch(() => asking.value || status.value === 'pending', (b) => emit('busy', b), { immediate: true });
const canWrite = computed(() => workspaces.canEdit && props.hasBrews && status.value !== 'pending');
</script>

<template>
  <section class="card stack-sm summary" aria-labelledby="recap-summary" aria-live="polite">
    <h3 id="recap-summary">AI summary</h3>
    <p v-if="inProgress" class="muted">A summary can be written once the {{ noun }} ends.</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <template v-else-if="status === 'done' && recap">
      <p class="text">{{ recap.summary }}</p>
      <ul v-if="recap.highlights.length" class="highlights">
        <li v-for="(h, i) in recap.highlights" :key="i">{{ h }}</li>
      </ul>
      <p v-if="oldWeek" class="muted small">Written for {{ oldWeek }}, before your week start changed.</p>
      <p class="muted small">
        Written {{ formatWhen(recap.updatedAt) }}<template v-if="canWrite"> · <button type="button" class="btn-link" :disabled="asking" @click="write">{{ oldWeek ? 'Write one for this week' : 'Rewrite' }}</button></template>
      </p>
    </template>
    <p v-else-if="status === 'pending'" class="muted">Writing the summary…</p>
    <template v-else>
      <p v-if="status === 'failed' && recap?.error" class="form-error">The summary couldn't be written: {{ recap.error }}</p>
      <p v-else-if="!hasBrews" class="muted">Nothing to summarise: no brews in this {{ noun }}.</p>
      <p v-else class="muted">The AI can sum up this {{ noun }}: what went well, what changed, and one thing to try.</p>
      <div v-if="canWrite">
        <button type="button" class="btn btn-secondary" :disabled="asking" @click="write">{{ status === 'failed' ? 'Try again' : 'Write summary' }}</button>
      </div>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.stack-sm {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.stack-sm p {
  margin: 0;
}
h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.text {
  line-height: 1.5;
}
.highlights {
  margin: 0;
  padding-left: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>

// Requests an AI analysis for a brew log and polls until a new one appears
// (docs/api/analysis.md §8). "New" = a different analysis id than before the
// request, which avoids comparing client and server clocks.
import { onUnmounted, ref } from 'vue';
import { analysisApi, brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { LlmAnalysis } from '../api/types';

const POLL_MS = 2000;
const POLL_LIMIT = 45; // ~90 s; failed jobs retry with backoff before giving up

export function useAnalysis() {
  const analysis = ref<LlmAnalysis | null>(null);
  const state = ref<'idle' | 'waiting' | 'done' | 'slow' | 'error'>('idle');
  const error = ref('');
  let timer: number | undefined;

  function stop(): void {
    window.clearTimeout(timer);
  }

  async function request(workspaceId: string, brewLogId: string, previous: LlmAnalysis | null): Promise<void> {
    stop();
    state.value = 'waiting';
    error.value = '';
    try {
      await analysisApi.request(brewLogId);
    } catch (err) {
      state.value = 'error';
      error.value = errorMessage(err);
      return;
    }
    let polls = 0;
    const poll = async () => {
      polls += 1;
      try {
        const latest = (await brewLogsApi.get(workspaceId, brewLogId)).brewLog.latestAnalysis;
        if (latest && latest.id !== previous?.id) {
          analysis.value = latest;
          state.value = 'done';
          return;
        }
      } catch {
        // transient; keep polling until the limit
      }
      if (polls >= POLL_LIMIT) state.value = 'slow';
      else timer = window.setTimeout(poll, POLL_MS);
    };
    timer = window.setTimeout(poll, POLL_MS);
  }

  function reset(): void {
    stop();
    analysis.value = null;
    state.value = 'idle';
    error.value = '';
  }

  onUnmounted(stop);
  return { analysis, state, error, request, reset };
}

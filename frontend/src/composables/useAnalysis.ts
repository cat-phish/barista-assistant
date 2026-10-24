// Requests an AI analysis for a brew log and polls until a new one appears
// (docs/api/analysis.md §8). "New" = a different analysis id than before the
// request, which avoids comparing client and server clocks. awaitAuto waits
// for an automatic one (auto-analyze) the same way, without asking.
import { onUnmounted, ref } from 'vue';
import { analysisApi, brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { LlmAnalysis } from '../api/types';

const POLL_MS = 2000;
const POLL_LIMIT = 45; // ~90 s; failed jobs retry with backoff before giving up

export function useAnalysis() {
  const analysis = ref<LlmAnalysis | null>(null);
  const state = ref<'idle' | 'queued' | 'waiting' | 'done' | 'slow' | 'error'>('idle');
  const error = ref('');
  let timer: number | undefined;

  function stop(): void {
    window.clearTimeout(timer);
  }

  // Until a new analysis appears, or the brew says the last one failed or
  // wasn't made (analysisError, set once every attempt has failed).
  function poll(workspaceId: string, brewLogId: string, previous: LlmAnalysis | null, firstInMs: number): void {
    let polls = 0;
    const tick = async () => {
      polls += 1;
      try {
        const { brewLog } = await brewLogsApi.get(workspaceId, brewLogId);
        const latest = brewLog.latestAnalysis;
        if (latest && latest.id !== previous?.id) {
          analysis.value = latest;
          state.value = 'done';
          return;
        }
        if (brewLog.analysisError && !brewLog.analysisDueAt) {
          state.value = 'error';
          error.value = brewLog.analysisError;
          return;
        }
      } catch {
        // transient; keep polling until the limit
      }
      if (polls >= POLL_LIMIT) state.value = 'slow';
      else timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, firstInMs);
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
    poll(workspaceId, brewLogId, previous, POLL_MS);
  }

  // An automatic analysis due at dueAt (auto-analyze): wait for it without
  // asking, starting to look shortly after it's due. 'queued' until then.
  function awaitAuto(workspaceId: string, brewLogId: string, previous: LlmAnalysis | null, dueAt: string): void {
    stop();
    error.value = '';
    const untilDue = Math.max(0, new Date(dueAt).getTime() - Date.now());
    state.value = untilDue > 0 ? 'queued' : 'waiting';
    timer = window.setTimeout(() => {
      state.value = 'waiting';
      poll(workspaceId, brewLogId, previous, 0);
    }, untilDue + POLL_MS);
  }

  function reset(): void {
    stop();
    analysis.value = null;
    state.value = 'idle';
    error.value = '';
  }

  onUnmounted(stop);
  return { analysis, state, error, request, awaitAuto, reset };
}

// "Suggest parameters" (docs/api/analysis.md §8b): asks for starting values
// for the brew being set up, then polls until the AI has answered or every
// attempt has failed. Like useAnalysis.
import { onUnmounted, ref } from 'vue';
import { suggestionsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import type { ParameterSuggestion, SuggestionRequest } from '../api/types';

const POLL_MS = 1500;
const POLL_LIMIT = 60; // ~90 s; failed jobs retry with backoff before giving up

export function useParameterSuggestion() {
  const suggestion = ref<ParameterSuggestion | null>(null);
  const state = ref<'idle' | 'waiting' | 'done' | 'slow' | 'error'>('idle');
  const error = ref('');
  let timer: number | undefined;
  let request = 0; // answers to an older request are ignored

  function stop(): void {
    window.clearTimeout(timer);
  }

  async function ask(workspaceId: string, body: SuggestionRequest): Promise<void> {
    stop();
    const mine = ++request;
    state.value = 'waiting';
    error.value = '';
    let id: string;
    try {
      id = (await suggestionsApi.request(workspaceId, body)).suggestion.id;
    } catch (err) {
      if (mine !== request) return;
      state.value = 'error';
      error.value = errorMessage(err);
      return;
    }
    let polls = 0;
    const tick = async () => {
      polls += 1;
      try {
        const { suggestion: s } = await suggestionsApi.get(workspaceId, id);
        if (mine !== request) return;
        if (s.status === 'done') {
          suggestion.value = s;
          state.value = 'done';
          return;
        }
        if (s.status === 'failed') {
          state.value = 'error';
          error.value = s.error ?? "The AI couldn't suggest anything this time";
          return;
        }
      } catch {
        // transient; keep polling until the limit
      }
      if (mine !== request) return;
      if (polls >= POLL_LIMIT) state.value = 'slow';
      else timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
  }

  function reset(): void {
    stop();
    request += 1;
    suggestion.value = null;
    state.value = 'idle';
    error.value = '';
  }

  onUnmounted(stop);
  return { suggestion, state, error, ask, reset };
}

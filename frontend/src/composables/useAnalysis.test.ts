import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmAnalysis } from '../api/types';

const api = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('../api/brews', () => ({
  analysisApi: { request: api.request },
  brewLogsApi: { get: api.get },
}));
const { useAnalysis } = await import('./useAnalysis');

const analysis = (id: string): LlmAnalysis => ({
  id, brewLogId: 'log', reasoning: id, suggestedGrindDelta: 'finer', suggestedTempDelta: 1, nextStep: null, confidence: null, suggestedRpmDelta: null, model: null, promptVersion: null, helpful: null, ratedAt: null, createdAt: '',
});
const respond = (latest: LlmAnalysis | null) => ({ brewLog: { latestAnalysis: latest } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis); // the composable uses window.setTimeout
  api.request.mockReset().mockResolvedValue({ status: 'queued' });
  api.get.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAnalysis', () => {
  it('"analyze again" keeps waiting while the previous analysis is still the latest', async () => {
    const old = analysis('old');
    api.get
      .mockResolvedValueOnce(respond(old)) // job not done yet: still the old one
      .mockResolvedValueOnce(respond(old))
      .mockResolvedValueOnce(respond(analysis('new')));
    const ai = useAnalysis();
    await ai.request('ws', 'log', old);
    expect(ai.state.value).toBe('waiting');

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ai.state.value).toBe('waiting'); // two polls returned the old id
    await vi.advanceTimersByTimeAsync(2000);
    expect(ai.state.value).toBe('done');
    expect(ai.analysis.value?.id).toBe('new');
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('a first analysis finishes as soon as one exists', async () => {
    api.get.mockResolvedValueOnce(respond(null)).mockResolvedValueOnce(respond(analysis('first')));
    const ai = useAnalysis();
    await ai.request('ws', 'log', null);
    await vi.advanceTimersByTimeAsync(4000);
    expect(ai.analysis.value?.id).toBe('first');
  });

  it('gives up politely after ~90 s, and reports queueing errors', async () => {
    api.get.mockResolvedValue(respond(null));
    const ai = useAnalysis();
    await ai.request('ws', 'log', null);
    await vi.advanceTimersByTimeAsync(45 * 2000);
    expect(ai.state.value).toBe('slow');
    expect(api.get).toHaveBeenCalledTimes(45);

    const { ApiError } = await import('../api/client');
    api.request.mockRejectedValueOnce(new ApiError(503, 'Analysis is temporarily unavailable.'));
    await ai.request('ws', 'log', null);
    expect(ai.state.value).toBe('error');
    expect(ai.error.value).toBe('Analysis is temporarily unavailable.');
  });
});

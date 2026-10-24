import { describe, expect, it } from 'vitest';
import { analysisStatus } from './analysisStatus';

const log = { analyzed: false, analysisDueAt: null, analysisError: null, steeping: false };

describe('analysisStatus', () => {
  it('not analyzed, with the reason when there is one', () => {
    expect(analysisStatus(log)).toEqual({ kind: 'none', reason: null });
    expect(analysisStatus({ ...log, analysisError: 'The AI service couldn’t be reached' })).toEqual({ kind: 'none', reason: 'The AI service couldn’t be reached' });
  });
  it('due, while an automatic analysis waits (even if an older one exists)', () => {
    expect(analysisStatus({ ...log, analysisDueAt: '2026-10-23T09:15:00Z' })).toEqual({ kind: 'due', at: '2026-10-23T09:15:00Z' });
    expect(analysisStatus({ ...log, analyzed: true, analysisDueAt: '2026-10-23T09:15:00Z' }).kind).toBe('due');
  });
  it('done once analyzed; a steeping brew has nothing to judge', () => {
    expect(analysisStatus({ ...log, analyzed: true }).kind).toBe('done');
    expect(analysisStatus({ ...log, steeping: true }).kind).toBe('steeping');
  });
});

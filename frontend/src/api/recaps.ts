import { api } from './client';
import type { RecapKind } from '../lib/recapPeriods';

// A recap's AI summary (docs/api/recaps.md §11c, "AI summary"). The figures
// are worked out in the browser; only the summary is stored.
export type RecapScope = 'mine' | 'all';
export interface RecapKey {
  kind: RecapKind;
  periodStart: string;
  scope: RecapScope;
}
export interface RecapSummary extends RecapKey {
  status: 'none' | 'pending' | 'done' | 'failed';
  summary: string | null;
  highlights: string[];
  error: string | null;
  updatedAt: string;
}

export const recapsApi = {
  get(workspaceId: string, key: RecapKey) {
    const qs = new URLSearchParams({ kind: key.kind, periodStart: key.periodStart, scope: key.scope });
    return api.get<{ recap: RecapSummary | null }>(`/api/workspaces/${workspaceId}/recaps?${qs.toString()}`);
  },
  write(workspaceId: string, key: RecapKey) {
    return api.post<{ recap: RecapSummary | null }>(`/api/workspaces/${workspaceId}/recaps`, key);
  },
};

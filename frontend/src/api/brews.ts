import { api } from './client';
import type { BrewLog, LlmAnalysis, Mark, ServingUnit, Suggestions } from './types';

export interface BrewLogInput {
  beanId: string;
  recipeId: string | null;
  grinderId: string | null;
  waterProfileId?: string | null; // the water used (§3c)
  drinkId?: string | null; // the drink it was for
  servingSize?: number | null; // the size made; with servingUnit, only with a drink
  servingUnit?: ServingUnit | null;
  marks?: Mark[]; // espresso only; PATCH replaces the list
  toolIds?: string[]; // prep tools used (§3d); PATCH replaces the list
  utcOffsetMinutes?: number | null; // this device's offset, for the local brew date (§6)
  actualDoseGrams: number;
  actualWaterGrams: number | null; // null for espresso
  actualYieldGrams: number | null;
  tdsPercent: number | null; // %
  actualTempC: number | null;
  actualGrindSetting: string | null;
  actualTimeSec: number;
  rating: number | null; // the coffee tasted on its own
  tastingNotes: string | null;
  drinkRating?: number | null; // the finished drink: only with a drinkId
  drinkTastingNotes?: string | null;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/brew-logs`;

export const brewLogsApi = {
  create: (workspaceId: string, input: BrewLogInput) => api.post<{ brewLog: BrewLog }>(base(workspaceId), input),
  get: (workspaceId: string, id: string) =>
    api.get<{ brewLog: BrewLog & { latestAnalysis: LlmAnalysis | null } }>(`${base(workspaceId)}/${id}`),
  list: (workspaceId: string, query: { beanId?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.beanId) params.set('beanId', query.beanId);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return api.get<{ brewLogs: BrewLog[]; total: number }>(`${base(workspaceId)}${qs ? `?${qs}` : ''}`);
  },
  update: (workspaceId: string, id: string, input: Partial<BrewLogInput>) =>
    api.patch<{ brewLog: BrewLog }>(`${base(workspaceId)}/${id}`, input),
  // Also deletes the log's AI analyses (cascade).
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

export const suggestionsApi = {
  forBean: (beanId: string) => api.get<Suggestions>(`/api/beans/${beanId}/suggestions`),
};

export const analysisApi = {
  // Queues an LLM analysis (202). Repeat requests while queued reuse the job (§8).
  request: (brewLogId: string) =>
    api.post<{ status: 'queued'; jobId: string; message: string }>(`/api/brew-logs/${brewLogId}/analyze`),
};

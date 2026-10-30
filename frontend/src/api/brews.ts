import { api } from './client';
import type { AiRequest, BrewLog, DilutionWith, LlmAnalysis, Mark, ParameterSuggestion, ServingUnit, SteepTemp, SuggestionRequest } from './types';

// What happened to a reminder asked for when saving (docs/api/notifications.md §1b).
export type Reminder = 'queued' | 'off' | 'unavailable';

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
  problemIds?: string[]; // what went wrong (§6b); PATCH replaces the list
  flavors?: string[]; // the coffee's flavors, keys from the wheel (§6); PATCH replaces the list
  utcOffsetMinutes?: number | null; // this device's offset, for the local brew date (§6)
  actualDoseGrams: number;
  actualWaterGrams: number | null; // null for espresso
  actualIceGrams: number | null; // flash chilled: ice in the server (no TDS with it)
  actualYieldGrams: number | null;
  tdsPercent: number | null; // %
  actualTempC: number | null;
  actualGrindSetting: number | null; // the dial number
  grindRpm?: number | null; // only with a variable-speed grinder
  beanWeightInGrams?: number | null; // beans weighed before grinding
  groundWeightOutGrams?: number | null; // grounds out: no more than in
  actualTimeSec: number;
  rating: number | null; // the coffee tasted on its own
  tastingNotes: string | null;
  drinkRating?: number | null; // the finished drink: only with a drinkId
  drinkTastingNotes?: string | null;
  remindToRate?: boolean; // POST only: Rate later (docs/api/notifications.md §1b)
  steeping?: boolean; // a long cold brew: true when started, false to finish it
  steepTemp?: SteepTemp | null;
  dilutionRatio?: number | null; // served 1 : dilutionRatio
  dilutedWith?: DilutionWith | null;
  // POST only: the window it aims for, both ends or neither (left out, a
  // steep takes its recipe's).
  steepMinHours?: number | null;
  steepMaxHours?: number | null;
  expectedFinishMinSec?: number | null;
  expectedFinishMaxSec?: number | null;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/brew-logs`;

export const brewLogsApi = {
  // reminder: only when remindToRate was sent (queued, off or unavailable).
  create: (workspaceId: string, input: BrewLogInput) =>
    api.post<{ brewLog: BrewLog; reminder?: Reminder; steepReminder?: Reminder }>(base(workspaceId), input),
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

// "Suggest parameters" (docs/api/analysis.md §8b): ask (202, pending), then poll.
export const suggestionsApi = {
  request: (workspaceId: string, body: SuggestionRequest) =>
    api.post<{ suggestion: ParameterSuggestion }>(`/api/workspaces/${workspaceId}/parameter-suggestions`, body),
  get: (workspaceId: string, id: string) =>
    api.get<{ suggestion: ParameterSuggestion }>(`/api/workspaces/${workspaceId}/parameter-suggestions/${id}`),
  // What was sent to the AI (docs/api/analysis.md §8c).
  sent: (workspaceId: string, id: string) =>
    api.get<{ request: AiRequest | null }>(`/api/workspaces/${workspaceId}/parameter-suggestions/${id}/request`),
  // What asking would send, without asking (§8d).
  preview: (workspaceId: string, body: SuggestionRequest) =>
    api.post<{ request: AiRequest | null }>(`/api/workspaces/${workspaceId}/parameter-suggestions/preview`, body),
};

export const analysisApi = {
  // Queues an LLM analysis (202). Repeat requests while queued reuse the job (§8).
  // note: a one-off note for the AI (docs/api/auth.md §1c).
  request: (brewLogId: string, note?: string) =>
    api.post<{ status: 'queued'; jobId: string; message: string }>(`/api/brew-logs/${brewLogId}/analyze`, note ? { note } : undefined),
  // Was the suggestion useful? null takes the answer back (docs/api/analysis.md §8).
  rateAnalysis: (brewLogId: string, analysisId: string, helpful: boolean | null) =>
    api.put<{ helpful: boolean | null }>(`/api/brew-logs/${brewLogId}/analyses/${analysisId}/feedback`, { helpful }),
  // What was sent to the AI (docs/api/analysis.md §8c).
  sent: (brewLogId: string, analysisId: string) =>
    api.get<{ request: AiRequest | null }>(`/api/brew-logs/${brewLogId}/analyses/${analysisId}/request`),
  // What analyzing would send, without analyzing (§8d).
  preview: (brewLogId: string, note?: string) =>
    api.post<{ request: AiRequest | null }>(`/api/brew-logs/${brewLogId}/analyze/preview`, note ? { note } : undefined),
};

// docs/api/brew-servings.md §6c: servings taken from a cold brew batch, and Batch finished.
import { api } from './client';
import type { BrewLog, BrewServing, DilutionWith } from './types';

export interface BrewServingInput {
  concentrateGrams: number;
  diluentGrams?: number | null;
  dilutedWith?: DilutionWith | null;
  timestamp?: string;
  utcOffsetMinutes?: number | null;
  rating?: number | null;
  tastingNotes?: string | null;
  flavors?: string[];
}

const base = (workspaceId: string, brewLogId: string) => `/api/workspaces/${workspaceId}/brew-logs/${brewLogId}`;

export const servingsApi = {
  list: (ws: string, brewLogId: string) => api.get<{ servings: BrewServing[] }>(`${base(ws, brewLogId)}/servings`),
  create: (ws: string, brewLogId: string, input: BrewServingInput) => api.post<{ serving: BrewServing }>(`${base(ws, brewLogId)}/servings`, input),
  update: (ws: string, brewLogId: string, id: string, input: Partial<BrewServingInput>) =>
    api.patch<{ serving: BrewServing }>(`${base(ws, brewLogId)}/servings/${id}`, input),
  remove: (ws: string, brewLogId: string, id: string) => api.delete(`${base(ws, brewLogId)}/servings/${id}`),
  // Batch finished (true) or reopened (false).
  finishBatch: (ws: string, brewLogId: string, finished: boolean) => api.put<{ brewLog: BrewLog }>(`${base(ws, brewLogId)}/batch`, { finished }),
};

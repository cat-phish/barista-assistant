import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { Grinder, GrinderDetails } from './types';

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/grinders`;

export const grindersApi = {
  list: (workspaceId: string) => api.get<{ grinders: Grinder[] }>(base(workspaceId)),
  create: (workspaceId: string, name: string, details: Partial<GrinderDetails> = {}) =>
    api.post<{ grinder: Grinder }>(base(workspaceId), { name, ...details }),
  update: (workspaceId: string, id: string, input: Partial<GrinderDetails> & { name?: string; archived?: boolean }) =>
    api.patch<{ grinder: Grinder }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink or remove (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  // Unlinks what used it; show usage() in a warning first.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
  // Newest grind setting used with this grinder and recipe, or null.
  lastSetting: (workspaceId: string, id: string, recipeId: string) =>
    api.get<{ lastSetting: { grindSetting: number; grindRpm: number | null; timestamp: string; brewLogId: string } | null }>(
      `${base(workspaceId)}/${id}/last-setting?recipeId=${encodeURIComponent(recipeId)}`,
    ),
};

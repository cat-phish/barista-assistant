import { api } from './client';
import type { Grinder } from './types';

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/grinders`;

export const grindersApi = {
  list: (workspaceId: string) => api.get<{ grinders: Grinder[] }>(base(workspaceId)),
  create: (workspaceId: string, name: string, notes: string | null = null) =>
    api.post<{ grinder: Grinder }>(base(workspaceId), { name, notes }),
  update: (workspaceId: string, id: string, input: { name?: string; notes?: string | null; retired?: boolean }) =>
    api.patch<{ grinder: Grinder }>(`${base(workspaceId)}/${id}`, input),
  // 409 + brewLogCount when brews used it: retire instead (§3b).
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
  // Newest grind setting used with this grinder and recipe, or null.
  lastSetting: (workspaceId: string, id: string, recipeId: string) =>
    api.get<{ lastSetting: { grindSetting: string; timestamp: string; brewLogId: string } | null }>(
      `${base(workspaceId)}/${id}/last-setting?recipeId=${encodeURIComponent(recipeId)}`,
    ),
};

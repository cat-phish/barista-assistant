import { api } from './client';
import type { Workspace, WorkspaceSettings, WorkspaceWithRole } from './types';

export const workspacesApi = {
  list: () => api.get<{ workspaces: WorkspaceWithRole[] }>('/api/workspaces'),
  create: (name: string, slug: string) => api.post<{ workspace: Workspace }>('/api/workspaces', { name, slug }),
  // Owners only (docs/api/workspaces.md §2).
  update: (id: string, input: { name?: string; slug?: string; isPublicMenuEnabled?: boolean }) => api.patch<{ workspace: Workspace }>(`/api/workspaces/${id}`, input),
  // Owners only; any subset, the response is the whole set (§2 settings).
  setSettings: (id: string, changes: Partial<WorkspaceSettings>) =>
    api.patch<{ settings: WorkspaceSettings }>(`/api/workspaces/${id}/settings`, changes),
  // `confirm` is the slug exactly as the owner typed it, never filled in (§2).
  remove: (id: string, confirm: string) => api.delete(`/api/workspaces/${id}?confirm=${encodeURIComponent(confirm)}`),
};

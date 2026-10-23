import { api } from './client';
import type { Workspace, WorkspaceWithRole } from './types';

export const workspacesApi = {
  list: () => api.get<{ workspaces: WorkspaceWithRole[] }>('/api/workspaces'),
  create: (name: string, slug: string) => api.post<{ workspace: Workspace }>('/api/workspaces', { name, slug }),
  // Owners only (docs/api/workspaces.md §2).
  update: (id: string, input: { name?: string; slug?: string; isPublicMenuEnabled?: boolean }) => api.patch<{ workspace: Workspace }>(`/api/workspaces/${id}`, input),
  // `confirm` is the slug exactly as the owner typed it, never filled in (§2).
  remove: (id: string, confirm: string) => api.delete(`/api/workspaces/${id}?confirm=${encodeURIComponent(confirm)}`),
};

import { api } from './client';
import type { Workspace, WorkspaceWithRole } from './types';

export const workspacesApi = {
  list: () => api.get<{ workspaces: WorkspaceWithRole[] }>('/api/workspaces'),
  create: (name: string, slug: string) => api.post<{ workspace: Workspace }>('/api/workspaces', { name, slug }),
};

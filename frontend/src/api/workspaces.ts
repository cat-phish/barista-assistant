import { api } from './client';
import type { AiCheck, AiProvider } from './server';
import type { Workspace, WorkspaceSettings, WorkspaceWithRole } from './types';

// docs/api/workspaces.md §2d: who answers the workspace's AI jobs.
export interface AiConfig {
  available: boolean;
  source: 'workspace' | 'server' | 'env' | null;
  model: string | null;
  own: { provider: AiProvider; keyLast4: string; model: string; visionModel: string | null; webModel: string | null } | null; // owners only
  canSaveKeys: boolean;
}
export interface AiConfigInput {
  provider: AiProvider;
  apiKey?: string;
  model: string;
  visionModel?: string | null;
  webModel?: string | null;
}

export const workspacesApi = {
  aiConfig: (id: string) => api.get<AiConfig>(`/api/workspaces/${id}/ai-config`),
  saveAiConfig: (id: string, input: AiConfigInput) => api.put<AiConfig>(`/api/workspaces/${id}/ai-config`, input),
  removeAiConfig: (id: string) => api.delete<AiConfig>(`/api/workspaces/${id}/ai-config`),
  aiModels: (id: string) => api.post<AiCheck>(`/api/workspaces/${id}/ai-config/models`),
  testAi: (id: string) => api.post<AiCheck>(`/api/workspaces/${id}/ai-config/test`),
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

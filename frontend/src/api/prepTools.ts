import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { MethodKind, PrepTool } from './types';

// docs/api/prep-tools.md §3d
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/prep-tools`;

export const prepToolsApi = {
  // In checklist order, archived ones included.
  list: (workspaceId: string) => api.get<{ tools: PrepTool[] }>(base(workspaceId)),
  // New ones go last; 409 when the name is taken.
  create: (workspaceId: string, input: { name: string; methodKinds: MethodKind[]; brewerIds: string[] }) =>
    api.post<{ tool: PrepTool }>(base(workspaceId), input),
  // brewerIds replaces the tool's brewers.
  update: (workspaceId: string, id: string, input: { name?: string; methodKinds?: MethodKind[]; brewerIds?: string[]; archived?: boolean }) =>
    api.patch<{ tool: PrepTool }>(`${base(workspaceId)}/${id}`, input),
  // Every tool of the workspace (archived too), in the new order.
  reorder: (workspaceId: string, toolIds: string[]) => api.put<{ tools: PrepTool[] }>(`${base(workspaceId)}/order`, { toolIds }),
  // What a delete would unlink or remove (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  // Unlinks what used it; show usage() in a warning first.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

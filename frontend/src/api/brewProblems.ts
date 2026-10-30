import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { BrewProblem, MethodKind } from './types';

// docs/api/brew-problems.md §6b
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/brew-problems`;

export const brewProblemsApi = {
  // In list order, archived ones included.
  list: (workspaceId: string) => api.get<{ problems: BrewProblem[] }>(base(workspaceId)),
  // New ones go last; 409 when the name is taken.
  create: (workspaceId: string, input: { name: string; methodKind: MethodKind | null }) =>
    api.post<{ problem: BrewProblem }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: { name?: string; methodKind?: MethodKind | null; archived?: boolean }) =>
    api.patch<{ problem: BrewProblem }>(`${base(workspaceId)}/${id}`, input),
  // Every problem of the workspace (archived too), in the new order.
  reorder: (workspaceId: string, problemIds: string[]) => api.put<{ problems: BrewProblem[] }>(`${base(workspaceId)}/order`, { problemIds }),
  // How many brews recorded it, for the delete warning.
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  // Unlinks the brews that had it; show usage() in a warning first.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

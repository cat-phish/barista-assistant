import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { Brewer } from './types';

// docs/api/brewers.md §3
export type BrewerInput = Partial<Omit<Brewer, 'id' | 'archivedAt'>>;

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/brewers`;

export const brewersApi = {
  // Active first, then archived; each by name.
  list: (workspaceId: string) => api.get<{ brewers: Brewer[] }>(base(workspaceId)),
  create: (workspaceId: string, input: BrewerInput & Pick<Brewer, 'name'>) => api.post<{ brewer: Brewer }>(base(workspaceId), input),
  // 409 when the kind would change while recipes use it, or the name is taken.
  update: (workspaceId: string, id: string, input: BrewerInput & { archived?: boolean }) =>
    api.patch<{ brewer: Brewer }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink or remove (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  // Unlinks what used it; show usage() in a warning first.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

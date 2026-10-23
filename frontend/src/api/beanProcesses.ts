import { api } from './client';
import type { BeanProcess } from './types';
import type { Usage } from '../lib/deleting';

// docs/api/bean-processes.md §4b. Listing is for any member; changes are for
// owners and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/bean-processes`;

export const beanProcessesApi = {
  list: (workspaceId: string) => api.get<{ processes: BeanProcess[] }>(base(workspaceId)),
  create: (workspaceId: string, name: string) => api.post<{ process: BeanProcess }>(base(workspaceId), { name }),
  update: (workspaceId: string, id: string, changes: { name?: string; hidden?: boolean }) =>
    api.patch<{ process: BeanProcess }>(`${base(workspaceId)}/${id}`, changes),
  reorder: (workspaceId: string, processIds: string[]) => api.put<{ processes: BeanProcess[] }>(`${base(workspaceId)}/order`, { processIds }),
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`), // custom ones only
};

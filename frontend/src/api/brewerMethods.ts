import { api } from './client';
import type { BrewerMethod, MethodKind } from './types';
import type { Usage } from '../lib/deleting';

// docs/api/brewer-methods.md §3e. Listing is for any member; changes are for
// owners and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/brewer-methods`;

export const brewerMethodsApi = {
  list: (workspaceId: string) => api.get<{ methods: BrewerMethod[] }>(base(workspaceId)),
  create: (workspaceId: string, name: string, behaviour: MethodKind) => api.post<{ method: BrewerMethod }>(base(workspaceId), { name, behaviour }),
  // 409 when a behaviour change would change brewers that recipes use.
  update: (workspaceId: string, id: string, changes: { name?: string; hidden?: boolean; behaviour?: MethodKind }) =>
    api.patch<{ method: BrewerMethod }>(`${base(workspaceId)}/${id}`, changes),
  reorder: (workspaceId: string, methodIds: string[]) => api.put<{ methods: BrewerMethod[] }>(`${base(workspaceId)}/order`, { methodIds }),
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`), // custom ones only; brewers move to the built-in
};

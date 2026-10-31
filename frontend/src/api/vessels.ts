import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { Vessel, VesselInput } from './types';

// docs/api/vessels.md §3g. Listing is for any member; changes are for owners
// and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/vessels`;

export const vesselsApi = {
  list: (workspaceId: string) => api.get<{ vessels: Vessel[] }>(base(workspaceId)),
  create: (workspaceId: string, input: VesselInput) => api.post<{ vessel: Vessel }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<VesselInput> & { archived?: boolean }) =>
    api.patch<{ vessel: Vessel }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { RoastingMachine, RoastingMachineInput } from './types';

// docs/api/roasting-machines.md §3f. Listing is for any member; changes are
// for owners and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/roasting-machines`;

export const roastingMachinesApi = {
  list: (workspaceId: string) => api.get<{ machines: RoastingMachine[] }>(base(workspaceId)),
  create: (workspaceId: string, input: RoastingMachineInput) => api.post<{ machine: RoastingMachine }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<RoastingMachineInput> & { archived?: boolean }) =>
    api.patch<{ machine: RoastingMachine }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

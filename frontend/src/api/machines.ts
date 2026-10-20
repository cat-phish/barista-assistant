import { api } from './client';
import type { Machine, MachineCapabilities } from './types';

// docs/api_spec.md §3c
export type MachineInput = Partial<MachineCapabilities> & { name?: string; notes?: string | null };

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/machines`;

export const machinesApi = {
  list: (workspaceId: string) => api.get<{ machines: Machine[] }>(base(workspaceId)),
  create: (workspaceId: string, input: MachineInput & { name: string }) => api.post<{ machine: Machine }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: MachineInput & { retired?: boolean }) =>
    api.patch<{ machine: Machine }>(`${base(workspaceId)}/${id}`, input),
  // 409 + brewLogCount when brews used it: retire instead.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { WaterProfile, WaterProfileDetails } from './types';

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/water-profiles`;

// docs/api/water-profiles.md §3c
export const waterProfilesApi = {
  list: (workspaceId: string) => api.get<{ waterProfiles: WaterProfile[] }>(base(workspaceId)),
  create: (workspaceId: string, input: Partial<WaterProfileDetails> & { name: string }) =>
    api.post<{ waterProfile: WaterProfile }>(base(workspaceId), input),
  // isDefault: true makes it the only default; archived: true also clears it.
  update: (workspaceId: string, id: string, input: Partial<WaterProfileDetails> & { name?: string; archived?: boolean }) =>
    api.patch<{ waterProfile: WaterProfile }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink or remove (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  // Unlinks what used it; show usage() in a warning first.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

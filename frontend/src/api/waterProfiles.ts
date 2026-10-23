import { api } from './client';
import type { WaterProfile, WaterProfileDetails } from './types';

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/water-profiles`;

// docs/api/water-profiles.md §3c
export const waterProfilesApi = {
  list: (workspaceId: string) => api.get<{ waterProfiles: WaterProfile[] }>(base(workspaceId)),
  create: (workspaceId: string, input: Partial<WaterProfileDetails> & { name: string }) =>
    api.post<{ waterProfile: WaterProfile }>(base(workspaceId), input),
  // isDefault: true makes it the only default; retired: true also clears it.
  update: (workspaceId: string, id: string, input: Partial<WaterProfileDetails> & { name?: string; retired?: boolean }) =>
    api.patch<{ waterProfile: WaterProfile }>(`${base(workspaceId)}/${id}`, input),
  // 409 + brewLogCount when brews used it: retire instead.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

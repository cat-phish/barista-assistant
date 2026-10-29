import { api } from './client';
import type { Roast, RoastInput } from './types';

// docs/api/roasts.md §4f. Listing is for any member; changes are for owners
// and baristas. Saving a roast creates its bean.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/roasts`;

export const roastsApi = {
  list: (workspaceId: string) => api.get<{ roasts: Roast[] }>(base(workspaceId)),
  get: (workspaceId: string, id: string) => api.get<{ roast: Roast }>(`${base(workspaceId)}/${id}`),
  create: (workspaceId: string, input: RoastInput) => api.post<{ roast: Roast }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<RoastInput>) => api.patch<{ roast: Roast }>(`${base(workspaceId)}/${id}`, input),
  // Gives back the green weight it took; its bean stays.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

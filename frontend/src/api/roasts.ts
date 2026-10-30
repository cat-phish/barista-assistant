import type { Reminder } from './brews';
import { api } from './client';
import type { Roast, RoastInput } from './types';

// docs/api/roasts.md §4f. Listing is for any member; changes are for owners
// and baristas. Saving a roast creates its bean.
// A saved roast, and its rest reminder while it's still resting (docs/api/notifications.md §1b).
export interface SavedRoast {
  roast: Roast;
  restReminder?: Reminder;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/roasts`;

export const roastsApi = {
  list: (workspaceId: string) => api.get<{ roasts: Roast[] }>(base(workspaceId)),
  get: (workspaceId: string, id: string) => api.get<{ roast: Roast }>(`${base(workspaceId)}/${id}`),
  create: (workspaceId: string, input: RoastInput) => api.post<SavedRoast>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<RoastInput>) => api.patch<SavedRoast>(`${base(workspaceId)}/${id}`, input),
  // Gives back the green weight it took; its bean stays.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

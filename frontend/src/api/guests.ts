import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { Guest, GuestInput } from './types';

// docs/api/guests.md §2d. Listing is for any member; changes are for owners
// and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/guests`;

export const guestsApi = {
  list: (workspaceId: string) => api.get<{ guests: Guest[] }>(base(workspaceId)),
  create: (workspaceId: string, input: GuestInput) => api.post<{ guest: Guest }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<GuestInput> & { archived?: boolean }) =>
    api.patch<{ guest: Guest }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

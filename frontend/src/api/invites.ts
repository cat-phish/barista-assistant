import { api } from './client';
import type { Role } from './types';

// docs/api/workspaces.md §2 "Invites"
export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}
export interface MyInvite {
  id: string;
  workspace: { name: string; slug: string };
  role: Role;
  invitedBy: string | null;
  createdAt: string;
}

export const invitesApi = {
  mine: () => api.get<{ invites: MyInvite[] }>('/api/invites'),
  accept: (id: string) => api.post<{ workspace: { id: string; name: string; slug: string }; role: Role }>(`/api/invites/${id}/accept`),
  decline: (id: string) => api.delete(`/api/invites/${id}`),
  forWorkspace: (workspaceId: string) => api.get<{ invites: PendingInvite[] }>(`/api/workspaces/${workspaceId}/invites`),
  cancel: (workspaceId: string, id: string) => api.delete(`/api/workspaces/${workspaceId}/invites/${id}`),
};

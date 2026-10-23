import { api } from './client';
import type { Member, Role } from './types';

// docs/api/workspaces.md §2 Members. Listing is for any member; adding,
// changing roles and removing others are for owners; anyone can remove
// themselves (leave).
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/members`;

export const membersApi = {
  list: (workspaceId: string) => api.get<{ members: Member[] }>(base(workspaceId)),
  add: (workspaceId: string, email: string, role: Role) => api.post<{ member: Member }>(base(workspaceId), { email, role }),
  setRole: (workspaceId: string, userId: string, role: Role) => api.patch<{ member: Member }>(`${base(workspaceId)}/${userId}`, { role }),
  remove: (workspaceId: string, userId: string) => api.delete(`${base(workspaceId)}/${userId}`),
};

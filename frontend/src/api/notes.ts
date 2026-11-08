import { api } from './client';
import type { Note } from './types';

// docs/api/notes.md §3h
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/notes`;

export const notesApi = {
  // Pinned first (most recently pinned first), then the most recently changed.
  list: (workspaceId: string) => api.get<{ notes: Note[] }>(base(workspaceId)),
  // 409 when the title is taken.
  create: (workspaceId: string, input: { title: string; body: string }) => api.post<{ note: Note }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: { title?: string; body?: string; pinned?: boolean }) =>
    api.patch<{ note: Note }>(`${base(workspaceId)}/${id}`, input),
  // Nothing uses a note: no usage, nothing unlinked.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

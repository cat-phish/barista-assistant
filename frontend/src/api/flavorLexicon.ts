import { api } from './client';
import type { WorkspaceLexicon } from './types';

// docs/api/flavor-lexicon.md §2c
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/flavor-lexicon`;

export const flavorLexiconApi = {
  // The workspace's wheel: its own, or the built-in one.
  get: (workspaceId: string) => api.get<WorkspaceLexicon>(base(workspaceId)),
  // Owners: replace it with a lexicon file (400 says what's wrong, and where).
  replace: (workspaceId: string, lexicon: unknown) => api.put<WorkspaceLexicon>(base(workspaceId), lexicon),
  // Owners: back to the built-in wheel.
  reset: (workspaceId: string) => api.delete<WorkspaceLexicon>(base(workspaceId)),
};

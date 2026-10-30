import { api } from './client';
import type { MethodKind, RecipeStyle, RecipeStyleItem } from './types';
import type { Usage } from '../lib/deleting';

// docs/api/recipe-styles.md §5e. Listing is for any member; changes are for
// owners and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/recipe-styles`;

export const recipeStylesApi = {
  list: (workspaceId: string) => api.get<{ styles: RecipeStyleItem[] }>(base(workspaceId)),
  create: (workspaceId: string, kind: MethodKind, name: string, brewsLike: RecipeStyle) =>
    api.post<{ style: RecipeStyleItem }>(base(workspaceId), { kind, name, brewsLike }),
  update: (workspaceId: string, id: string, changes: { name?: string; hidden?: boolean; brewsLike?: RecipeStyle }) =>
    api.patch<{ style: RecipeStyleItem }>(`${base(workspaceId)}/${id}`, changes),
  reorder: (workspaceId: string, kind: MethodKind, styleIds: string[]) =>
    api.put<{ styles: RecipeStyleItem[] }>(`${base(workspaceId)}/order`, { kind, styleIds }),
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`), // custom ones only
};

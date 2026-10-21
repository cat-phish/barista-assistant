import { api } from './client';
import type { DrinkCategory } from './types';

// docs/api/drink-categories.md §5d
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/drink-categories`;

export const drinkCategoriesApi = {
  list: (workspaceId: string) => api.get<{ categories: DrinkCategory[] }>(base(workspaceId)),
  // New ones go last; 409 when the name is taken.
  create: (workspaceId: string, name: string) => api.post<{ category: DrinkCategory }>(base(workspaceId), { name }),
  rename: (workspaceId: string, id: string, name: string) => api.patch<{ category: DrinkCategory }>(`${base(workspaceId)}/${id}`, { name }),
  // Every category of the workspace, in the new order.
  reorder: (workspaceId: string, categoryIds: string[]) => api.put<{ categories: DrinkCategory[] }>(`${base(workspaceId)}/order`, { categoryIds }),
  // Its drinks and brewers become uncategorised.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

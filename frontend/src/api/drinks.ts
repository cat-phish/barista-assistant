import { api } from './client';
import type { Drink } from './types';

// docs/api_spec.md §5c
export interface DrinkInput {
  name: string;
  description: string | null;
  category: string | null;
  showOnPublicMenu: boolean;
  recipeIds: string[]; // 1-20
  defaultRecipeId: string | null; // one of recipeIds; null = the first
  components: Array<{ componentId: string; amount: string | null; note: string | null }>;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/drinks`;

export const drinksApi = {
  list: (workspaceId: string) => api.get<{ drinks: Drink[] }>(base(workspaceId)),
  // Categories in use, for suggestions.
  categories: (workspaceId: string) => api.get<{ categories: string[] }>(`${base(workspaceId)}/categories`),
  create: (workspaceId: string, input: DrinkInput) => api.post<{ drink: Drink }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<DrinkInput>) => api.patch<{ drink: Drink }>(`${base(workspaceId)}/${id}`, input),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

import { api } from './client';
import type { Ingredient, IngredientType } from './types';

// docs/api/ingredients.md §5b
export interface IngredientInput {
  name: string;
  ingredientType: IngredientType;
  instructions: string | null;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ingredients`;

export const ingredientsApi = {
  list: (workspaceId: string) => api.get<{ ingredients: Ingredient[] }>(base(workspaceId)),
  create: (workspaceId: string, input: IngredientInput) => api.post<{ ingredient: Ingredient }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<IngredientInput> & { archived?: boolean }) =>
    api.patch<{ ingredient: Ingredient }>(`${base(workspaceId)}/${id}`, input),
  // 409 + drinkCount while drinks use it.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

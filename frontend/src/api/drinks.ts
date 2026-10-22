import { api } from './client';
import type { Drink, MethodKind, ServingUnit } from './types';

// docs/api/drinks.md §5c
export interface DrinkInput {
  name: string;
  description: string | null;
  kind: MethodKind;
  categoryId: string | null;
  parentDrinkId: string | null; // a variant of this drink
  defaultRecipeId: string | null; // a recipe on a brewer of this kind
  servingSize: number | null; // with servingUnit: both or neither
  servingUnit: ServingUnit | null;
  instructions: string | null; // how to make it, shown after the brew
  ingredients: Array<{ ingredientId: string; amountValue: number | null; amountUnit: string | null; note: string | null }>;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/drinks`;

export const drinksApi = {
  list: (workspaceId: string) => api.get<{ drinks: Drink[] }>(base(workspaceId)),
  create: (workspaceId: string, input: DrinkInput) => api.post<{ drink: Drink }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<DrinkInput>) => api.patch<{ drink: Drink }>(`${base(workspaceId)}/${id}`, input),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

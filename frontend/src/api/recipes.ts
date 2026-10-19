import { api } from './client';
import type { BrewMethod, Recipe } from './types';

// Request body for create/update (docs/api_spec.md §5).
export interface RecipeInput {
  name: string;
  methodId: string;
  targetDoseGrams: number;
  targetYieldGrams: number;
  targetTempC: number | null;
  targetGrindSetting: string | null;
  showOnPublicMenu: boolean;
  steps: Array<{ actionName: string; targetTimeSec: number; targetWaterGrams: number }>;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/recipes`;

export const recipesApi = {
  list: (workspaceId: string) => api.get<{ recipes: Recipe[] }>(base(workspaceId)),
  create: (workspaceId: string, input: RecipeInput) => api.post<{ recipe: Recipe }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<RecipeInput>) =>
    api.patch<{ recipe: Recipe }>(`${base(workspaceId)}/${id}`, input),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};

export const brewMethodsApi = {
  list: (workspaceId: string) =>
    api.get<{ brewMethods: BrewMethod[] }>(`/api/workspaces/${workspaceId}/brew-methods`),
  create: (workspaceId: string, name: string) =>
    api.post<{ brewMethod: BrewMethod }>(`/api/workspaces/${workspaceId}/brew-methods`, { name }),
};

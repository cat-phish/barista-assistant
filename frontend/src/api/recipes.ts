import { api } from './client';
import type { BrewMethod, MethodKind, Recipe, StepType } from './types';

// Request body for create/update (docs/api_spec.md §5).
export interface RecipeInput {
  name: string;
  methodId: string;
  targetDoseGrams: number;
  targetWaterGrams: number | null; // null for espresso
  expectedYieldGrams: number | null; // required for espresso
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  firstDropMinSec: number | null; // espresso only
  firstDropMaxSec: number | null;
  targetTempC: number | null;
  showOnPublicMenu: boolean;
  grindSettings: Array<{ grinderId: string; setting: string }>;
  steps: Array<{ stepType: StepType; label: string | null; startSec: number; endSec: number; targetWaterGrams: number | null }>;
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
  create: (workspaceId: string, name: string, kind: MethodKind) =>
    api.post<{ brewMethod: BrewMethod }>(`/api/workspaces/${workspaceId}/brew-methods`, { name, kind }),
};

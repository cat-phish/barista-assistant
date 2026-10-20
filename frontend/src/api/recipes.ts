import { api } from './client';
import type { BrewMethod, FlowUnit, MethodKind, Recipe, StepFields } from './types';

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
  defaultGrinderId: string | null;
  grindSettings: Array<{ grinderId: string; setting: string }>;
  flowUnit: FlowUnit;
  steps: StepFields[];
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
  // 409 when the kind would change while recipes use it, or the name is taken (§3).
  update: (workspaceId: string, id: string, input: { name?: string; kind?: MethodKind }) =>
    api.patch<{ brewMethod: BrewMethod }>(`/api/workspaces/${workspaceId}/brew-methods/${id}`, input),
  // 409 + recipeCount while recipes use it.
  remove: (workspaceId: string, id: string) => api.delete(`/api/workspaces/${workspaceId}/brew-methods/${id}`),
};

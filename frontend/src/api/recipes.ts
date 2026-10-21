import { api } from './client';
import type { FlowUnit, Recipe, RecipeStyle, StepFields } from './types';

// Request body for create/update (docs/api_spec.md §5).
export interface RecipeInput {
  name: string;
  brewerId: string;
  targetDoseGrams: number;
  targetWaterGrams: number | null; // null for espresso
  expectedYieldGrams: number | null; // required for espresso
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  firstDropMinSec: number | null; // espresso only
  firstDropMaxSec: number | null;
  targetTempC: number | null;
  defaultGrinderId: string | null;
  grindSettings: Array<{ grinderId: string; setting: string }>;
  flowUnit: FlowUnit;
  style: RecipeStyle | null;
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


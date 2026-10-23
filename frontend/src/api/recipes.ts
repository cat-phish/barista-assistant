import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { FlowUnit, Recipe, StepFields } from './types';

// Request body for create/update (docs/api/recipes.md §5).
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
  styleId: string | null; // docs/api/recipe-styles.md §5e
  steps: StepFields[];
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/recipes`;

export const recipesApi = {
  list: (workspaceId: string) => api.get<{ recipes: Recipe[] }>(base(workspaceId)),
  create: (workspaceId: string, input: RecipeInput) => api.post<{ recipe: Recipe }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<RecipeInput> & { archived?: boolean }) =>
    api.patch<{ recipe: Recipe }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink or remove (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  // Unlinks what used it; show usage() in a warning first.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};


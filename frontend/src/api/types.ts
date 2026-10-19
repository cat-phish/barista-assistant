// Response shapes from docs/api_spec.md. Dates arrive as ISO strings;
// decimals as numbers (§0).

export type Role = 'owner' | 'barista' | 'viewer';

export interface User {
  id: string;
  email: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  isPublicMenuEnabled: boolean;
  createdAt: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: Role;
}

// Every error response has at least { error } (§0).
export interface ErrorBody {
  error: string;
  [extra: string]: unknown;
}

export interface BrewMethod {
  id: string;
  name: string;
}

// docs/api_spec.md §3b
export interface Grinder {
  id: string;
  name: string;
  notes: string | null;
  retiredAt: string | null; // set = retired (hidden from pickers, kept in history)
}

export interface Bean {
  id: string;
  workspaceId: string;
  roasterName: string;
  beanName: string;
  process: string | null;
  roastDate: string | null; // ISO datetime at midnight UTC
  inventoryWeightGrams: number;
  showOnPublicMenu: boolean;
  freezePeriods: FreezePeriod[]; // oldest first; last with thawedOn null = frozen now
}

export interface FreezePeriod {
  id: string;
  frozenOn: string; // YYYY-MM-DD
  thawedOn: string | null;
}

export interface RecipeStep {
  id: string;
  stepOrder: number;
  actionName: string;
  targetTimeSec: number; // cumulative
  targetWaterGrams: number; // cumulative scale weight
}

export interface Recipe {
  id: string;
  workspaceId: string;
  name: string;
  method: BrewMethod;
  targetDoseGrams: number;
  targetYieldGrams: number;
  targetTempC: number | null;
  targetGrindSetting: string | null;
  showOnPublicMenu: boolean;
  steps: RecipeStep[];
}

export type GrindDelta = 'much_finer' | 'finer' | 'no_change' | 'coarser' | 'much_coarser';

export interface LlmAnalysis {
  id: string;
  brewLogId: string;
  reasoning: string;
  suggestedGrindDelta: GrindDelta;
  suggestedTempDelta: number;
  createdAt: string;
}

// docs/api_spec.md §6
export interface BrewLog {
  id: string;
  workspaceId: string;
  userId: string | null;
  beanId: string;
  recipeId: string | null;
  grinderId: string | null;
  timestamp: string;
  actualDoseGrams: number;
  actualYieldGrams: number;
  actualTempC: number | null;
  actualGrindSetting: string | null;
  actualTimeSec: number;
  rating: number | null;
  tastingNotes: string | null;
  bean: { id: string; roasterName: string; beanName: string };
  recipe: { id: string; name: string } | null;
  grinder: { id: string; name: string } | null;
  brewer: { id: string; email: string } | null;
}

// docs/api_spec.md §8
export interface Suggestions {
  latestAnalysis: LlmAnalysis | null;
  analyzedBrew: BrewLog | null;
  recentBrews: BrewLog[];
}

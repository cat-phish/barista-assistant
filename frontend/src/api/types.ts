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

// docs/schema.md METHOD_KINDS: decides the recipe fields and timer (docs/api_spec.md §3).
export type MethodKind = 'pour_over' | 'immersion' | 'espresso';

export interface BrewMethod {
  id: string;
  name: string;
  kind: MethodKind;
}

// docs/api_spec.md §3b
export interface Grinder {
  id: string;
  name: string;
  notes: string | null;
  retiredAt: string | null; // set = retired (hidden from pickers, kept in history)
}

// docs/schema.md ROAST_LEVELS
export type RoastLevel = 'light' | 'medium_light' | 'medium' | 'medium_dark' | 'dark';

export interface Bean {
  id: string;
  workspaceId: string;
  roasterName: string;
  beanName: string;
  process: string | null;
  roastLevel: RoastLevel | null;
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

// docs/api_spec.md §5
export type StepType = 'bloom' | 'pour' | 'swirl' | 'stir' | 'wait' | 'press' | 'other';

export interface RecipeStep {
  id: string;
  stepOrder: number;
  stepType: StepType;
  label: string | null;
  startSec: number;
  endSec: number;
  targetWaterGrams: number | null; // cumulative "pour to" weight (water steps)
}

export interface RecipeGrindSetting {
  grinderId: string;
  grinderName: string;
  setting: string; // approximate starting point for that grinder
}

export interface Recipe {
  id: string;
  workspaceId: string;
  name: string;
  method: BrewMethod;
  targetDoseGrams: number;
  targetWaterGrams: number | null; // null for espresso
  expectedYieldGrams: number | null; // estimate; for espresso the target shot weight (always set)
  expectedFinishMinSec: number | null; // target finish (shot time) window (both or neither)
  expectedFinishMaxSec: number | null;
  firstDropMinSec: number | null; // espresso only (both or neither)
  firstDropMaxSec: number | null;
  targetTempC: number | null;
  showOnPublicMenu: boolean;
  grindSettings: RecipeGrindSetting[];
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
  actualWaterGrams: number | null; // null for espresso
  actualYieldGrams: number | null; // measured beverage weight
  actualTempC: number | null;
  actualGrindSetting: string | null;
  actualTimeSec: number;
  rating: number | null;
  tastingNotes: string | null;
  bean: { id: string; roasterName: string; beanName: string };
  recipe: { id: string; name: string; expectedYieldGrams: number | null; methodKind: MethodKind } | null;
  grinder: { id: string; name: string } | null;
  brewer: { id: string; email: string } | null;
}

// docs/api_spec.md §8
export interface Suggestions {
  latestAnalysis: LlmAnalysis | null;
  analyzedBrew: BrewLog | null;
  recentBrews: BrewLog[];
}

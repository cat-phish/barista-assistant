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
// docs/api_spec.md §3b: details are optional (null when unknown).
export type GrinderAdjustment = 'stepped' | 'stepless';
export type BurrType = 'conical' | 'flat';
export type GrinderPower = 'manual' | 'electric';
export interface GrinderDetails {
  notes: string | null;
  adjustment: GrinderAdjustment | null;
  settingMin: number | null; // dial range: both or neither
  settingMax: number | null;
  stepSize: number | null;
  burrType: BurrType | null;
  burrSizeMm: number | null;
  power: GrinderPower | null;
}
export interface Grinder extends GrinderDetails {
  id: string;
  name: string;
  retiredAt: string | null; // set = retired (hidden from pickers, kept in history)
}

// docs/api_spec.md §3c
export type Preinfusion = 'none' | 'automatic' | 'manual';
export type ProfileControl = 'none' | 'manual' | 'programmable';
export interface MachineCapabilities {
  preinfusion: Preinfusion;
  flowControl: ProfileControl;
  pressureControl: ProfileControl;
}
export interface Machine extends MachineCapabilities {
  id: string;
  name: string;
  notes: string | null;
  retiredAt: string | null;
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
// docs/api_spec.md §5: which types a recipe can use depends on its method's kind.
export type StepType =
  | 'bloom' | 'pour' | 'swirl' | 'stir' | 'wait' | 'press' // pour over / immersion
  | 'preinfusion' | 'soak' | 'pressure' | 'flow' // espresso
  | 'other';
// How the timer moves on: auto (after the duration), auto_log (plus a "Log it"
// button), tap (waits for Next), first_drop (espresso: waits for First drop).
export type StepAdvance = 'auto' | 'auto_log' | 'tap' | 'first_drop';
export type FlowUnit = 'g_s' | 'ml_s';

// docs/api_spec.md §6: when things actually happened.
export type MarkKind = 'first_drop' | 'step_end';
export interface Mark {
  kind: MarkKind;
  stepOrder: number | null; // step_end only: which step (1-based)
  atSec: number; // seconds from the start, 0.1 s
}

// Steps run back to back; each starts when the previous one actually ended.
export interface StepFields {
  stepType: StepType;
  label: string | null;
  durationSec: number | null; // null: last step = until you finish; tap/first_drop = no guide
  advance: StepAdvance;
  targetWaterGrams: number | null; // cumulative "pour to" weight (water steps)
  targetTempC: number | null;
  pressureBar: number | null; // espresso; an end value makes a ramp
  pressureEndBar: number | null;
  flowRate: number | null; // in the recipe's flowUnit
  flowEndRate: number | null;
}
export interface RecipeStep extends StepFields {
  id: string;
  stepOrder: number;
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
  flowUnit: FlowUnit;
  targetTempC: number | null;
  showOnPublicMenu: boolean;
  defaultGrinderId: string | null; // preselected when brewing this recipe
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
  machineId: string | null; // espresso only
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
  machine: { id: string; name: string } | null;
  marks: Mark[]; // earliest first; espresso only
  brewer: { id: string; email: string } | null;
}

// docs/api_spec.md §8
export interface Suggestions {
  latestAnalysis: LlmAnalysis | null;
  analyzedBrew: BrewLog | null;
  recentBrews: BrewLog[];
}

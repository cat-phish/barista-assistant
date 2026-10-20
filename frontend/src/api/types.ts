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

// docs/api_spec.md §3: what makes the coffee (V60, AeroPress, an espresso
// machine). Capabilities apply to espresso brewers only ("none" otherwise).
export interface Brewer extends MachineCapabilities {
  id: string;
  name: string;
  kind: MethodKind;
  notes: string | null;
  // Menu fields: the plain brew ("V60") on the public menu (§3, §7), and the
  // category that groups it there and when brewing.
  menuName: string | null; // shown instead of name, e.g. "Espresso"
  description: string | null;
  categoryId: string | null;
  showOnPublicMenu: boolean;
  retiredAt: string | null; // set = retired (hidden from pickers, kept in history)
}
// How recipes, drinks and brew logs refer to their brewer.
export type BrewerRef = Pick<Brewer, 'id' | 'name' | 'kind'>;

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

// docs/api_spec.md §3: espresso brewers' capabilities.
export type Preinfusion = 'none' | 'automatic' | 'manual';
export type ProfileControl = 'none' | 'manual' | 'programmable';
export interface MachineCapabilities {
  preinfusion: Preinfusion;
  flowControl: ProfileControl;
  pressureControl: ProfileControl;
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
  brewer: BrewerRef;
  targetDoseGrams: number;
  targetWaterGrams: number | null; // null for espresso
  expectedYieldGrams: number | null; // estimate; for espresso the target shot weight (always set)
  expectedFinishMinSec: number | null; // target finish (shot time) window (both or neither)
  expectedFinishMaxSec: number | null;
  firstDropMinSec: number | null; // espresso only (both or neither)
  firstDropMaxSec: number | null;
  flowUnit: FlowUnit;
  targetTempC: number | null;
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
  brewerId: string | null; // the recipe's brewer at brew time (set by the API)
  drinkId: string | null; // the drink it was for
  servingSize: number | null; // the size made, when the drink was scaled
  servingUnit: ServingUnit | null;
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
  brewer: BrewerRef | null; // retired ones included
  drink: { id: string; name: string } | null;
  marks: Mark[]; // earliest first; espresso only
  brewedBy: { id: string; email: string } | null;
}

// docs/api_spec.md §8
export interface Suggestions {
  latestAnalysis: LlmAnalysis | null;
  analyzedBrew: BrewLog | null;
  recentBrews: BrewLog[];
}

// docs/api_spec.md §5b: reusable preps that finish a drink.
export type IngredientType = 'milk' | 'foam' | 'syrup' | 'ice' | 'water' | 'other';
export interface Ingredient {
  id: string;
  name: string;
  ingredientType: IngredientType;
  instructions: string | null;
  drinkCount: number; // drinks that use it
}

// docs/api_spec.md §5c: a drink's default size, and the size a brew was made at.
export type ServingUnit = 'fl_oz' | 'ml';
export interface DrinkIngredient {
  ingredientId: string;
  name: string;
  ingredientType: IngredientType;
  amountValue: number | null; // for the drink's default size
  amountUnit: string | null; // 'fl oz', 'ml', 'g' or free text ('pump')
  note: string | null;
}

// docs/api_spec.md §5d: ordered sections for drinks and brewers (menu and brew setup).
export interface DrinkCategory {
  id: string;
  name: string;
  position: number;
}

// docs/api_spec.md §5c: what's served. Built on one brewer; any recipe
// of that method can make it. A variant is an independent copy that
// remembers its parent (Vanilla Latte of Latte).
export interface Drink {
  id: string;
  name: string;
  description: string | null;
  brewer: BrewerRef;
  category: { id: string; name: string } | null;
  parent: { id: string; name: string } | null;
  variants: Array<{ id: string; name: string }>; // direct variants, by name
  showOnPublicMenu: boolean;
  defaultRecipeId: string | null; // a recipe of the method, or null
  servingSize: number | null; // default size; both or neither
  servingUnit: ServingUnit | null;
  ingredients: DrinkIngredient[];
}

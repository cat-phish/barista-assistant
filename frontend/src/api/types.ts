// Response shapes from docs/api/README.md. Dates arrive as ISO strings;
// decimals as numbers (§0).

export type Role = 'owner' | 'barista' | 'viewer';

// Display preferences, per person (docs/api/auth.md §1). Storage is always
// grams, °C and metres; these only change what's shown and typed.
export type VolumeUnit = 'fl_oz' | 'ml';
export type AltitudeUnit = 'm' | 'ft';
export type TemperatureUnit = 'c' | 'f';
export type Theme = 'system' | 'light' | 'dark';
export interface UserPreferences {
  volumeUnit: VolumeUnit;
  showBothVolumes: boolean;
  altitudeUnit: AltitudeUnit;
  temperatureUnit: TemperatureUnit;
  theme: Theme;
}

export interface User {
  id: string;
  email: string;
  preferences: UserPreferences;
}

// Per workspace, owners edit (docs/api/workspaces.md §2 settings).
export type RoastScale = 'names' | 'levels';
export interface WorkspaceSettings {
  recipeRoastLevel: RoastLevel; // the roast recipes are written for
  roastScale: RoastScale; // beans record roast names (Cinnamon … French) or light to dark only
}

// docs/api/workspaces.md §2 Members
export interface Member {
  userId: string;
  email: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  isPublicMenuEnabled: boolean;
  settings: WorkspaceSettings; // defaults filled in
  createdAt: string;
}

// docs/api/menu.md §7b: the menu builder.
export type MenuItemType = 'drink' | 'brewer' | 'beans';
export interface MenuItem {
  id: string;
  itemType: MenuItemType;
  drinkId: string | null;
  brewerId: string | null;
  name: string | null; // override; null = the source's
  description: string | null;
  price: number | null; // in Menu.currency
  available: boolean;
  // What it shows by default; null for the beans block. archived: left off the public menu.
  source: { name: string; description: string | null; kind: MethodKind; method: string; archived: boolean } | null; // method: how it's made (a brewer's method name)
  beanFields: BeanMenuField[] | null; // the beans block: what guests see per bean; null = all
}
// docs/api/menu.md §7b BEAN_MENU_FIELDS: what the beans block can show per bean.
export type BeanMenuField =
  | 'flavorProfile' | 'origin' | 'producer' | 'altitude' | 'process' | 'roastLevel' | 'roastDate' | 'decaf' | 'blendType' | 'roastType';
export interface MenuSection {
  id: string;
  name: string;
  description: string | null;
  position: number;
  items: MenuItem[];
}
export interface Menu {
  title: string | null; // the public menu's title; null = the workspace name
  currency: string | null;
  sections: MenuSection[];
}

// docs/api/public-menu.md §7: the menu as guests see it (also the builder's preview).
// A bean has its roaster and name, plus only the details its block shows.
export type PublicBean = Pick<Bean, 'id' | 'roasterName' | 'beanName'> &
  Partial<
    { process: string | null } & Pick< // process: the process's name
      Bean,
      | 'roastDate' | 'roastLevel' | 'detailedRoastLevel' | 'roastType' | 'blendType' | 'decaf'
      | 'flavorProfile' | 'originArea' | 'country' | 'region' | 'altitudeMasl' | 'producer'
    >
  >;
export interface PublicMenuItem {
  type: 'drink' | 'brewer';
  id: string;
  name: string;
  description: string | null;
  method: string; // "Espresso", "Filter"
  variantOf: string | null; // the parent's menu name, when it's on the menu too
  ingredients: string[];
  price: number | null;
  available: boolean;
}
export interface PublicBeansBlock {
  type: 'beans';
  fields: BeanMenuField[];
  beans: PublicBean[];
}
export interface PublicMenu {
  title: string; // the menu's title, else the workspace name
  workspace: { name: string; slug: string };
  currency: string | null;
  sections: Array<{ name: string; description: string | null; items: Array<PublicMenuItem | PublicBeansBlock> }>;
}

export interface WorkspaceWithRole extends Workspace {
  role: Role;
}

// Every error response has at least { error } (§0).
export interface ErrorBody {
  error: string;
  [extra: string]: unknown;
}

// docs/schema.md METHOD_KINDS: decides the recipe fields and timer (docs/api/brewers.md §3).
// The brew method: decides recipe fields, steps, the timer, and which drinks a
// brewer can make. A recipe's style says how the cup is brewed (descriptive).
// Brewers are grouped by method (no category); categories are for drinks.
export type MethodKind = 'filter' | 'espresso' | 'stovetop' | 'other';
// The built-in style keys (docs/schema.md STYLES_BY_KIND).
export type RecipeStyle = 'pour_over' | 'immersion' | 'hybrid' | 'cold_brew' | 'standard' | 'soup' | 'moka' | 'ibrik' | 'other';
// docs/api/recipe-styles.md §5e: the workspace's styles, a list per method.
// brewsLike: the built-in it brews like (itself for a built-in), which
// extraction yield and the AI go by.
export interface RecipeStyleItem {
  id: string;
  kind: MethodKind;
  name: string;
  position: number;
  hidden: boolean;
  builtin: RecipeStyle | null; // null = added by the workspace
  brewsLike: RecipeStyle;
}
// A recipe's style, as recipes and brew logs carry it.
export type StyleRef = Pick<RecipeStyleItem, 'id' | 'name' | 'brewsLike'>;

// docs/api/brewers.md §3: what makes the coffee (V60, AeroPress, an espresso
// machine). Capabilities apply to espresso brewers only ("none" otherwise).
export interface Brewer extends MachineCapabilities {
  id: string;
  name: string;
  kind: MethodKind; // its method's behaviour: recipe fields, timer, drinks, tools
  methodId: string | null; // the workspace's method it's grouped under (docs/api/brewer-methods.md §3e)
  notes: string | null;
  archivedAt: string | null; // set = archived (hidden from pickers, kept in history)
  createdAt: string; // date added (ISO)
}
// docs/api/brewer-methods.md §3e: how the workspace groups its brewers. A
// custom method behaves like a built-in one (behaviour = the brewers' kind).
export interface BrewerMethod {
  id: string;
  name: string;
  position: number;
  hidden: boolean; // left out of the brewer form's choices
  builtin: MethodKind | null; // null = added by the workspace
  behaviour: MethodKind;
}
// How recipes, drinks and brew logs refer to their brewer.
export type BrewerRef = Pick<Brewer, 'id' | 'name' | 'kind'>;

// docs/api/grinders.md §3b
// docs/api/grinders.md §3b: details are optional (null when unknown).
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
  archivedAt: string | null; // set = archived (hidden from pickers, kept in history)
  createdAt: string; // date added (ISO)
}

// docs/api/water-profiles.md §3c: every figure in mg/L (ppm), GH and KH as CaCO3.
export const WATER_FIGURES = [
  'tdsPpm', 'generalHardnessPpm', 'alkalinityPpm', 'calciumPpm', 'magnesiumPpm', 'sodiumPpm',
  'potassiumPpm', 'bicarbonatePpm', 'chloridePpm', 'sulfatePpm',
] as const;
export type WaterFigure = (typeof WATER_FIGURES)[number];
export type WaterProfileDetails = Record<WaterFigure, number | null> & {
  notes: string | null;
  ph: number | null;
  isDefault: boolean; // at most one per workspace; new brews start on it
};
export interface WaterProfile extends WaterProfileDetails {
  id: string;
  name: string;
  archivedAt: string | null; // set = archived (hidden from pickers, kept in history)
  createdAt: string;
}

// docs/api/prep-tools.md §3d: ordered; methodKind null = every method.
export interface PrepTool {
  id: string;
  name: string;
  methodKind: MethodKind | null;
  position: number;
  archivedAt: string | null; // set = archived (off the checklist, kept in history)
  createdAt: string;
}
export type PrepToolRef = Pick<PrepTool, 'id' | 'name' | 'methodKind'>;

// docs/api/brewers.md §3: espresso brewers' capabilities.
export type Preinfusion = 'none' | 'automatic' | 'manual';
export type ProfileControl = 'none' | 'manual' | 'programmable';
export interface MachineCapabilities {
  preinfusion: Preinfusion;
  flowControl: ProfileControl;
  pressureControl: ProfileControl;
}

// docs/schema.md ROAST_LEVELS
export type RoastLevel = 'light' | 'medium_light' | 'medium' | 'medium_dark' | 'dark';
// docs/schema.md ROAST_TYPES, DETAILED_ROAST_LEVELS, BLEND_TYPES
export type RoastType = 'filter' | 'espresso' | 'omni';
export type DetailedRoastLevel =
  | 'cinnamon' | 'american' | 'new_england' | 'half_city' | 'modern_light' | 'city'
  | 'city_plus' | 'full_city' | 'full_city_plus' | 'italian' | 'vienna' | 'french';
export type BlendType = 'single_origin' | 'blend' | 'other';
// docs/schema.md ORIGIN_AREAS
export type OriginArea = 'africa' | 'arabia' | 'central_america' | 'south_america' | 'asia' | 'pacific';
// docs/schema.md BEAN_PROCESSES: the built-in keys
export type BeanProcessKey =
  | 'washed' | 'natural' | 'wet_hulled' | 'honey' | 'mechanically_washed' | 'anaerobic'
  | 'carbonic_maceration' | 'co_fermentation' | 'thermal_shock' | 'lactic';
// docs/api/bean-processes.md §4b: the workspace's editable list.
export interface BeanProcess {
  id: string;
  name: string;
  position: number;
  hidden: boolean; // left out of the bean form's choices
  builtin: BeanProcessKey | null; // null = added by the workspace
}

export interface Bean {
  id: string;
  workspaceId: string;
  roasterName: string;
  beanName: string;
  processId: string | null; // one of the workspace's processes
  roastLevel: RoastLevel | null; // set by the API from detailedRoastLevel when known
  roastDate: string | null; // ISO datetime at midnight UTC
  inventoryWeightGrams: number;
  showOnPublicMenu: boolean;
  roastType: RoastType | null;
  detailedRoastLevel: DetailedRoastLevel | null;
  blendType: BlendType | null;
  decaf: boolean;
  website: string | null; // http(s)
  priceAmount: number | null; // one bag, with priceCurrency (both or neither)
  priceCurrency: string | null; // ISO 4217, e.g. "USD"
  bagWeightGrams: number | null;
  notes: string | null;
  flavorProfile: string | null;
  originArea: OriginArea | null;
  country: string | null;
  region: string | null; // within the country, e.g. Yirgacheffe
  altitudeMasl: number | null; // metres
  producer: string | null;
  purchaseDate: string | null; // YYYY-MM-DD
  greenSupplier: string | null;
  rating: number | null; // 1-5
  archivedAt: string | null; // null = active
  createdAt: string;
  freezePeriods: FreezePeriod[]; // oldest first; one with thawedOn null = frozen now
  frozen: boolean; // a period is open (from the API, worked out from freezePeriods)
}

export interface FreezePeriod {
  id: string;
  frozenOn: string; // YYYY-MM-DD
  thawedOn: string | null;
}

// docs/api/recipes.md §5
// docs/api/recipes.md §5: which types a recipe can use depends on its method's kind.
export type StepType =
  | 'bloom' | 'pour' | 'swirl' | 'stir' | 'wait' | 'press' // filter
  | 'preinfusion' | 'soak' | 'pressure' | 'flow' // espresso
  | 'other';
// How the timer moves on: auto (after the duration), auto_log (plus a "Log it"
// button), tap (waits for Next), first_drop (espresso: waits for First drop).
export type StepAdvance = 'auto' | 'auto_log' | 'tap' | 'first_drop';
export type FlowUnit = 'g_s' | 'ml_s';

// docs/api/brew-logs.md §6: when things actually happened.
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
  style: StyleRef | null; // one of the workspace's styles for brewer.kind
  targetTempC: number | null;
  defaultGrinderId: string | null; // preselected when brewing this recipe
  archivedAt: string | null; // set = archived: off the brew page and drink forms (§5)
  createdAt: string; // date added (ISO)
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

// docs/api/brew-logs.md §6
export interface BrewLog {
  id: string;
  workspaceId: string;
  userId: string | null;
  beanId: string;
  recipeId: string | null;
  grinderId: string | null;
  waterProfileId: string | null; // the water used (§3c)
  brewerId: string | null; // the recipe's brewer at brew time (set by the API)
  drinkId: string | null; // the drink it was for
  servingSize: number | null; // the size made, when the drink was scaled
  servingUnit: ServingUnit | null;
  timestamp: string;
  utcOffsetMinutes: number | null; // the logging device's, minutes (-420 = PDT)
  actualDoseGrams: number;
  actualWaterGrams: number | null; // null for espresso
  actualYieldGrams: number | null; // measured beverage weight
  tdsPercent: number | null; // refractometer reading; extraction yield is worked out (lib/extraction.ts)
  actualTempC: number | null;
  actualGrindSetting: string | null;
  actualTimeSec: number;
  rating: number | null; // the coffee tasted on its own
  tastingNotes: string | null;
  drinkRating: number | null; // the finished drink (drink brews only)
  drinkTastingNotes: string | null;
  bean: { id: string; roasterName: string; beanName: string };
  recipe: { id: string; name: string; expectedYieldGrams: number | null; style: StyleRef | null; methodKind: MethodKind } | null;
  grinder: { id: string; name: string } | null;
  waterProfile: { id: string; name: string } | null; // archived ones included
  brewer: BrewerRef | null; // archived ones included
  drink: { id: string; name: string; hasIngredients: boolean } | null; // hasIngredients: shot and drink tasted apart
  marks: Mark[]; // earliest first; espresso only
  tools: PrepToolRef[]; // prep tools used, in checklist order (§3d)
  brewedBy: { id: string; email: string } | null;
}

// docs/api/analysis.md §8
export interface Suggestions {
  latestAnalysis: LlmAnalysis | null;
  analyzedBrew: BrewLog | null;
  recentBrews: BrewLog[];
}

// docs/api/ingredients.md §5b: reusable preps that finish a drink.
export type IngredientType = 'milk' | 'foam' | 'syrup' | 'ice' | 'water' | 'other';
export interface Ingredient {
  id: string;
  name: string;
  ingredientType: IngredientType;
  instructions: string | null;
  drinkCount: number; // drinks that use it
  archivedAt: string | null; // set = archived: not offered for new drinks (§5b)
  createdAt: string; // date added (ISO)
}

// docs/api/drinks.md §5c: a drink's default size, and the size a brew was made at.
export type ServingUnit = 'fl_oz' | 'ml';
export interface DrinkIngredient {
  ingredientId: string;
  name: string;
  ingredientType: IngredientType;
  amountValue: number | null; // for the drink's default size
  amountUnit: string | null; // 'fl oz', 'ml', 'g' or free text ('pump')
  note: string | null;
}

// docs/api/drink-categories.md §5d: ordered sections for drinks and brewers (menu and brew setup).
export interface DrinkCategory {
  id: string;
  name: string;
  position: number;
}

// docs/api/drinks.md §5c: what's served. Needs a kind of coffee, not a device:
// any brewer of that kind, with its recipes, can make it. A variant is an
// independent copy that remembers its parent (Vanilla Latte of Latte).
export interface Drink {
  id: string;
  name: string;
  description: string | null;
  kind: MethodKind; // the kind of coffee it needs: any brewer of this kind can make it
  category: { id: string; name: string } | null;
  parent: { id: string; name: string } | null;
  variants: Array<{ id: string; name: string }>; // direct variants, by name
  defaultRecipeId: string | null; // a recipe of the method, or null
  servingSize: number | null; // default size; both or neither
  servingUnit: ServingUnit | null;
  instructions: string | null; // how to make it, shown after the brew
  archivedAt: string | null; // set = archived: off the brew page (§5c)
  createdAt: string; // date added (ISO)
  ingredients: DrinkIngredient[];
}

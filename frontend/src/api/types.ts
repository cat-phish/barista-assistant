// Response shapes from docs/api/README.md. Dates arrive as ISO strings;
// decimals as numbers (§0).
import type { AiDetail } from '../lib/aiDetails';

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
  rateReminders: boolean; // offer Rate later and send its reminders (docs/api/notifications.md §1b)
  rateReminderMinutes: number; // 5–240
  rateLaterDefault: boolean; // the log form's Rate later box starts ticked
  repeatKeeps: RepeatKeep[]; // what a repeat copies (lib/repeatBrew.ts REPEAT_OPTIONS)
  rememberSetup: RememberKey[]; // what the brew page remembers from last time (lib/rememberSetup.ts)
  startDelays: Partial<Record<MethodKind, 0 | 3 | 5>>; // countdown before a timed brew, per method; missing = none (docs/api/auth.md §1)
  steepReminders: boolean; // remind when a cold brew's steep window opens
  restReminders: boolean; // remind the morning a home roast is ready to brew
  greenStockAlerts: boolean; // tell when a roast takes a green coffee below its low-stock threshold
}
export type RepeatKeep = 'size' | 'doseWater' | 'temp' | 'grinder' | 'grind' | 'waterProfile' | 'dilution' | 'window' | 'prepTools' | 'grinderWeights' | 'notes';
export type RememberKey = 'what' | 'brewer' | 'recipe' | 'bean' | 'grinder' | 'grind' | 'waterProfile' | 'prepTools' | 'size';

// docs/api/notifications.md §1b: a person's own reminder channels.
export type NotificationKind = 'ntfy' | 'gotify' | 'pushover' | 'discord' | 'telegram' | 'slack' | 'webhook';
export interface NotificationChannel {
  kind: NotificationKind;
  enabled: boolean;
  config: Record<string, string | null>; // credentials come back masked ("••••1234")
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  preferences: UserPreferences;
  isAdmin: boolean; // a server admin: sees Settings → Server (docs/api/server.md §10)
}

// Per workspace, owners edit (docs/api/workspaces.md §2 settings).
export type RoastScale = 'names' | 'levels';
export type RatingStep = 'whole' | 'half';
export type LabelWebContext = 'low' | 'medium' | 'high'; // how much of each page the web search reads
export interface WorkspaceSettings {
  recipeRoastLevel: RoastLevel; // the roast recipes are written for
  roastScale: RoastScale; // beans record roast names (Cinnamon … French) or light to dark only
  ratingStep: RatingStep; // ratings are entered in whole or half stars (stored in 0.5 steps either way)
  hiddenFields: string[]; // optional form fields hidden for everyone (lib/fields.ts keys)
  aiHidden: AiDetail[]; // what the AI doesn't get (lib/aiDetails.ts, llm-contract.md §9)
  // Auto-analyze (analysis.md §8): each rated brew this long after saving, at most cap a day.
  autoAnalyze: boolean;
  autoAnalyzeDelayMinutes: AutoAnalyzeDelay;
  autoAnalyzeDailyCap: number | null; // null: no cap
  // "Suggest parameters" (analysis.md §8b): the brews it sends by default, at most how many.
  suggestSource: SuggestSource;
  suggestMaxBrews: number;
  suggestAlternatives: AlternativeKind[]; // what else it suggests by default
  readLabels: boolean; // "Fill in with AI" on the bean form (bean-label.md §4d)
  labelWebLookup: boolean; // its "Also look it up on the web" (off by default)
  labelWebContext: LabelWebContext; // default 'high'
  // Home roasting (workspaces.md §2): the Brew | Roast switch and roast mode.
  homeRoasting: boolean;
  homeRoasterName: string; // the roaster name on beans roasts create
  restDays: Record<RoastType, number>; // days a roast rests, by roast type (0–60)
}
export const MAX_REST_DAYS = 60;
export const AUTO_ANALYZE_DELAYS = [0, 5, 10, 15, 30] as const;
export type AutoAnalyzeDelay = (typeof AUTO_ANALYZE_DELAYS)[number];
// The earlier brews "Suggest parameters" sends (docs/api/analysis.md §8b);
// the same list as @barista/shared/schema (lib/suggest.test.ts checks).
export const SUGGEST_SOURCES = ['bag', 'bagRecipe', 'bagBrewer', 'bean', 'beanRecipe', 'beanBrewer', 'brewer', 'recipe'] as const;
export type SuggestSource = (typeof SUGGEST_SOURCES)[number];
export const MAX_SUGGEST_BREWS = 20;
// What else Suggest parameters can suggest (analysis.md §8b); the same list
// as @barista/shared/schema (lib/suggest.test.ts checks).
export const SUGGEST_ALTERNATIVES = ['recipe', 'brewer', 'bean'] as const;
export type AlternativeKind = (typeof SUGGEST_ALTERNATIVES)[number];
// The row it names, by id, and its name when suggested (a restored backup's
// ids may not be this workspace's).
export interface SuggestedAlternative {
  kind: AlternativeKind;
  id: string;
  name: string;
  why: string;
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
  | 'flavorProfile' | 'origin' | 'producer' | 'altitude' | 'variety' | 'process' | 'roastLevel' | 'roastDate' | 'decaf' | 'blendType' | 'roastType';
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
      | 'flavorProfile' | 'originArea' | 'country' | 'region' | 'altitudeMasl' | 'producer' | 'varieties' | 'species'
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
export type RecipeStyle = 'pour_over' | 'immersion' | 'hybrid' | 'cold_brew' | 'rapid_cold' | 'kyoto_drip' | 'standard' | 'soup' | 'moka' | 'ibrik' | 'other';
// Cold styles (docs/api/recipes.md §5): fridge or room steep, and what the concentrate is served with.
export type SteepTemp = 'fridge' | 'room';
export type DilutionWith = 'water' | 'milk' | 'ice' | 'other';
export interface ColdFields {
  steepMinHours: number | null; // the steep window (long styles), both or neither
  steepMaxHours: number | null;
  steepTemp: SteepTemp | null;
  dilutionRatio: number | null; // served 1 : dilutionRatio
  dilutionWith: DilutionWith | null;
}
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
  variableSpeed: boolean; // brews record grindRpm
  rpmMin: number | null; // speed range: both or neither, only when variableSpeed
  rpmMax: number | null;
}
export interface Grinder extends GrinderDetails {
  id: string;
  name: string;
  archivedAt: string | null; // set = archived (hidden from pickers, kept in history)
  createdAt: string; // date added (ISO)
}

// docs/api/roasting-machines.md §3f: what a home roaster roasts on.
export interface RoastingMachine {
  id: string;
  name: string;
  notes: string | null;
  capacityGrams: number | null; // the largest batch of green coffee
  archivedAt: string | null; // set = archived (hidden from pickers, kept in history)
  createdAt: string;
}
export type RoastingMachineInput = Pick<RoastingMachine, 'name' | 'notes' | 'capacityGrams'>;

// docs/api/green-coffees.md §4e: green stock. The origin fields are a bean's.
export interface GreenCoffeeDetails {
  originArea: OriginArea | null;
  country: string | null;
  region: string | null;
  producer: string | null;
  altitudeMasl: number | null;
  varieties: string[] | null;
  species: CoffeeSpecies[] | null;
  processId: string | null;
  supplier: string | null;
  lot: string | null;
  priceAmount: number | null; // the whole purchase: with priceCurrency, both or neither
  priceCurrency: string | null;
  weightBoughtGrams: number | null;
  weightLeftGrams: number;
  lowStockGrams: number | null; // below it, the stock is low; null = never
  purchaseDate: string | null; // YYYY-MM-DD
  notes: string | null;
}
export interface GreenCoffee extends GreenCoffeeDetails {
  id: string;
  name: string;
  archivedAt: string | null; // set = archived (used up, or not roasting it now)
  createdAt: string;
}
export type GreenCoffeeInput = GreenCoffeeDetails & { name: string };

// docs/api/roasts.md §4f: one batch roasted; saving it makes its bean.
export interface RoastDetails {
  greenCoffeeId: string | null; // null once that green coffee is deleted
  machineId: string | null;
  roastedAt: string; // ISO
  utcOffsetMinutes: number | null; // the logging device's: the local roast date
  batchNumber: string | null;
  greenGrams: number;
  roastedGrams: number; // less than greenGrams, at most 40% lost
  roastType: RoastType | null;
  detailedRoastLevel: DetailedRoastLevel | null; // sets roastLevel, as on beans
  roastLevel: RoastLevel | null;
  chargeTempC: number | null;
  dropTempC: number | null;
  firstCrackSec: number | null; // from the charge; before totalSec
  totalSec: number | null; // charge to drop
  restDays: number;
  notes: string | null;
}
export interface Roast extends RoastDetails {
  id: string;
  beanId: string | null; // the bean it made; null once deleted
  userId: string | null;
  greenStockTakenGrams: number; // what it took off the green stock (no more than was left)
  greenCoffee: Pick<GreenCoffee, 'id' | 'name' | 'weightLeftGrams' | 'lowStockGrams'> | null; // with what's left now
  machine: { id: string; name: string } | null;
  bean: { id: string; inventoryWeightGrams: number; archived: boolean } | null; // the bean it made, while it exists
  createdAt: string;
}
// What the form sends; left out on a new roast, batchNumber and restDays get the defaults.
export type RoastInput = Omit<RoastDetails, 'greenCoffeeId' | 'batchNumber'> & { greenCoffeeId: string; batchNumber?: string | null };

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
  methodKinds: MethodKind[]; // offered for these methods…
  brewerIds: string[]; // …and these brewers; both empty = every brew
  position: number;
  archivedAt: string | null; // set = archived (off the checklist, kept in history)
  createdAt: string;
}
export type PrepToolRef = Pick<PrepTool, 'id' | 'name'>;

// docs/api/brew-problems.md §6b: what went wrong while brewing, a checklist
// like prep tools (ordered; methodKind null = every method).
export interface BrewProblem {
  id: string;
  name: string;
  methodKind: MethodKind | null;
  position: number;
  archivedAt: string | null; // set = archived (off the checklist, kept in history)
  createdAt: string;
}
export type BrewProblemRef = Pick<BrewProblem, 'id' | 'name' | 'methodKind'>;

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
// docs/schema.md COFFEE_SPECIES
export type CoffeeSpecies = 'arabica' | 'robusta' | 'liberica' | 'excelsa' | 'eugenioides';
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

// The image is at beansApi.photoUrl (WebP, at most 1024 px).
export interface BeanPhoto {
  id: string;
  width: number;
  height: number;
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
  roastWeightLossPercent: number | null; // % of the green weight lost in roasting
  blendType: BlendType | null;
  decaf: boolean;
  varieties: string[] | null; // cultivars, e.g. ["SL28", "SL34"]; null = not stated
  species: CoffeeSpecies[] | null; // COFFEE_SPECIES order; null = not stated
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
  batchNumber: string | null; // which home-roast batch ("3", "R-12")
  rating: number | null; // 0.5-5 in 0.5 steps
  archivedAt: string | null; // null = active
  createdAt: string;
  freezePeriods: FreezePeriod[]; // oldest first; one with thawedOn null = frozen now
  frozen: boolean; // a period is open (from the API, worked out from freezePeriods)
  photos: BeanPhoto[]; // cover first (docs/api/bean-photos.md §4c)
  roastReadyOn: string | null; // YYYY-MM-DD the home roast that made it has rested (docs/api/roasts.md §4f); null = not from a roast
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
export type MarkKind = 'first_drop' | 'step_end' | 'step_hold' | 'step_resume';
export interface Mark {
  kind: MarkKind;
  stepOrder: number | null; // all but first_drop: which step (1-based)
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
  setting: number; // approximate starting point on that grinder's dial
}

export interface Recipe extends ColdFields {
  id: string;
  workspaceId: string;
  name: string;
  brewer: BrewerRef;
  targetDoseGrams: number;
  targetWaterGrams: number | null; // null for espresso
  targetIceGrams: number | null; // flash chilled: ice in the server; the ratio counts it (docs/api/recipes.md §5)
  expectedYieldGrams: number | null; // estimate; for espresso the target shot weight (always set)
  expectedFinishMinSec: number | null; // target finish (shot time) window (both or neither)
  expectedFinishMaxSec: number | null;
  firstDropMinSec: number | null; // espresso only (both or neither)
  firstDropMaxSec: number | null;
  flowUnit: FlowUnit;
  // Filter: pour and wait times × batch factor^this; null = they stay (§5).
  stepTimeScaling: number | null;
  style: StyleRef | null; // one of the workspace's styles for brewer.kind
  targetTempC: number | null;
  defaultGrinderId: string | null; // preselected when brewing this recipe
  archivedAt: string | null; // set = archived: off the brew page and drink forms (§5)
  createdAt: string; // date added (ISO)
  grindSettings: RecipeGrindSetting[];
  prepToolIds: string[]; // default prep, ticked when it's brewed; in checklist order (§5)
  steps: RecipeStep[];
}

export type GrindDelta = 'much_finer' | 'finer' | 'no_change' | 'coarser' | 'much_coarser';

export interface LlmAnalysis {
  id: string;
  brewLogId: string;
  reasoning: string;
  suggestedGrindDelta: GrindDelta;
  suggestedTempDelta: number;
  // Newer analyses (docs/api/llm-contract.md §9); null on older ones.
  nextStep: string | null; // one concrete instruction for the next brew
  confidence: 'low' | 'medium' | 'high' | null;
  suggestedRpmDelta: number | null; // variable-speed grinders only
  suggestedDoseDelta: number | null; // espresso only: grams
  suggestedYieldDelta: number | null; // espresso only: shot weight, grams
  model: string | null;
  promptVersion: string | null;
  helpful: boolean | null; // 👍 / 👎 (docs/api/analysis.md §8)
  ratedAt: string | null;
  hasRequest: boolean; // what was sent is saved (§8c)
  createdAt: string;
}

// Your own AI prompt (docs/api/auth.md §1c).
export interface AiPrompt {
  instructions: string | null; // analyses and Suggest parameters
  labelInstructions: string | null; // reading bean labels (bean-label.md §4d)
  overrides: Record<string, string>; // section key → your text
}
export interface PromptSectionText {
  key: string;
  label: string;
  prompts: ReadonlyArray<'analysis' | 'suggest' | 'label'>;
  locked: boolean; // describes the answer's JSON: can't be changed
  text: string; // the default
}
export interface AiPromptSettings {
  aiPrompt: AiPrompt;
  sections: PromptSectionText[];
  instructionsIntro: string;
  labelInstructionsIntro: string;
  noteIntro: string;
  limits: { instructions: number; section: number; note: number };
}

// What was sent to the AI (docs/api/analysis.md §8c).
export interface AiRequest {
  sections: string[];
  system: string;
  input: Record<string, unknown>;
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
  actualIceGrams: number | null; // flash chilled: ice in the server; no TDS with it (docs/api/brew-logs.md §6)
  actualYieldGrams: number | null; // measured beverage weight
  tdsPercent: number | null; // refractometer reading; extraction yield is worked out (lib/extraction.ts)
  actualTempC: number | null;
  actualGrindSetting: number | null; // the number on the grinder's dial
  grindRpm: number | null; // grinder speed, variable-speed grinders only
  beanWeightInGrams: number | null; // weighed before grinding; retention = in − out (lib/grinderRetention.ts)
  groundWeightOutGrams: number | null; // what came out of the grinder
  steeping: boolean; // a long cold brew started, not finished yet (docs/api/brew-logs.md §6)
  steepTemp: SteepTemp | null; // where a long cold brew steeped
  dilutionRatio: number | null; // served 1 : dilutionRatio
  dilutedWith: DilutionWith | null;
  // The window it aimed for, set at the start (docs/api/brew-logs.md §6):
  // a long style's steep in hours, rapid cold's finish in seconds.
  steepMinHours: number | null;
  steepMaxHours: number | null;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  actualTimeSec: number;
  rating: number | null; // the coffee tasted on its own
  tastingNotes: string | null;
  drinkRating: number | null; // the finished drink (drink brews only)
  drinkTastingNotes: string | null;
  bean: { id: string; roasterName: string; beanName: string; batchNumber: string | null; decaf: boolean; species: CoffeeSpecies[] | null };
  recipe: { id: string; name: string; expectedYieldGrams: number | null; style: StyleRef | null; methodKind: MethodKind } | null;
  grinder: { id: string; name: string } | null;
  waterProfile: { id: string; name: string } | null; // archived ones included
  brewer: BrewerRef | null; // archived ones included
  drink: { id: string; name: string; hasIngredients: boolean } | null; // hasIngredients: shot and drink tasted apart
  marks: Mark[]; // earliest first
  tools: PrepToolRef[]; // prep tools used, in checklist order (§3d)
  problems: BrewProblemRef[]; // what went wrong, in list order (§6b)
  // The coffee's flavors from the wheel, in its order; label: the wheel's
  // now, else the one saved when picked (§6).
  flavors: FlavorPick[];
  brewedBy: { id: string; email: string } | null;
  // Its AI suggestion (§8): one exists; an automatic one is due then; why the
  // last one failed or wasn't made.
  analyzed: boolean;
  analysisDueAt: string | null;
  analysisError: string | null;
}

// docs/api/analysis.md §8b: starting values for a brew about to be made.
// Pending until the AI answers; the values are for the grinder chosen.
export interface ParameterSuggestion {
  id: string;
  beanId: string;
  recipeId: string | null;
  brewerId: string | null;
  grinderId: string | null;
  source: SuggestSource;
  maxBrews: number;
  requestedBy: string | null; // whose own AI prompt was used (auth.md §1c)
  note: string | null;
  alternativesAsked: AlternativeKind[] | null;
  brewCount: number | null; // how many earlier brews were sent
  // The batch as planned (kept as it is): null when not set.
  batchDoseGrams: number | null;
  batchWaterGrams: number | null;
  batchIceGrams: number | null;
  batchYieldGrams: number | null; // espresso: the shot weight
  status: 'pending' | 'done' | 'failed';
  error: string | null;
  reasoning: string | null;
  nextStep: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  grindSetting: number | null;
  grindRpm: number | null;
  tempC: number | null;
  ratio: number | null; // filter (water + ice) / dose, espresso shot / dose; null: keep the batch's
  alternatives: SuggestedAlternative[] | null; // what else to try; null while pending
  model: string | null;
  promptVersion: string | null;
  hasRequest: boolean; // what was sent is saved (§8c)
  createdAt: string;
  completedAt: string | null;
}
export interface SuggestionRequest {
  beanId: string;
  recipeId?: string | null;
  grinderId?: string | null;
  brewerId?: string | null;
  source?: SuggestSource;
  maxBrews?: number;
  batch?: SuggestionBatch;
  note?: string; // a one-off note (docs/api/auth.md §1c)
  alternatives?: AlternativeKind[]; // what else to suggest; default: the workspace's
}
export interface SuggestionBatch {
  doseGrams: number | null;
  waterGrams: number | null;
  iceGrams: number | null;
  yieldGrams: number | null; // espresso: the shot weight
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

// What "Fill in from a photo" read off a bean's label
// (docs/api/bean-label.md §4d): null where it couldn't tell.
export interface LabelFields {
  roasterName: string | null;
  beanName: string | null;
  processName: string | null; // one of the workspace's visible processes
  processText: string | null; // the process as printed, when it isn't one of them
  country: string | null;
  region: string | null;
  producer: string | null;
  altitudeMasl: number | null;
  varieties: string[] | null;
  species: CoffeeSpecies[] | null;
  flavorProfile: string | null;
  roastDate: string | null; // YYYY-MM-DD
  detailedRoastLevel: DetailedRoastLevel | null;
  roastLevel: RoastLevel | null;
  roastType: RoastType | null;
  blendType: BlendType | null;
  decaf: true | null;
  bagWeightGrams: number | null;
  batchNumber: string | null;
  website: string | null;
}

// What a web lookup added (bean-label.md §4d), each with the page it's on.
// Never the roast date or batch number.
export type LabelWebField = Exclude<keyof LabelFields, 'roastDate' | 'batchNumber'>;
export type LabelWebFinds = { [K in LabelWebField]?: { value: NonNullable<LabelFields[K]>; url: string } };
export interface LabelReadResult {
  fields: LabelFields;
  web: LabelWebFinds | null; // null when not looked up, or the lookup failed
  webSources: string[]; // pages the lookup looked at, those with a find first; [] without one
  webError: string | null; // the lookup failed; the label was still read
}
// POST …/bean-label/web: what's known of the bean (a label read's fields or
// the form's), and the answer.
export type LabelLookUp = { [K in LabelWebField]?: LabelFields[K] };
export type LabelWebResult = Pick<LabelReadResult, 'web' | 'webSources' | 'webError'>;

// Insights page rows (docs/api/stats.md §11): ids and numbers, no notes.
export interface StatsBrew {
  id: string;
  timestamp: string;
  utcOffsetMinutes: number | null;
  userId: string | null;
  beanId: string;
  recipeId: string | null;
  brewerId: string | null;
  methodId: string | null;
  styleId: string | null;
  brewsLike: RecipeStyle | null;
  grinderId: string | null;
  drinkId: string | null;
  toolIds: string[];
  problemIds: string[];
  doseGrams: number;
  waterGrams: number | null;
  iceGrams: number | null;
  yieldGrams: number | null;
  servingSize: number | null;
  servingUnit: ServingUnit | null;
  drinkServingSize: number | null; // the drink's default size
  drinkServingUnit: ServingUnit | null;
  dilutionRatio: number | null; // served 1 : ratio
  timeSec: number;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  grindSetting: number | null;
  tempC: number | null;
  tdsPercent: number | null;
  rating: number | null;
  drinkRating: number | null;
}

export interface StatsBean {
  id: string;
  roasterName: string;
  beanName: string;
  batchNumber: string | null;
  country: string | null;
  originArea: OriginArea | null;
  altitudeMasl: number | null;
  processId: string | null;
  roastLevel: RoastLevel | null;
  roastDate: string | null;
  varieties: string[] | null;
  species: CoffeeSpecies[] | null;
  decaf: boolean;
  priceAmount: number | null;
  priceCurrency: string | null;
  bagWeightGrams: number | null;
  inventoryWeightGrams: number;
  purchaseDate: string | null;
  createdAt: string;
  archivedAt: string | null;
  freezes: Array<{ frozenOn: string; thawedOn: string | null }>;
  photoCount: number;
}

export interface StatsNamed {
  id: string;
  name: string;
}

// A person's own added Insights charts (docs/api/stats.md §11b): an Explore
// view kept on a tab, or a built-in chart on the Overview. The same tabs as
// @barista/shared/schema (lib/insightCharts.test.ts checks).
export const INSIGHT_TABS = ['overview', 'brews', 'beans', 'methods', 'recipes', 'tools', 'grinders'] as const;
export type InsightTab = (typeof INSIGHT_TABS)[number];
export interface ExplorePin {
  id: string;
  kind: 'explore';
  tab: InsightTab;
  x: string;
  y: string;
  color?: string;
  grinder?: string;
}
export interface ChartPin {
  id: string;
  kind: 'chart';
  tab: 'overview';
  chart: string; // "brews.rating": the tab, then the chart (ChartCard's chart-id)
}
export type InsightChart = ExplorePin | ChartPin;
export const MAX_INSIGHT_CHARTS = 50;
// Each tab's own order and hidden charts (§11b): a built-in chart's id
// ("brews.rating"), an Overview tile's ("tile.brews") or an added one's
// ("pin:<id>"); only built-in ones hide. `tilesBelow`: Overview tiles under
// its charts.
export type InsightLayout = Partial<Record<InsightTab, { order?: string[]; hidden?: string[]; tilesBelow?: boolean }>>;

export interface StatsData {
  brews: StatsBrew[];
  beans: StatsBean[];
  lookups: {
    brewers: Array<StatsNamed & { methodId: string | null }>;
    methods: StatsNamed[];
    styles: Array<StatsNamed & { brewsLike: RecipeStyle }>;
    recipes: Array<StatsNamed & { expectedFinishMinSec: number | null; expectedFinishMaxSec: number | null }>; // the recipe's finish window
    grinders: StatsNamed[];
    tools: StatsNamed[];
    problems: StatsNamed[];
    processes: StatsNamed[];
    drinks: StatsNamed[];
  };
}

// docs/api/flavor-lexicon.md §2c: a flavor wheel as a file
// (docs/custom-flavor-wheel.md). Flavors in wheel order, each after the one
// it sits under; a key's dots give its place ("fruity.berry").
export interface LexiconFlavor {
  key: string;
  label: string;
  color?: string; // #rrggbb
}
export interface FlavorLexicon {
  format: 'barista-flavor-lexicon';
  version: number;
  name: string;
  flavors: LexiconFlavor[];
}
export interface WorkspaceLexicon {
  lexicon: FlavorLexicon;
  custom: boolean; // false = the built-in wheel
  updatedAt: string | null;
}
// A brew's pick: its key and its label (docs/api/brew-logs.md §6).
export interface FlavorPick {
  key: string;
  label: string;
}

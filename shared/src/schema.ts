import {
  mysqlTable,
  varchar,
  int,
  timestamp,
  decimal,
  boolean,
  primaryKey,
  customType,
  text,
  unique,
  date,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";

// A JSON column read back as a value: MariaDB stores JSON as text, so the
// driver returns a string that drizzle's json() would leave unparsed.
const jsonValue = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => "json",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => (typeof value === "string" ? (JSON.parse(value) as T) : (value as T)),
  })(name);

// Settings (docs/schema.md "Settings"): stored as JSON, null or missing keys =
// the defaults. Validated by the backend; read through withDefaults().
export const VOLUME_UNITS = ["fl_oz", "ml"] as const;
export const ALTITUDE_UNITS = ["m", "ft"] as const;
export const TEMPERATURE_UNITS = ["c", "f"] as const;
export const THEMES = ["system", "light", "dark"] as const; // system = follow the device

// Per person (docs/api/auth.md §1 preferences).
export interface UserPreferences {
  volumeUnit: (typeof VOLUME_UNITS)[number]; // yield estimates, new drinks' size
  showBothVolumes: boolean; // also show the other volume unit
  altitudeUnit: (typeof ALTITUDE_UNITS)[number]; // stored in metres regardless
  temperatureUnit: (typeof TEMPERATURE_UNITS)[number]; // stored in °C regardless
  theme: (typeof THEMES)[number];
}
export const DEFAULT_PREFERENCES: UserPreferences = {
  volumeUnit: "fl_oz",
  showBothVolumes: false,
  altitudeUnit: "m",
  temperatureUnit: "c",
  theme: "system",
};

// Per workspace, owners edit (docs/api/workspaces.md §2 settings).
export const ROAST_SCALES = ["names", "levels"] as const;
export type RoastScale = (typeof ROAST_SCALES)[number];
export interface WorkspaceSettings {
  // The roast recipes are written for: the recipe form's yield estimate, the
  // baseline when a bean's roast adjusts it, and beans with no roast level.
  recipeRoastLevel: RoastLevel;
  // How beans record their roast: "names" (Cinnamon … French, which imply
  // the 5-step level) or "levels" (light … dark only; roast names already
  // recorded are kept but not shown).
  roastScale: RoastScale;
}
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { recipeRoastLevel: "light", roastScale: "names" };

export function withDefaults<T extends object>(defaults: T, stored: Partial<T> | null): T {
  return { ...defaults, ...(stored ?? {}) };
}

// 1. Users
export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // Embedded in session tokens; bumping it (e.g. on password change) makes
  // every older session invalid.
  sessionVersion: int("session_version").default(0).notNull(),
  preferences: jsonValue<Partial<UserPreferences>>("preferences"), // null = all defaults
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 2. Workspaces (Coffee Bars)
export const workspaces = mysqlTable("workspaces", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).unique().notNull(), // Powers /menu/:slug
  isPublicMenuEnabled: boolean("is_public_menu_enabled").default(false).notNull(),
  // Currency of menu prices (ISO 4217, e.g. "USD"); needed once an item has a
  // price (docs/api/menu.md §7b).
  menuCurrency: varchar("menu_currency", { length: 3 }),
  // The public menu's title (docs/api/menu.md §7b); null = the workspace name.
  menuTitle: varchar("menu_title", { length: 255 }),
  settings: jsonValue<Partial<WorkspaceSettings>>("settings"), // null = all defaults
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 3. Workspace Members (Many-to-Many User <-> Workspace)
export const workspaceMembers = mysqlTable(
  "workspace_members",
  {
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 50 }).notNull(), // 'owner' | 'barista' | 'viewer'
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.workspaceId] }),
  })
);

// 4. Beans & Inventory
export const ROAST_LEVELS = ["light", "medium_light", "medium", "medium_dark", "dark"] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];
// What the roaster roasted it for (docs/api/beans.md §4).
export const ROAST_TYPES = ["filter", "espresso", "omni"] as const;
export type RoastType = (typeof ROAST_TYPES)[number];
// The traditional roast names, lightest to darkest. Each one implies a 5-step
// ROAST_LEVEL (DETAILED_ROAST_TO_LEVEL); the form fills roastLevel from it,
// but the two are stored apart so roastLevel can still be set by hand.
export const DETAILED_ROAST_LEVELS = [
  "cinnamon", "american", "new_england", "half_city", "modern_light", "city",
  "city_plus", "full_city", "full_city_plus", "italian", "vienna", "french",
] as const;
export type DetailedRoastLevel = (typeof DETAILED_ROAST_LEVELS)[number];
export const DETAILED_ROAST_TO_LEVEL: Record<DetailedRoastLevel, RoastLevel> = {
  cinnamon: "light",
  american: "light",
  new_england: "light",
  half_city: "light",
  modern_light: "medium_light",
  city: "medium_light",
  city_plus: "medium",
  full_city: "medium",
  full_city_plus: "medium_dark",
  italian: "dark",
  vienna: "dark",
  french: "dark",
};
export const BLEND_TYPES = ["single_origin", "blend", "other"] as const;
export type BlendType = (typeof BLEND_TYPES)[number];
// Where the coffee was grown, as the coffee trade groups origins
// (docs/api/beans.md §4). central_america includes Mexico and the Caribbean;
// arabia is Yemen; pacific is PNG, Hawaii and Australia.
export const ORIGIN_AREAS = [
  "africa", "arabia", "central_america", "south_america", "asia", "pacific",
] as const;
export type OriginArea = (typeof ORIGIN_AREAS)[number];
// How the coffee was processed (docs/api/beans.md §4). A fixed list for now;
// docs/backlog.md item 2 makes it editable per workspace.
export const BEAN_PROCESSES = [
  "washed", "natural", "wet_hulled", "honey", "mechanically_washed", "anaerobic",
  "carbonic_maceration", "co_fermentation", "thermal_shock", "lactic",
] as const;
export type BeanProcess = (typeof BEAN_PROCESSES)[number];

export const beans = mysqlTable("beans", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  roasterName: varchar("roaster_name", { length: 255 }).notNull(),
  beanName: varchar("bean_name", { length: 255 }).notNull(),
  process: varchar("process", { length: 100 }).$type<BeanProcess>(), // BEAN_PROCESSES, or null
  // One of ROAST_LEVELS, or null if unknown. Used to estimate beverage yield
  // when scaling a recipe (unknown is treated as light). Derived by the API
  // from detailedRoastLevel when that is set (docs/api/beans.md §4).
  roastLevel: varchar("roast_level", { length: 20 }),
  roastDate: timestamp("roast_date"),
  inventoryWeightGrams: int("inventory_weight_grams").default(0).notNull(),
  showOnPublicMenu: boolean("show_on_public_menu").default(true).notNull(),
  // Optional details (docs/api/beans.md §4). null = unknown.
  roastType: varchar("roast_type", { length: 20 }).$type<RoastType>(), // ROAST_TYPES
  detailedRoastLevel: varchar("detailed_roast_level", { length: 20 }).$type<DetailedRoastLevel>(), // DETAILED_ROAST_LEVELS
  blendType: varchar("blend_type", { length: 20 }).$type<BlendType>(), // BLEND_TYPES
  decaf: boolean("decaf").default(false).notNull(),
  website: varchar("website", { length: 500 }), // http(s) URL, to buy it again
  // Price of one bag: amount and ISO 4217 currency, both or neither (the API).
  // With bagWeightGrams, clients work out a price per gram.
  priceAmount: decimal("price_amount", { precision: 8, scale: 2, mode: "number" }),
  priceCurrency: varchar("price_currency", { length: 3 }),
  bagWeightGrams: int("bag_weight_grams"),
  notes: text("notes"),
  flavorProfile: varchar("flavor_profile", { length: 500 }), // the roaster's tasting notes
  originArea: varchar("origin_area", { length: 20 }).$type<OriginArea>(), // ORIGIN_AREAS
  country: varchar("country", { length: 100 }), // free text; a blend may list several
  region: varchar("region", { length: 255 }), // the growing area within the country, e.g. Yirgacheffe
  altitudeMasl: int("altitude_masl"), // metres above sea level
  producer: varchar("producer", { length: 255 }),
  purchaseDate: date("purchase_date", { mode: "string" }), // YYYY-MM-DD
  greenSupplier: varchar("green_supplier", { length: 255 }), // who sold the green coffee
  rating: int("rating"), // 1-5, the bean overall
  // Archived beans (docs/api/beans.md §4) leave the brew picker and the public
  // menu; past brews keep them. null = active.
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(), // "date added"
});

// 4b. Bean Freeze Periods (Effective Roast Age)
// A bean's effective age is the days since roasting minus every day spent
// frozen. Each freeze is a period; thawedOn is null while still frozen, and a
// bean has at most one open period (enforced by the API). Dates are calendar
// dates (no time zone). Kept as history, not a flag, so the age at the time
// of any past brew can be recomputed (the LLM worker sends it).
export const beanFreezes = mysqlTable("bean_freezes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  beanId: varchar("bean_id", { length: 36 })
    .notNull()
    .references(() => beans.id, { onDelete: "cascade" }),
  frozenOn: date("frozen_on", { mode: "string" }).notNull(), // YYYY-MM-DD
  thawedOn: date("thawed_on", { mode: "string" }), // null = still frozen
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const GRINDER_ADJUSTMENTS = ["stepped", "stepless"] as const;
export const BURR_TYPES = ["conical", "flat"] as const;
export const GRINDER_POWER = ["manual", "electric"] as const;
// Machine capabilities: who controls pre-infusion, flow and pressure.
export const PREINFUSION_MODES = ["none", "automatic", "manual"] as const;
export const PROFILE_CONTROLS = ["none", "manual", "programmable"] as const;
export type GrinderAdjustment = (typeof GRINDER_ADJUSTMENTS)[number];
export type BurrType = (typeof BURR_TYPES)[number];
export type GrinderPower = (typeof GRINDER_POWER)[number];
export type Preinfusion = (typeof PREINFUSION_MODES)[number];
export type ProfileControl = (typeof PROFILE_CONTROLS)[number];

// 5. Brewers (Per-Workspace Equipment That Makes the Coffee)
// A V60, French press, AeroPress, OXO Rapid Brewer or an espresso machine.
// Seeded with DEFAULT_BREWERS when a workspace is created; owners and baristas
// may add more. Recipes belong to a brewer.
// - `kind`, the brew method (METHOD_KINDS), is how brewers are grouped (they
//   have no category) and decides which recipe fields apply, the steps and
//   the timer (docs/api/README.md §3, §5), and which drinks the brewer can make
//   (a drink needs a method, 7d). Espresso has its own fields; filter,
//   stovetop (moka pot, ibrik) and other all use filter's (dose + water).
// How a cup is brewed (pour over, immersion, soup shot, moka…) is the recipe's
// `style`, not the brewer's: one brewer can do several.
// Espresso brewers also record what the barista controls (pre-infusion, flow,
// pressure); the shot timer and the AI use it. The public menu places brewers
// through the menu builder (7e). Archived like grinders once brews used it.
export const METHOD_KINDS = ["filter", "espresso", "stovetop", "other"] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];
// A recipe's style, by its brewer's method: how the cup is brewed. Descriptive
// (lists, the AI); it changes no fields or timer behaviour.
export const FILTER_STYLES = ["pour_over", "immersion", "hybrid", "cold_brew", "other"] as const;
export const ESPRESSO_STYLES = ["standard", "soup", "other"] as const;
export const STOVETOP_STYLES = ["moka", "ibrik", "other"] as const;
export const OTHER_STYLES = ["other"] as const;
export const RECIPE_STYLES = ["pour_over", "immersion", "hybrid", "cold_brew", "standard", "soup", "moka", "ibrik", "other"] as const;
export type RecipeStyle = (typeof RECIPE_STYLES)[number];
export const STYLES_BY_KIND: Record<MethodKind, readonly RecipeStyle[]> = {
  filter: FILTER_STYLES,
  espresso: ESPRESSO_STYLES,
  stovetop: STOVETOP_STYLES,
  other: OTHER_STYLES,
};
export const DEFAULT_BREWERS = [
  { name: "V60", kind: "filter" },
  { name: "Espresso", kind: "espresso" },
  { name: "Aeropress", kind: "filter" },
] as const satisfies ReadonlyArray<{ name: string; kind: MethodKind }>;

export const brewers = mysqlTable(
  "brewers",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "V60", "Linea Mini"
    kind: varchar("kind", { length: 20 }).$type<MethodKind>().default("filter").notNull(), // the brew method
    notes: varchar("notes", { length: 255 }),
    // Espresso only (other kinds keep "none").
    preinfusion: varchar("preinfusion", { length: 20 }).$type<Preinfusion>().default("none").notNull(),
    flowControl: varchar("flow_control", { length: 20 }).$type<ProfileControl>().default("none").notNull(),
    pressureControl: varchar("pressure_control", { length: 20 }).$type<ProfileControl>().default("none").notNull(),
    archivedAt: timestamp("archived_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("brewers_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 5b. Grinders (Per-Workspace Equipment)
// Brew logs record which grinder was used, since a grind setting ("20") only
// means something for a specific grinder. Recipes stay grinder-neutral.
// A grinder used by brew logs is archived (archivedAt set) rather than deleted:
// it leaves the pickers but history keeps its name. Unused ones can be deleted.
export const grinders = mysqlTable(
  "grinders",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "Comandante C40"
    notes: varchar("notes", { length: 255 }), // e.g. "stepped, 0-40 clicks"
    // Optional details (docs/api/grinders.md §3b). The range and step let the AI
    // talk in clicks/steps; the rest is reference.
    adjustment: varchar("adjustment", { length: 20 }).$type<GrinderAdjustment>(), // GRINDER_ADJUSTMENTS
    settingMin: decimal("setting_min", { precision: 6, scale: 2, mode: "number" }), // with settingMax: both or neither
    settingMax: decimal("setting_max", { precision: 6, scale: 2, mode: "number" }),
    stepSize: decimal("step_size", { precision: 5, scale: 2, mode: "number" }), // e.g. 1 click
    burrType: varchar("burr_type", { length: 20 }).$type<BurrType>(), // BURR_TYPES
    burrSizeMm: int("burr_size_mm"),
    power: varchar("power", { length: 20 }).$type<GrinderPower>(), // GRINDER_POWER
    archivedAt: timestamp("archived_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("grinders_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 5c. Water Profiles (Per-Workspace Brew Water)
// The water a brew was made with (docs/api/water-profiles.md §3c). Every
// figure is optional, in mg/L (ppm); GH and KH are expressed as CaCO3. At most
// one profile is the default (the API keeps it so), which new brews start on.
// Archived like grinders once brews use them.
export const waterProfiles = mysqlTable(
  "water_profiles",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "Third Wave Water"
    notes: varchar("notes", { length: 255 }),
    isDefault: boolean("is_default").default(false).notNull(),
    tdsPpm: decimal("tds_ppm", { precision: 7, scale: 2, mode: "number" }),
    generalHardnessPpm: decimal("general_hardness_ppm", { precision: 7, scale: 2, mode: "number" }), // GH as CaCO3
    alkalinityPpm: decimal("alkalinity_ppm", { precision: 7, scale: 2, mode: "number" }), // KH as CaCO3
    calciumPpm: decimal("calcium_ppm", { precision: 7, scale: 2, mode: "number" }),
    magnesiumPpm: decimal("magnesium_ppm", { precision: 7, scale: 2, mode: "number" }),
    sodiumPpm: decimal("sodium_ppm", { precision: 7, scale: 2, mode: "number" }),
    potassiumPpm: decimal("potassium_ppm", { precision: 7, scale: 2, mode: "number" }),
    bicarbonatePpm: decimal("bicarbonate_ppm", { precision: 7, scale: 2, mode: "number" }),
    chloridePpm: decimal("chloride_ppm", { precision: 7, scale: 2, mode: "number" }),
    sulfatePpm: decimal("sulfate_ppm", { precision: 7, scale: 2, mode: "number" }),
    ph: decimal("ph", { precision: 3, scale: 1, mode: "number" }),
    archivedAt: timestamp("archived_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("water_profiles_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 5d. Prep Tools (Per-Workspace, Ordered)
// What a brew's prep used: WDT, a puck screen, a rinsed paper filter…
// (docs/api/prep-tools.md §3d). methodKind limits a tool to one method's
// brews (null = every method); position is the order of the brew checklist.
// Seeded with DEFAULT_PREP_TOOLS when a workspace is created. Archived like
// grinders once brews use them.
export const DEFAULT_PREP_TOOLS = [
  { name: "WDT", methodKind: "espresso" },
  { name: "Puck screen", methodKind: "espresso" },
  { name: "Distributor", methodKind: "espresso" },
  { name: "Shaker", methodKind: "espresso" },
  { name: "Bottom paper filter", methodKind: "espresso" },
  { name: "Top paper filter", methodKind: "espresso" },
  { name: "Rinsed paper filter", methodKind: "filter" },
  { name: "Metal filter", methodKind: "filter" },
  { name: "Cloth filter", methodKind: "filter" },
  { name: "RDT", methodKind: null },
  { name: "Sifted fines", methodKind: null },
] as const satisfies ReadonlyArray<{ name: string; methodKind: MethodKind | null }>;

export const prepTools = mysqlTable(
  "prep_tools",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    methodKind: varchar("method_kind", { length: 20 }).$type<MethodKind>(), // METHOD_KINDS, or null = all
    position: int("position").notNull(), // 1, 2, 3...
    archivedAt: timestamp("archived_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("prep_tools_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 6. Recipe Templates (Target Parameters)
export const recipes = mysqlTable("recipes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  // The API refuses (409) to delete a brewer that recipes still use. The FK
  // cascades rather than restricts so that deleting a workspace (which
  // cascades to both brewers and recipes) isn't blocked by this FK. The API
  // must also reject a brewerId from a different workspace.
  brewerId: varchar("brewer_id", { length: 36 })
    .notNull()
    .references(() => brewers.id, { onDelete: "cascade" }),
  targetDoseGrams: decimal("target_dose_grams", { precision: 5, scale: 2, mode: "number" }).notNull(),
  // Water poured in total; the coffee:water ratio is dose:water. Required for
  // filter recipes, null for espresso (enforced by the API).
  targetWaterGrams: decimal("target_water_grams", { precision: 6, scale: 2, mode: "number" }),
  // Filter: rough estimate of beverage weight (water minus what
  // the grounds retain). Espresso: the target shot weight (required by the
  // API); the ratio is dose:yield.
  expectedYieldGrams: decimal("expected_yield_grams", { precision: 6, scale: 2, mode: "number" }),
  // Optional target window for the total brew time, in seconds. The API fills
  // a missing end with the other ±15 s, so it's either both or neither.
  expectedFinishMinSec: int("expected_finish_min_sec"),
  expectedFinishMaxSec: int("expected_finish_max_sec"),
  // Espresso only: target window for the first drop, seconds from the start
  // of the shot. Both or neither (the API fills a missing end with ±3 s).
  firstDropMinSec: int("first_drop_min_sec"),
  firstDropMaxSec: int("first_drop_max_sec"),
  // Unit for espresso flow steps: g/s (a scale) or ml/s (a machine's flow meter).
  flowUnit: varchar("flow_unit", { length: 10 }).$type<FlowUnit>().default("g_s").notNull(),
  targetTempC: decimal("target_temp_c", { precision: 4, scale: 1, mode: "number" }),
  // How the cup is brewed: one of STYLES_BY_KIND[brewer's kind] (the API), or null.
  style: varchar("style", { length: 20 }).$type<RecipeStyle>(),
  // Recipes aren't on the public menu; drinks and brewers are (7e).
  // Grind is per grinder: see recipeGrindSettings. The default grinder is
  // preselected when brewing this recipe (else the last one used); deleting
  // the grinder clears it.
  defaultGrinderId: varchar("default_grinder_id", { length: 36 }).references(() => grinders.id, { onDelete: "set null" }),
  // Archived recipes leave the brew page and drink forms; past brews and drinks
  // that already use them keep them (docs/api/recipes.md §5). null = active.
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(), // "date added" in lists
});

// 6b. Recipe Grind Starting Points (One Per Grinder)
// An approximate starting setting for this recipe on a given grinder. The
// brew flow prefers your last actual setting with that grinder and recipe.
export const recipeGrindSettings = mysqlTable(
  "recipe_grind_settings",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    recipeId: varchar("recipe_id", { length: 36 })
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    grinderId: varchar("grinder_id", { length: 36 })
      .notNull()
      .references(() => grinders.id, { onDelete: "cascade" }),
    setting: varchar("setting", { length: 100 }).notNull(), // e.g. "20"
  },
  (table) => ({
    recipeGrinderUnique: unique("recipe_grind_settings_recipe_grinder_unique").on(table.recipeId, table.grinderId),
  })
);

// 7. Recipe Steps (The Brew's Schedule)
// Steps run back to back: each starts when the previous one actually ended
// (docs/api/README.md §5, docs/timer_architecture.md §3). durationSec is the
// plan (or a guide, for steps you end with a tap); `advance` says how the
// timer moves on. Waiting is a "wait" (pour over) or "soak" (espresso) step.
// stepType is one of RECIPE_STEP_TYPES; which types a recipe may use depends
// on its method's kind. The values (water, temperature, pressure, flow) are
// instructions shown on the step's card.
export const RECIPE_STEP_TYPES = [
  "bloom", "pour", "swirl", "stir", "wait", "press", // filter
  "preinfusion", "soak", "pressure", "flow", // espresso
  "other", // any
] as const;
export const WATER_STEP_TYPES = ["bloom", "pour"] as const;
export const ESPRESSO_STEP_TYPES = ["preinfusion", "soak", "pressure", "flow", "other"] as const;
// auto: moves on after durationSec. auto_log: the same, plus a button to log
// when you really did it. tap: waits for a tap (durationSec is a guide).
// first_drop: espresso only; ends when First drop is tapped.
export const STEP_ADVANCE = ["auto", "auto_log", "tap", "first_drop"] as const;
export type StepAdvance = (typeof STEP_ADVANCE)[number];
export const FLOW_UNITS = ["g_s", "ml_s"] as const;
export type FlowUnit = (typeof FLOW_UNITS)[number];

export const recipeSteps = mysqlTable("recipe_steps", {
  id: varchar("id", { length: 36 }).primaryKey(),
  recipeId: varchar("recipe_id", { length: 36 })
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  stepOrder: int("step_order").notNull(), // 1, 2, 3...
  stepType: varchar("step_type", { length: 20 }).notNull(), // RECIPE_STEP_TYPES
  label: varchar("label", { length: 255 }), // optional, e.g. 'Second bloom', 'Center pour'
  // Seconds; null only on the last step = "until you finish". 0 = instant.
  durationSec: int("duration_sec"),
  advance: varchar("advance", { length: 20 }).$type<StepAdvance>().default("auto").notNull(),
  // Cumulative scale weight to pour to by the step's end; only for water step
  // types (and optional for 'other' on filter recipes).
  targetWaterGrams: decimal("target_water_grams", { precision: 6, scale: 2, mode: "number" }),
  targetTempC: decimal("target_temp_c", { precision: 4, scale: 1, mode: "number" }), // e.g. bloom at 85, pour at 93
  // Espresso: target pressure (bar) or flow (recipes.flowUnit); an end value
  // makes it a ramp shown as "9 → 6 bar".
  pressureBar: decimal("pressure_bar", { precision: 4, scale: 1, mode: "number" }),
  pressureEndBar: decimal("pressure_end_bar", { precision: 4, scale: 1, mode: "number" }),
  flowRate: decimal("flow_rate", { precision: 4, scale: 1, mode: "number" }),
  flowEndRate: decimal("flow_end_rate", { precision: 4, scale: 1, mode: "number" }),
});

// 7b. Ingredients (Reusable Preps)
// What goes into a drink besides the coffee: orange-infused cold foam,
// steamed oat milk, vanilla syrup, ice. Instructions are free text for now.
// The API refuses (409) to delete an ingredient that drinks use.
export const INGREDIENT_TYPES = ["milk", "foam", "syrup", "ice", "water", "other"] as const;
export type IngredientType = (typeof INGREDIENT_TYPES)[number];
export const ingredients = mysqlTable(
  "ingredients",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "Orange cold foam"
    ingredientType: varchar("ingredient_type", { length: 20 }).$type<IngredientType>().default("other").notNull(),
    instructions: text("instructions"), // how to make it, e.g. infuse overnight
    // Archived ingredients can't be added to drinks; drinks that have them keep
    // them (docs/api/ingredients.md §5b). null = active.
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("ingredients_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 7c. Drink Categories (Ordered Groups on the Brew Page)
// Group drinks in the brew picker, after the brew methods: e.g. "Espresso
// milk drinks", "Specialty drinks". For drinks only; brewers are grouped by
// method. The public menu has its own sections (7e). Deleting one leaves its
// drinks uncategorised.
export const drinkCategories = mysqlTable(
  "drink_categories",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    position: int("position").notNull(), // 1, 2, 3...
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("drink_categories_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// Serving sizes for drinks and brews (fl_oz = US fluid ounces).
export const SERVING_UNITS = ["fl_oz", "ml"] as const;
export type ServingUnit = (typeof SERVING_UNITS)[number];

// 7d. Drinks (What's Served; the Menu Builder Places Them, 7e)
// A drink needs a kind of coffee (METHOD_KINDS), not a particular device: any
// active brewer of that kind can make it, with that brewer's recipes (the
// default, a recipe of the kind, is preselected), finished with ingredients:
// "Oat Latte" (espresso + steamed oat milk), "The Atlas" (pour over + orange
// cold foam).
// A drink can be a variant of another (Vanilla Latte of Latte), like a
// cocktail riff: an independent copy that remembers its parent. Deleting a
// drink moves its variants up to its parent (the API; set null is a backstop).
export const drinks = mysqlTable("drinks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: varchar("description", { length: 500 }),
  kind: varchar("kind", { length: 20 }).$type<MethodKind>().notNull(), // METHOD_KINDS
  categoryId: varchar("category_id", { length: 36 }).references(() => drinkCategories.id, { onDelete: "set null" }),
  parentDrinkId: varchar("parent_drink_id", { length: 36 }).references((): AnyMySqlColumn => drinks.id, {
    onDelete: "set null",
  }),
  // A recipe whose brewer is of this kind (enforced by the API), or null.
  defaultRecipeId: varchar("default_recipe_id", { length: 36 }).references(() => recipes.id, { onDelete: "set null" }),
  // Default size, e.g. 8 fl oz: brewing scales the ingredient amounts (and a
  // filter method's batch) from it. Both or neither (the API); null = no scaling.
  servingSize: decimal("serving_size", { precision: 6, scale: 1, mode: "number" }),
  servingUnit: varchar("serving_unit", { length: 10 }).$type<ServingUnit>(), // SERVING_UNITS
  // How to make it, shown after the brew: "Add the syrup to the cup, pull the
  // shot onto it, steam the milk and pour." Free text.
  instructions: text("instructions"),
  // Archived drinks leave the brew page; past brews and the public menu keep
  // them (docs/api/drinks.md §5c). null = active.
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// A drink's ingredients, in order, with an amount for the drink's default size
// and a note. The unit is free text: "fl oz", "ml" and "g" are built in,
// others ("pump", "tsp") are typed. A value scales with the size; a unit alone
// ("to taste") doesn't.
export const drinkIngredients = mysqlTable("drink_ingredients", {
  id: varchar("id", { length: 36 }).primaryKey(),
  drinkId: varchar("drink_id", { length: 36 })
    .notNull()
    .references(() => drinks.id, { onDelete: "cascade" }),
  // Cascade so workspace deletion works; the API is what refuses deleting a used ingredient.
  ingredientId: varchar("ingredient_id", { length: 36 })
    .notNull()
    .references(() => ingredients.id, { onDelete: "cascade" }),
  position: int("position").notNull(), // 1, 2, 3...
  amountValue: decimal("amount_value", { precision: 8, scale: 2, mode: "number" }), // e.g. 2
  amountUnit: varchar("amount_unit", { length: 20 }), // e.g. "pump"
  note: varchar("note", { length: 255 }), // e.g. "spooned on top"
});

// 7e. Menu Builder (The Public Menu, Arranged by Hand)
// docs/api/menu.md §7b. The menu is its own thing: sections you name and
// order, holding items you place: a drink, a brewer (its plain brew), or the
// beans block (the bar's active beans that are switched on for the menu).
// Items can rename and describe their source for the menu, carry a price
// and be marked unavailable. Deleting a drink or brewer removes its items.
export const MENU_ITEM_TYPES = ["drink", "brewer", "beans"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];
// What the beans block shows guests about each bean, besides the roaster and
// name (docs/api/menu.md §7b). origin = area, country and region; roastLevel =
// the 5-step level and the detailed one.
export const BEAN_MENU_FIELDS = [
  "flavorProfile", "origin", "producer", "altitude", "process", "roastLevel", "roastDate", "decaf", "blendType", "roastType",
] as const;
export type BeanMenuField = (typeof BEAN_MENU_FIELDS)[number];

export const menuSections = mysqlTable(
  "menu_sections",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    position: int("position").notNull(), // 1, 2, 3...
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("menu_sections_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

export const menuItems = mysqlTable(
  "menu_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sectionId: varchar("section_id", { length: 36 })
      .notNull()
      .references(() => menuSections.id, { onDelete: "cascade" }),
    position: int("position").notNull(), // 1, 2, 3... within the section
    itemType: varchar("item_type", { length: 20 }).$type<MenuItemType>().notNull(), // MENU_ITEM_TYPES
    // Exactly the one matching itemType (the API); neither for "beans".
    drinkId: varchar("drink_id", { length: 36 }).references(() => drinks.id, { onDelete: "cascade" }),
    brewerId: varchar("brewer_id", { length: 36 }).references(() => brewers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }), // null = the source's name
    description: varchar("description", { length: 500 }), // null = the source's
    price: decimal("price", { precision: 8, scale: 2, mode: "number" }), // in workspaces.menuCurrency
    available: boolean("available").default(true).notNull(), // false = shown as unavailable
    // The beans block only: which BEAN_MENU_FIELDS guests see; null = all.
    beanFields: jsonValue<BeanMenuField[]>("bean_fields"),
  },
  (table) => ({
    // A drink or brewer once per section (NULLs don't collide).
    sectionDrinkUnique: unique("menu_items_section_drink_unique").on(table.sectionId, table.drinkId),
    sectionBrewerUnique: unique("menu_items_section_brewer_unique").on(table.sectionId, table.brewerId),
  })
);

// 8. Brew Logs (Actual Execution & Tasting Notes)
export const brewLogs = mysqlTable("brew_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // Null once the brewer deletes their account: the log stays as shared
  // workspace history, shown as a deleted user.
  userId: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
  beanId: varchar("bean_id", { length: 36 })
    .notNull()
    .references(() => beans.id, { onDelete: "cascade" }),
  recipeId: varchar("recipe_id", { length: 36 }).references(() => recipes.id, {
    onDelete: "set null",
  }),
  // Which grinder actualGrindSetting refers to. Optional. Grinders in use are
  // archived, not deleted, so this normally survives; set null as a backstop.
  grinderId: varchar("grinder_id", { length: 36 }).references(() => grinders.id, {
    onDelete: "set null",
  }),
  // The water used (optional; docs/api/brew-logs.md §6). Profiles in use are
  // archived, not deleted; set null as a backstop.
  waterProfileId: varchar("water_profile_id", { length: 36 }).references(() => waterProfiles.id, {
    onDelete: "set null",
  }),
  // The drink this brew was for (optional; docs/api/brew-logs.md §6). Null for a
  // plain brew of the method.
  drinkId: varchar("drink_id", { length: 36 }).references(() => drinks.id, { onDelete: "set null" }),
  // The size made, if the drink was scaled from its default (docs/api/README.md
  // §6). Both or neither, and only with a drink.
  servingSize: decimal("serving_size", { precision: 6, scale: 1, mode: "number" }),
  servingUnit: varchar("serving_unit", { length: 10 }).$type<ServingUnit>(), // SERVING_UNITS
  // The brewer used: the recipe's, set by the API (docs/api/brew-logs.md §6), and
  // kept if the recipe later changes or is deleted. Brewers in use are
  // archived, not deleted; set null as a backstop.
  brewerId: varchar("brewer_id", { length: 36 }).references(() => brewers.id, {
    onDelete: "set null",
  }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  // The logging device's offset from UTC in minutes (-420 = PDT), so the
  // worker knows the brew's local date for roast age (docs/api/brew-logs.md §6).
  // null = unknown (older brews): the worker falls back to BREW_TIMEZONE.
  utcOffsetMinutes: int("utc_offset_minutes"),
  actualDoseGrams: decimal("actual_dose_grams", { precision: 5, scale: 2, mode: "number" }).notNull(),
  // Required unless the log's recipe is an espresso recipe, where it's null.
  actualWaterGrams: decimal("actual_water_grams", { precision: 6, scale: 2, mode: "number" }),
  // Measured beverage weight. Optional, except for espresso (the shot
  // weight). Compared against the recipe's expected yield; with tdsPercent it
  // gives extraction yield.
  actualYieldGrams: decimal("actual_yield_grams", { precision: 6, scale: 2, mode: "number" }),
  // Refractometer reading, %. With the yield (or the water, for immersion) and
  // the dose it gives extraction yield, which is worked out, not stored
  // (docs/api/brew-logs.md §6).
  tdsPercent: decimal("tds_percent", { precision: 4, scale: 2, mode: "number" }),
  actualTempC: decimal("actual_temp_c", { precision: 4, scale: 1, mode: "number" }),
  actualGrindSetting: varchar("actual_grind_setting", { length: 100 }),
  actualTimeSec: int("actual_time_sec").notNull(),
  // The coffee tasted on its own (for a milk drink, only if tasted straight).
  rating: int("rating"), // 1-5
  tastingNotes: text("tasting_notes"),
  // The finished drink, for brews of a drink with ingredients (docs/api/README.md
  // §6). Milk and syrup change the taste, so the AI weighs these apart.
  drinkRating: int("drink_rating"), // 1-5
  drinkTastingNotes: text("drink_tasting_notes"),
});

// 8b. Brew Log Marks (Tapped Events During a Brew)
// When things actually happened, recorded by the timer (docs/api/brew-logs.md §6):
// the first drop (espresso), and the real end of steps that wait for a tap or
// have a "log it" button (step_end, with that step's stepOrder).
export const MARK_KINDS = ["first_drop", "step_end"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const brewLogMarks = mysqlTable("brew_log_marks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brewLogId: varchar("brew_log_id", { length: 36 })
    .notNull()
    .references(() => brewLogs.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 30 }).$type<MarkKind>().notNull(),
  stepOrder: int("step_order"), // step_end only
  atSec: decimal("at_sec", { precision: 6, scale: 1, mode: "number" }).notNull(), // seconds from the start, 0.1 s
});

// 8c. Brew Log Tools (The Prep Tools a Brew Used)
// Replaced as a whole when a log is edited (docs/api/brew-logs.md §6). Tools
// in use are archived, not deleted; cascade is a backstop.
export const brewLogTools = mysqlTable(
  "brew_log_tools",
  {
    brewLogId: varchar("brew_log_id", { length: 36 })
      .notNull()
      .references(() => brewLogs.id, { onDelete: "cascade" }),
    toolId: varchar("tool_id", { length: 36 })
      .notNull()
      .references(() => prepTools.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.brewLogId, table.toolId] }),
  })
);

// 9. LLM Analyses (AI Parameter Suggestions)
export const llmAnalyses = mysqlTable("llm_analyses", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brewLogId: varchar("brew_log_id", { length: 36 })
    .notNull()
    .references(() => brewLogs.id, { onDelete: "cascade" }),
  reasoning: text("reasoning").notNull(),
  suggestedGrindDelta: varchar("suggested_grind_delta", { length: 50 }).notNull(), // 'much_finer' | 'finer' | 'no_change' | 'coarser' | 'much_coarser'
  suggestedTempDelta: decimal("suggested_temp_delta", { precision: 3, scale: 1, mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Inferred row types for API payloads
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
export type Bean = typeof beans.$inferSelect;
export type NewBean = typeof beans.$inferInsert;
export type Brewer = typeof brewers.$inferSelect;
export type NewBrewer = typeof brewers.$inferInsert;
export type BeanFreeze = typeof beanFreezes.$inferSelect;
export type NewBeanFreeze = typeof beanFreezes.$inferInsert;
export type Grinder = typeof grinders.$inferSelect;
export type NewGrinder = typeof grinders.$inferInsert;
export type WaterProfile = typeof waterProfiles.$inferSelect;
export type PrepTool = typeof prepTools.$inferSelect;
export type RecipeGrindSetting = typeof recipeGrindSettings.$inferSelect;
export type RecipeStepType = (typeof RECIPE_STEP_TYPES)[number];
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeStep = typeof recipeSteps.$inferSelect;
export type NewRecipeStep = typeof recipeSteps.$inferInsert;
export type BrewLog = typeof brewLogs.$inferSelect;
export type Ingredient = typeof ingredients.$inferSelect;
export type Drink = typeof drinks.$inferSelect;
export type DrinkCategory = typeof drinkCategories.$inferSelect;
export type MenuSectionRow = typeof menuSections.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type BrewLogMark = typeof brewLogMarks.$inferSelect;
export type NewBrewLog = typeof brewLogs.$inferInsert;
export type LlmAnalysis = typeof llmAnalyses.$inferSelect;
export type NewLlmAnalysis = typeof llmAnalyses.$inferInsert;

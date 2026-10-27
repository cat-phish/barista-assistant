# Database Schema Specification (Drizzle ORM + MariaDB)

All core entities belong to a `workspace` (similar to Bar Assistant's "bars"). Users can belong to multiple workspaces via `workspace_members`. 

Implement the following schema in `/shared/src/schema.ts` (the
`@barista/shared` workspace, imported by both backend and worker as
`@barista/shared/schema`). Migrations are generated and owned by the backend
(`backend/drizzle/`, `npm run db:generate` / `db:migrate` in `/backend`).

```typescript
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

// Settings and preferences (stored as JSON; jsonValue is defined here, above
// the tables that use it). Storage units never change: grams, °C, metres.
export const VOLUME_UNITS = ["fl_oz", "ml"] as const;
export const ALTITUDE_UNITS = ["m", "ft"] as const;
export const TEMPERATURE_UNITS = ["c", "f"] as const;
export const THEMES = ["system", "light", "dark"] as const;
export const REPEAT_KEEPS = ["size", "doseWater", "temp", "grinder", "grind", "waterProfile", "dilution", "window", "prepTools", "grinderWeights", "notes"] as const; // what a repeat copies
export interface UserPreferences {
  volumeUnit: (typeof VOLUME_UNITS)[number];
  showBothVolumes: boolean;
  altitudeUnit: (typeof ALTITUDE_UNITS)[number];
  temperatureUnit: (typeof TEMPERATURE_UNITS)[number];
  theme: (typeof THEMES)[number]; // system = follow the device
  rateReminders: boolean; // rate-later reminders (docs/api/notifications.md §1b)
  rateReminderMinutes: number; // 5–240
  rateLaterDefault: boolean; // the log form's Rate later box starts ticked
  repeatKeeps: (typeof REPEAT_KEEPS)[number][]; // default: size … waterProfile
}
export const DEFAULT_PREFERENCES: UserPreferences = { volumeUnit: "fl_oz", showBothVolumes: false, altitudeUnit: "m", temperatureUnit: "c", theme: "system", rateReminders: true, rateReminderMinutes: 15, rateLaterDefault: false, repeatKeeps: ["size", "doseWater", "temp", "grinder", "grind", "waterProfile", "dilution", "window"] };
export const ROAST_SCALES = ["names", "levels"] as const; // roast names (Cinnamon … French) or light to dark only
export interface WorkspaceSettings {
  recipeRoastLevel: RoastLevel; // the roast recipes are written for
  roastScale: (typeof ROAST_SCALES)[number]; // how beans record their roast (docs/api/workspaces.md §2)
  hiddenFields: string[]; // optional form fields hidden (docs/api/workspaces.md §2, "Field visibility")
}
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { recipeRoastLevel: "light", roastScale: "names", hiddenFields: [] };
export function withDefaults<T extends object>(defaults: T, stored: Partial<T> | null): T;

// 1. Users
export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // Embedded in session tokens; bumping it (e.g. on password change) makes
  // every older session invalid.
  sessionVersion: int("session_version").default(0).notNull(),
  // Display units (docs/api/auth.md §1): JSON, null or missing keys = the
  // defaults (DEFAULT_PREFERENCES). Validated by the backend.
  preferences: jsonValue<Partial<UserPreferences>>("preferences"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 1c. Server settings (docs/api/server.md §10): what server admins set for
// the whole server, one row per key. "backups" holds BackupSettings;
// "backups_status" what the worker last did (BackupStatus).
export const BACKUP_FREQUENCIES = ["off", "daily", "weekly"] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];
export interface BackupSettings {
  frequency: BackupFrequency;
  hour: number; // 0-23, in BACKUP_TIMEZONE
  weekday: number; // 0-6, Sunday first (weekly only)
  keep: number; // 1-90: the newest dumps kept, older ones deleted
}
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { frequency: "off", hour: 3, weekday: 0, keep: 7 };
export interface BackupStatus {
  lastRunAt: string | null; // ISO
  lastFile: string | null;
  lastBytes: number | null;
  lastError: string | null; // set when the last run failed
}
export const serverSettings = mysqlTable("server_settings", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: jsonValue<unknown>("value"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// 1b. Notification channels (docs/api/notifications.md §1b): where a
// person's reminders go, one per kind, each switchable. config is the kind's
// settings (NotificationConfigs); SECRET_FIELDS are masked by the API.
export const NOTIFICATION_KINDS = ["ntfy", "gotify", "pushover", "discord", "telegram", "slack", "webhook"] as const;
export const notificationChannels = mysqlTable(
  "notification_channels",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).$type<NotificationKind>().notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    config: jsonValue<NotificationConfig>("config").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({ userKindUnique: unique("notification_channels_user_kind_unique").on(table.userId, table.kind) })
);

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
  // Workspace settings (docs/api/workspaces.md §2): JSON, null or missing
  // keys = the defaults (DEFAULT_WORKSPACE_SETTINGS). Owners change them.
  settings: jsonValue<Partial<WorkspaceSettings>>("settings"),
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
// How the coffee was processed (docs/api/bean-processes.md §4b): an editable
// list per workspace, seeded with these built-ins. A built-in keeps its key
// (`builtin`) when renamed, so the AI still knows what it is.
export const BEAN_PROCESSES = [
  "washed", "natural", "wet_hulled", "honey", "mechanically_washed", "anaerobic",
  "carbonic_maceration", "co_fermentation", "thermal_shock", "lactic",
] as const;
export type BeanProcess = (typeof BEAN_PROCESSES)[number];
export const DEFAULT_BEAN_PROCESSES = [
  { builtin: "washed", name: "Washed" }, { builtin: "natural", name: "Natural" },
  { builtin: "wet_hulled", name: "Wet-Hulled" }, { builtin: "honey", name: "Honey" },
  { builtin: "mechanically_washed", name: "Mechanically Washed" },
  { builtin: "anaerobic", name: "Anaerobic Fermentation" },
  { builtin: "carbonic_maceration", name: "Carbonic Maceration" },
  { builtin: "co_fermentation", name: "Co-Fermentation" },
  { builtin: "thermal_shock", name: "Thermal Shock" }, { builtin: "lactic", name: "Lactic Fermentation" },
];

export const beanProcesses = mysqlTable(
  "bean_processes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // unique per workspace, case-insensitive
    position: int("position").notNull(),
    hidden: boolean("hidden").default(false).notNull(), // left out of the bean form's choices
    builtin: varchar("builtin", { length: 30 }).$type<BeanProcess>(), // the seeded key, or null for custom ones
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({ uniqueName: unique("bean_processes_workspace_name").on(table.workspaceId, table.name) })
);

export const beans = mysqlTable("beans", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  roasterName: varchar("roaster_name", { length: 255 }).notNull(),
  beanName: varchar("bean_name", { length: 255 }).notNull(),
  // One of the workspace's processes (§4b); null = not sure. Deleting a
  // custom process clears it. Migrations 0044–0046 replaced the old key column.
  processId: varchar("process_id", { length: 36 }).references((): AnyMySqlColumn => beanProcesses.id, { onDelete: "set null" }),
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
  // Which roast of this bean: home roasters log each small batch as its own
  // bean (docs/api/beans.md §4). Free text: "3", "R-12".
  batchNumber: varchar("batch_number", { length: 50 }),
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

// 5f. Brewer methods (docs/api/brewer-methods.md §3e): how the workspace groups
// its brewers, seeded with METHOD_NAMES. behaviour is one of METHOD_KINDS
// (itself for a built-in); a brewer's kind is always its method's behaviour.
export const METHOD_NAMES = { filter: "Filter", espresso: "Espresso", stovetop: "Stovetop", other: "Other" };
export const brewerMethods = mysqlTable(
  "brewer_methods",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // unique per workspace
    position: int("position").notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    builtin: varchar("builtin", { length: 20 }).$type<MethodKind>(), // null for custom ones
    behaviour: varchar("behaviour", { length: 20 }).$type<MethodKind>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({ uniqueName: unique("brewer_methods_workspace_name").on(table.workspaceId, table.name) })
);

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
// A recipe's style, by its brewer's method: how the cup is brewed. Mostly
// descriptive (lists, the AI); cold styles (below) also change the recipe
// and brew flow.
export const FILTER_STYLES = ["pour_over", "immersion", "hybrid", "cold_brew", "rapid_cold", "kyoto_drip", "other"] as const;
export const ESPRESSO_STYLES = ["standard", "soup", "other"] as const;
export const STOVETOP_STYLES = ["moka", "ibrik", "other"] as const;
export const OTHER_STYLES = ["other"] as const;
export const RECIPE_STYLES = ["pour_over", "immersion", "hybrid", "cold_brew", "rapid_cold", "kyoto_drip", "standard", "soup", "moka", "ibrik", "other"] as const;
export type RecipeStyle = (typeof RECIPE_STYLES)[number];
// By brewsLike: long styles steep/drip for hours (Start steep → Finish, no
// timer); rapid cold (OXO Rapid Brewer) runs the timer; all three serve diluted.
export const LONG_STYLES = ["cold_brew", "kyoto_drip"];
export const COLD_STYLES = ["cold_brew", "kyoto_drip", "rapid_cold"];
export const STEEP_TEMPS = ["fridge", "room"] as const;
export const DILUTION_WITH = ["water", "milk", "ice", "other"] as const;
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
    // The workspace method it's grouped under (§3e); kind = its behaviour.
    methodId: varchar("method_id", { length: 36 }).references((): AnyMySqlColumn => brewerMethods.id, { onDelete: "set null" }),
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
    // Variable-speed grinders: brews record the speed (grindRpm). The RPM
    // range is optional, both or neither, and only with variableSpeed.
    variableSpeed: boolean("variable_speed").default(false).notNull(),
    rpmMin: int("rpm_min"),
    rpmMax: int("rpm_max"),
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

// 5g. Brew problems (docs/api/brew-problems.md §6b): what went wrong while
// brewing, a per-workspace checklist like prep tools. methodKind limits one
// to a method's brews (null = every method); position is the checklist
// order. Seeded with DEFAULT_BREW_PROBLEMS when a workspace is created;
// archived (kept on old brews) or deleted in Settings → Lists.
export const DEFAULT_BREW_PROBLEMS = [
  { name: "Slow drawdown / stalled bed", methodKind: "filter" },
  { name: "Fast drawdown", methodKind: "filter" },
  { name: "Uneven or cratered bed", methodKind: "filter" },
  { name: "Grounds high on the walls", methodKind: "filter" },
  { name: "Channeling (holes in the bed)", methodKind: "filter" },
  { name: "Filter clogged or collapsed", methodKind: "filter" },
  { name: "Poured too fast or uneven", methodKind: "filter" },
  { name: "Missed a pour target", methodKind: "filter" },
  { name: "Water too hot or cold (kettle off)", methodKind: "filter" },
  { name: "Immersion: grounds didn't sink, crust didn't break", methodKind: "filter" },
  { name: "Channeling / spurting", methodKind: "espresso" },
  { name: "Shot ran fast (gushed)", methodKind: "espresso" },
  { name: "Shot choked or dripped slowly", methodKind: "espresso" },
  { name: "Uneven extraction (one spout first, blonding early)", methodKind: "espresso" },
  { name: "Puck wet or soupy", methodKind: "espresso" },
  { name: "Puck cracked or stuck to the screen", methodKind: "espresso" },
  { name: "Grinder clumping", methodKind: "espresso" },
  { name: "Dose spilled or uneven tamp", methodKind: "espresso" },
  { name: "Machine temperature not settled", methodKind: "espresso" },
  { name: "Stale or old beans", methodKind: null },
  { name: "Grind setting changed by mistake", methodKind: null },
  { name: "Scale not tared", methodKind: null },
  { name: "Distracted / timer missed", methodKind: null },
] as const satisfies ReadonlyArray<{ name: string; methodKind: MethodKind | null }>;

export const brewProblems = mysqlTable(
  "brew_problems",
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
    workspaceNameUnique: unique("brew_problems_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 5e. Recipe styles (docs/api/recipe-styles.md §5e): each workspace's list per
// brewer method, seeded from STYLES_BY_KIND with STYLE_NAMES. brewsLike is the
// built-in a style brews like (itself for a built-in); extraction yield and
// the AI go by it.
export const STYLE_NAMES = { pour_over: "Pour over", immersion: "Immersion", hybrid: "Hybrid", cold_brew: "Cold brew",
  rapid_cold: "Rapid cold brew", kyoto_drip: "Kyoto drip", standard: "Standard", soup: "Soup", moka: "Moka", ibrik: "Ibrik", other: "Other" };
export const recipeStyles = mysqlTable(
  "recipe_styles",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).$type<MethodKind>().notNull(),
    name: varchar("name", { length: 100 }).notNull(), // unique per workspace and method
    position: int("position").notNull(), // within its method
    hidden: boolean("hidden").default(false).notNull(),
    builtin: varchar("builtin", { length: 20 }).$type<RecipeStyle>(), // null for custom ones
    brewsLike: varchar("brews_like", { length: 20 }).$type<RecipeStyle>().notNull(), // one of STYLES_BY_KIND[kind]
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({ uniqueName: unique("recipe_styles_workspace_kind_name").on(table.workspaceId, table.kind, table.name) })
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
  // Flash chilled: ice in the server the hot water is brewed onto (g). The
  // ratio is dose:(water + ice); pour targets count the hot water only.
  // Optional for filter recipes, null for espresso (enforced by the API).
  targetIceGrams: decimal("target_ice_grams", { precision: 6, scale: 2, mode: "number" }),
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
  // Cold styles (docs/api/recipes.md §5): the steep window in hours (both or
  // neither, long styles), fridge or room, and how the concentrate is served:
  // 1 : dilutionRatio with dilutionWith (e.g. 1 : 1 water).
  steepMinHours: decimal("steep_min_hours", { precision: 4, scale: 1, mode: "number" }),
  steepMaxHours: decimal("steep_max_hours", { precision: 4, scale: 1, mode: "number" }),
  steepTemp: varchar("steep_temp", { length: 10 }).$type<SteepTemp>(), // STEEP_TEMPS
  dilutionRatio: decimal("dilution_ratio", { precision: 3, scale: 1, mode: "number" }),
  dilutionWith: varchar("dilution_with", { length: 10 }).$type<DilutionWith>(), // DILUTION_WITH
  // How the cup is brewed: one of the workspace's styles for the brewer's
  // method (docs/api/recipe-styles.md §5e); null = not set. Migrations
  // 0047–0049 replaced the old key column.
  styleId: varchar("style_id", { length: 36 }).references((): AnyMySqlColumn => recipeStyles.id, { onDelete: "set null" }),
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
    setting: decimal("setting", { precision: 6, scale: 2, mode: "number" }).notNull(), // e.g. 20, on the grinder's dial
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
// A JSON column read back as a value: MariaDB stores JSON as text, so the
// driver returns a string that drizzle's json() would leave unparsed.
const jsonValue = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => "json",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => (typeof value === "string" ? (JSON.parse(value) as T) : (value as T)),
  })(name);

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
  // Flash chilled: ice in the server (g), as on the recipe. A brew with ice
  // takes no TDS reading (docs/api/brew-logs.md §6); null for espresso.
  actualIceGrams: decimal("actual_ice_grams", { precision: 6, scale: 2, mode: "number" }),
  // Measured beverage weight. Optional, except for espresso (the shot
  // weight). Compared against the recipe's expected yield; with tdsPercent it
  // gives extraction yield.
  actualYieldGrams: decimal("actual_yield_grams", { precision: 6, scale: 2, mode: "number" }),
  // Refractometer reading, %. With the yield (or the water, for immersion) and
  // the dose it gives extraction yield, which is worked out, not stored
  // (docs/api/brew-logs.md §6).
  tdsPercent: decimal("tds_percent", { precision: 4, scale: 2, mode: "number" }),
  actualTempC: decimal("actual_temp_c", { precision: 4, scale: 1, mode: "number" }),
  actualGrindSetting: decimal("actual_grind_setting", { precision: 6, scale: 2, mode: "number" }), // the dial number, like settingMin
  // Grinder speed, only for a variable-speed grinder (docs/api/brew-logs.md §6).
  grindRpm: int("grind_rpm"),
  // Grinder retention (docs/api/brew-logs.md §6): the beans weighed before
  // grinding and the grounds that came out. actualDoseGrams stays the dose
  // that went into the brew; retention (in − out) is worked out, not stored.
  beanWeightInGrams: decimal("bean_weight_in_grams", { precision: 5, scale: 2, mode: "number" }),
  groundWeightOutGrams: decimal("ground_weight_out_grams", { precision: 5, scale: 2, mode: "number" }),
  actualTimeSec: int("actual_time_sec").notNull(),
  // Cold styles (docs/api/brew-logs.md §6): a long brew (cold brew, Kyoto
  // drip) is saved when it starts, steeping = true, and finished later
  // (steeping false, with its time, yield and rating). steepTemp is where it
  // steeped; the dilution is what it was served with (1 : dilutionRatio).
  steeping: boolean("steeping").default(false).notNull(),
  steepTemp: varchar("steep_temp", { length: 10 }).$type<SteepTemp>(), // STEEP_TEMPS
  dilutionRatio: decimal("dilution_ratio", { precision: 3, scale: 1, mode: "number" }),
  dilutedWith: varchar("diluted_with", { length: 10 }).$type<DilutionWith>(), // DILUTION_WITH
  // The window this brew aimed for, set when it starts (the recipe's, or
  // changed for this brew; docs/api/brew-logs.md §6). Each pair is both or
  // neither: a long style's steep in hours (the ready reminder comes at its
  // min), rapid cold's finish in seconds (the timer's target).
  steepMinHours: decimal("steep_min_hours", { precision: 4, scale: 1, mode: "number" }),
  steepMaxHours: decimal("steep_max_hours", { precision: 4, scale: 1, mode: "number" }),
  expectedFinishMinSec: int("expected_finish_min_sec"),
  expectedFinishMaxSec: int("expected_finish_max_sec"),
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

// 8d. Brew Log Problems (What Went Wrong in a Brew)
// Replaced as a whole when a log is edited (docs/api/brew-logs.md §6).
// Deleting a problem unlinks it from brews (cascade); archiving keeps it.
export const brewLogProblems = mysqlTable(
  "brew_log_problems",
  {
    brewLogId: varchar("brew_log_id", { length: 36 })
      .notNull()
      .references(() => brewLogs.id, { onDelete: "cascade" }),
    problemId: varchar("problem_id", { length: 36 })
      .notNull()
      .references(() => brewProblems.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.brewLogId, table.problemId] }),
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
  // One concrete instruction for the next brew, how sure the model is, and an
  // RPM change for variable-speed grinders (docs/api/llm-contract.md §9).
  // Null on analyses made before they existed.
  nextStep: varchar("next_step", { length: 200 }),
  confidence: varchar("confidence", { length: 10 }).$type<AnalysisConfidence>(), // ANALYSIS_CONFIDENCE
  suggestedRpmDelta: int("suggested_rpm_delta"),
  // Espresso only (docs/api/llm-contract.md §9): change the dose and the shot
  // weight, in grams; null for other brews and older analyses.
  suggestedDoseDelta: decimal("suggested_dose_delta", { precision: 3, scale: 1, mode: "number" }),
  suggestedYieldDelta: decimal("suggested_yield_delta", { precision: 4, scale: 1, mode: "number" }),
  // What made it: the model and the prompt version (worker/src/prompt.ts).
  model: varchar("model", { length: 100 }),
  promptVersion: varchar("prompt_version", { length: 30 }),
  // Was it useful? Set by the brew's people (docs/api/analysis.md §8).
  helpful: boolean("helpful"),
  ratedAt: timestamp("rated_at"),
  // Made by auto-analyze (docs/api/analysis.md §8), not asked for: these
  // count toward the workspace's daily cap.
  auto: boolean("auto").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const ANALYSIS_CONFIDENCE = ["low", "medium", "high"] as const;
export type AnalysisConfidence = (typeof ANALYSIS_CONFIDENCE)[number];

// "Suggest parameters" (docs/api/analysis.md §8b): starting values for a brew
// about to be made, asked for on the brew page. The AI gets the bean, recipe,
// grinder and brewer chosen, and up to maxBrews earlier brews from source,
// each with its latest analysis. Pending until the worker fills in the
// result, or failed with why. The bean gives the workspace.
export const parameterSuggestions = mysqlTable("parameter_suggestions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  beanId: varchar("bean_id", { length: 36 })
    .notNull()
    .references(() => beans.id, { onDelete: "cascade" }),
  recipeId: varchar("recipe_id", { length: 36 }).references(() => recipes.id, { onDelete: "set null" }),
  brewerId: varchar("brewer_id", { length: 36 }).references(() => brewers.id, { onDelete: "set null" }),
  grinderId: varchar("grinder_id", { length: 36 }).references(() => grinders.id, { onDelete: "set null" }),
  source: varchar("source", { length: 20 }).$type<SuggestSource>().notNull(), // SUGGEST_SOURCES
  maxBrews: int("max_brews").notNull(),
  brewCount: int("brew_count"), // how many earlier brews were sent
  // The batch as planned when asked: the barista's to choose, so the AI
  // keeps it and suggests a ratio (filter: hot water and ice; espresso: the
  // shot weight). Null when not set.
  batchDoseGrams: decimal("batch_dose_grams", { precision: 5, scale: 1, mode: "number" }),
  batchWaterGrams: decimal("batch_water_grams", { precision: 6, scale: 1, mode: "number" }),
  batchIceGrams: decimal("batch_ice_grams", { precision: 6, scale: 1, mode: "number" }),
  batchYieldGrams: decimal("batch_yield_grams", { precision: 6, scale: 1, mode: "number" }),
  status: varchar("status", { length: 10 }).$type<SuggestionStatus>().notNull().default("pending"), // SUGGESTION_STATUSES
  error: varchar("error", { length: 200 }), // failed: why
  // The result: values for the brew, on the chosen grinder; null where they
  // don't apply (speed on a fixed-speed grinder) or the AI couldn't say (no
  // brew or starting point on that grinder). ratio null: keep the batch's.
  reasoning: text("reasoning"),
  nextStep: varchar("next_step", { length: 200 }),
  confidence: varchar("confidence", { length: 10 }).$type<AnalysisConfidence>(), // ANALYSIS_CONFIDENCE
  grindSetting: decimal("grind_setting", { precision: 6, scale: 2, mode: "number" }),
  grindRpm: int("grind_rpm"),
  tempC: decimal("temp_c", { precision: 4, scale: 1, mode: "number" }),
  // Filter: (water + ice) / dose; espresso: shot weight / dose.
  ratio: decimal("ratio", { precision: 5, scale: 2, mode: "number" }),
  model: varchar("model", { length: 100 }),
  promptVersion: varchar("prompt_version", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
export const SUGGESTION_STATUSES = ["pending", "done", "failed"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

// Where a brew's analysis stands while it isn't saved yet
// (docs/api/analysis.md §8): when an automatic one is due, or why the last
// one failed or was skipped. Queue state, so not backed up. No row: nothing
// pending, nothing failed.
export const analysisRequests = mysqlTable("analysis_requests", {
  brewLogId: varchar("brew_log_id", { length: 36 })
    .primaryKey()
    .references(() => brewLogs.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at"), // an automatic analysis waiting until then
  error: varchar("error", { length: 200 }), // shown with "Try again"
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

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
  text,
  unique,
  date,
} from "drizzle-orm/mysql-core";

// 1. Users
export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // Embedded in session tokens; bumping it (e.g. on password change) makes
  // every older session invalid.
  sessionVersion: int("session_version").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 2. Workspaces (Coffee Bars)
export const workspaces = mysqlTable("workspaces", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).unique().notNull(), // Powers /menu/:slug
  isPublicMenuEnabled: boolean("is_public_menu_enabled").default(false).notNull(),
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

export const beans = mysqlTable("beans", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  roasterName: varchar("roaster_name", { length: 255 }).notNull(),
  beanName: varchar("bean_name", { length: 255 }).notNull(),
  process: varchar("process", { length: 100 }), // Washed, Natural, Honey, etc.
  // One of ROAST_LEVELS, or null if unknown. Used to estimate beverage yield
  // when scaling a recipe (unknown is treated as light).
  roastLevel: varchar("roast_level", { length: 20 }),
  roastDate: timestamp("roast_date"),
  inventoryWeightGrams: int("inventory_weight_grams").default(0).notNull(),
  showOnPublicMenu: boolean("show_on_public_menu").default(true).notNull(),
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

// 5. Brew Methods (Per-Workspace Selectable List)
// Seeded with DEFAULT_BREW_METHODS when a workspace is created. Members with
// role 'owner' or 'barista' may add more. Recipes select from this list.
// `kind` (one of METHOD_KINDS) decides which recipe fields apply and how the
// timer behaves (docs/api_spec.md §3, §5). Latte is an espresso method until
// drinks replace it (docs/roadmap.md phase 3).
export const METHOD_KINDS = ["pour_over", "immersion", "espresso"] as const;
export const DEFAULT_BREW_METHODS = [
  { name: "V60", kind: "pour_over" },
  { name: "Espresso", kind: "espresso" },
  { name: "Aeropress", kind: "immersion" },
  { name: "Latte", kind: "espresso" },
] as const;

export const brewMethods = mysqlTable(
  "brew_methods",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    kind: varchar("kind", { length: 20 }).default("pour_over").notNull(), // METHOD_KINDS
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("brew_methods_workspace_name_unique").on(
      table.workspaceId,
      table.name
    ),
  })
);

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

// 5b. Grinders (Per-Workspace Equipment)
// Brew logs record which grinder was used, since a grind setting ("20") only
// means something for a specific grinder. Recipes stay grinder-neutral.
// A grinder used by brew logs is retired (retiredAt set) rather than deleted:
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
    // Optional details (docs/api_spec.md §3b). The range and step let the AI
    // talk in clicks/steps; the rest is reference.
    adjustment: varchar("adjustment", { length: 20 }).$type<GrinderAdjustment>(), // GRINDER_ADJUSTMENTS
    settingMin: decimal("setting_min", { precision: 6, scale: 2, mode: "number" }), // with settingMax: both or neither
    settingMax: decimal("setting_max", { precision: 6, scale: 2, mode: "number" }),
    stepSize: decimal("step_size", { precision: 5, scale: 2, mode: "number" }), // e.g. 1 click
    burrType: varchar("burr_type", { length: 20 }).$type<BurrType>(), // BURR_TYPES
    burrSizeMm: int("burr_size_mm"),
    power: varchar("power", { length: 20 }).$type<GrinderPower>(), // GRINDER_POWER
    retiredAt: timestamp("retired_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("grinders_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 5c. Espresso Machines (Per-Workspace Equipment)
// Chosen on espresso brews only. Capabilities decide how the shot timer
// treats pre-infusion and (later) flow/pressure profiles; a recipe works on
// any machine. Retired like grinders once brews used them.
export const machines = mysqlTable(
  "machines",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "Linea Mini"
    notes: varchar("notes", { length: 255 }),
    preinfusion: varchar("preinfusion", { length: 20 }).$type<Preinfusion>().default("none").notNull(),
    flowControl: varchar("flow_control", { length: 20 }).$type<ProfileControl>().default("none").notNull(),
    pressureControl: varchar("pressure_control", { length: 20 }).$type<ProfileControl>().default("none").notNull(),
    retiredAt: timestamp("retired_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("machines_workspace_name_unique").on(table.workspaceId, table.name),
  })
);

// 6. Recipe Templates (Target Parameters)
export const recipes = mysqlTable("recipes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  // The API refuses (409) to delete a brew method that recipes still use.
  // The FK cascades rather than restricts so that deleting a workspace (which
  // cascades to both brew_methods and recipes) isn't blocked by this FK.
  // The API must also reject a methodId from a different workspace.
  methodId: varchar("method_id", { length: 36 })
    .notNull()
    .references(() => brewMethods.id, { onDelete: "cascade" }),
  targetDoseGrams: decimal("target_dose_grams", { precision: 5, scale: 2, mode: "number" }).notNull(),
  // Water poured in total; the coffee:water ratio is dose:water. Required for
  // pour-over and immersion methods, null for espresso (enforced by the API).
  targetWaterGrams: decimal("target_water_grams", { precision: 6, scale: 2, mode: "number" }),
  // Pour-over/immersion: rough estimate of beverage weight (water minus what
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
  targetTempC: decimal("target_temp_c", { precision: 4, scale: 1, mode: "number" }),
  showOnPublicMenu: boolean("show_on_public_menu").default(true).notNull(),
  // Grind is per grinder: see recipeGrindSettings.
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

// 7. Recipe Steps (Timed Brew Steps)
// Each step runs from startSec to endSec (seconds from the start of the brew);
// gaps between steps are waiting time. stepType is one of RECIPE_STEP_TYPES.
// Water types (bloom, pour) carry a cumulative "pour to" scale target.
// "preinfusion" is for espresso recipes only (docs/api_spec.md §5).
export const RECIPE_STEP_TYPES = ["bloom", "pour", "swirl", "stir", "wait", "press", "preinfusion", "other"] as const;
export const WATER_STEP_TYPES = ["bloom", "pour"] as const;

export const recipeSteps = mysqlTable("recipe_steps", {
  id: varchar("id", { length: 36 }).primaryKey(),
  recipeId: varchar("recipe_id", { length: 36 })
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  stepOrder: int("step_order").notNull(), // 1, 2, 3...
  stepType: varchar("step_type", { length: 20 }).notNull(), // 'bloom' | 'pour' | 'swirl' | ...
  label: varchar("label", { length: 255 }), // optional, e.g. 'Second bloom', 'Center pour'
  startSec: int("start_sec").notNull(),
  endSec: int("end_sec").notNull(),
  // Cumulative scale weight to pour to by endSec; only for water step types
  // (and optional for 'other').
  targetWaterGrams: decimal("target_water_grams", { precision: 6, scale: 2, mode: "number" }),
});

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
  // retired, not deleted, so this normally survives; set null as a backstop.
  grinderId: varchar("grinder_id", { length: 36 }).references(() => grinders.id, {
    onDelete: "set null",
  }),
  // Espresso brews only (docs/api_spec.md §6). Retired, not deleted, like grinders.
  machineId: varchar("machine_id", { length: 36 }).references(() => machines.id, {
    onDelete: "set null",
  }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  actualDoseGrams: decimal("actual_dose_grams", { precision: 5, scale: 2, mode: "number" }).notNull(),
  // Required unless the log's recipe is an espresso recipe, where it's null.
  actualWaterGrams: decimal("actual_water_grams", { precision: 6, scale: 2, mode: "number" }),
  // Measured beverage weight. Optional, except for espresso (the shot
  // weight). With a TDS reading this gives extraction yield later; compared
  // against the recipe's expected yield.
  actualYieldGrams: decimal("actual_yield_grams", { precision: 6, scale: 2, mode: "number" }),
  actualTempC: decimal("actual_temp_c", { precision: 4, scale: 1, mode: "number" }),
  actualGrindSetting: varchar("actual_grind_setting", { length: 100 }),
  actualTimeSec: int("actual_time_sec").notNull(),
  rating: int("rating"), // 1-5 or 1-100 scale
  tastingNotes: text("tasting_notes"),
});

// 8b. Brew Log Marks (Tapped Events During a Brew)
// The shot timer records taps with the second they happened (docs/api_spec.md
// §6): when the first drop appeared, when a manual pre-infusion ended. A
// fixed list of kinds, at most one of each per log for now.
export const MARK_KINDS = ["first_drop", "preinfusion_end"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const brewLogMarks = mysqlTable("brew_log_marks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brewLogId: varchar("brew_log_id", { length: 36 })
    .notNull()
    .references(() => brewLogs.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 30 }).$type<MarkKind>().notNull(),
  atSec: decimal("at_sec", { precision: 6, scale: 1, mode: "number" }).notNull(), // seconds from the start, 0.1 s
});

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
```

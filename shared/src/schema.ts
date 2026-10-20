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
export type MethodKind = (typeof METHOD_KINDS)[number];
export const DEFAULT_BREW_METHODS = [
  { name: "V60", kind: "pour_over" },
  { name: "Espresso", kind: "espresso" },
  { name: "Aeropress", kind: "immersion" },
  { name: "Latte", kind: "espresso" },
] as const satisfies ReadonlyArray<{ name: string; kind: MethodKind }>;

export const brewMethods = mysqlTable(
  "brew_methods",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    kind: varchar("kind", { length: 20 }).$type<MethodKind>().default("pour_over").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("brew_methods_workspace_name_unique").on(
      table.workspaceId,
      table.name
    ),
  })
);

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
    retiredAt: timestamp("retired_at"), // null = active
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("grinders_workspace_name_unique").on(table.workspaceId, table.name),
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
export const RECIPE_STEP_TYPES = ["bloom", "pour", "swirl", "stir", "wait", "press", "other"] as const;
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
export type BrewMethod = typeof brewMethods.$inferSelect;
export type NewBrewMethod = typeof brewMethods.$inferInsert;
export type BeanFreeze = typeof beanFreezes.$inferSelect;
export type NewBeanFreeze = typeof beanFreezes.$inferInsert;
export type Grinder = typeof grinders.$inferSelect;
export type NewGrinder = typeof grinders.$inferInsert;
export type RecipeGrindSetting = typeof recipeGrindSettings.$inferSelect;
export type RecipeStepType = (typeof RECIPE_STEP_TYPES)[number];
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeStep = typeof recipeSteps.$inferSelect;
export type NewRecipeStep = typeof recipeSteps.$inferInsert;
export type BrewLog = typeof brewLogs.$inferSelect;
export type NewBrewLog = typeof brewLogs.$inferInsert;
export type LlmAnalysis = typeof llmAnalyses.$inferSelect;
export type NewLlmAnalysis = typeof llmAnalyses.$inferInsert;

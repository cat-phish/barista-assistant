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
export const beans = mysqlTable("beans", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  roasterName: varchar("roaster_name", { length: 255 }).notNull(),
  beanName: varchar("bean_name", { length: 255 }).notNull(),
  process: varchar("process", { length: 100 }), // Washed, Natural, Honey, etc.
  roastDate: timestamp("roast_date"),
  inventoryWeightGrams: int("inventory_weight_grams").default(0).notNull(),
  showOnPublicMenu: boolean("show_on_public_menu").default(true).notNull(),
});

// 5. Brew Methods (Per-Workspace Selectable List)
// Seeded with DEFAULT_BREW_METHODS when a workspace is created. Members with
// role 'owner' or 'barista' may add more. Recipes select from this list.
export const DEFAULT_BREW_METHODS = ["V60", "Espresso", "Aeropress", "Latte"] as const;

export const brewMethods = mysqlTable(
  "brew_methods",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUnique: unique("brew_methods_workspace_name_unique").on(
      table.workspaceId,
      table.name
    ),
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
  targetYieldGrams: decimal("target_yield_grams", { precision: 6, scale: 2, mode: "number" }).notNull(),
  targetTempC: decimal("target_temp_c", { precision: 4, scale: 1, mode: "number" }),
  targetGrindSetting: varchar("target_grind_setting", { length: 100 }),
  showOnPublicMenu: boolean("show_on_public_menu").default(true).notNull(),
});

// 7. Recipe Steps (Time-Series Pour-Over Intervals)
export const recipeSteps = mysqlTable("recipe_steps", {
  id: varchar("id", { length: 36 }).primaryKey(),
  recipeId: varchar("recipe_id", { length: 36 })
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  stepOrder: int("step_order").notNull(), // 1, 2, 3...
  actionName: varchar("action_name", { length: 255 }).notNull(), // 'Bloom', 'First Pour', 'Drawdown'
  targetTimeSec: int("target_time_sec").notNull(), // Cumulative time in seconds when step ends
  targetWaterGrams: decimal("target_water_grams", { precision: 6, scale: 2, mode: "number" }).notNull(), // Cumulative scale weight
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
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  actualDoseGrams: decimal("actual_dose_grams", { precision: 5, scale: 2, mode: "number" }).notNull(),
  actualYieldGrams: decimal("actual_yield_grams", { precision: 6, scale: 2, mode: "number" }).notNull(),
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
```

// Workspace backup and restore (docs/api/backup.md §2b). A backup is every
// row the workspace owns, table by table, with the IDs as stored: they're
// only references inside the file. Restore makes a new workspace and gives
// every row a new ID, rewriting the references. Which column points where
// comes from the schema's foreign keys, so the list below only says which
// tables are backed up, in insert order, and how their rows are found.
import { randomUUID } from "node:crypto";
import { eq, getTableColumns, inArray, type Column } from "drizzle-orm";
import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import { z } from "zod";
import {
  ANALYSIS_CONFIDENCE,
  SUGGEST_ALTERNATIVES,
  SUGGEST_SOURCES,
  SUGGESTION_STATUSES,
  BEAN_MENU_FIELDS,
  BEAN_PROCESSES,
  BLEND_TYPES,
  BURR_TYPES,
  DETAILED_ROAST_LEVELS,
  DILUTION_WITH,
  FLOW_UNITS,
  GRINDER_ADJUSTMENTS,
  GRINDER_POWER,
  INGREDIENT_TYPES,
  MARK_KINDS,
  MENU_ITEM_TYPES,
  METHOD_KINDS,
  ORIGIN_AREAS,
  PREINFUSION_MODES,
  PROFILE_CONTROLS,
  RECIPE_STEP_TYPES,
  RECIPE_STYLES,
  ROAST_LEVELS,
  ROAST_TYPES,
  SERVING_UNITS,
  STEEP_TEMPS,
  STEP_ADVANCE,
  beanFreezes,
  beanProcesses,
  beans,
  brewerMethods,
  brewers,
  brewLogMarks,
  brewLogProblems,
  brewLogs,
  brewLogTools,
  brewProblems,
  drinkCategories,
  drinkIngredients,
  drinks,
  grinders,
  ingredients,
  llmAnalyses,
  parameterSuggestions,
  menuItems,
  menuSections,
  notificationChannels,
  prepToolBrewers,
  prepTools,
  recipeGrindSettings,
  recipes,
  recipeStyles,
  recipeSteps,
  serverSettings,
  analysisRequests,
  users,
  waterProfiles,
  workspaceMembers,
  workspaces,
} from "@barista/shared/schema";
import { db } from "./db.js";
import { workspaceSettingsObject } from "./validation.js";

export const BACKUP_FORMAT = "barista-backup";
// Bumped when a backup made before the change can't be restored as is;
// UPGRADES then turns an older file into the current shape.
export const BACKUP_VERSION = 2;
const UPGRADES: Record<number, (file: BackupFile) => BackupFile> = {
  // 2: a prep tool's one methodKind (null = every method) became a list,
  // methodKinds ([] = every method), plus brewers (prep_tool_brewers).
  1: (file) => ({
    ...file,
    version: 2,
    tables: {
      ...file.tables,
      ...(Array.isArray(file.tables?.prep_tools)
        ? {
            // Not-an-object rows are left for checkBackup to report.
            prep_tools: file.tables.prep_tools.map((r) => {
              if (!isObject(r)) return r;
              const { methodKind, ...row } = r;
              return { ...row, methodKinds: methodKind == null ? [] : [methodKind] };
            }),
          }
        : {}),
    },
  }),
};

// In insert order: a table only points at tables above it (or at itself,
// filled in afterwards, like a drink's parent). "workspace" rows are found by
// workspaceId; the others by a column pointing at a table above.
export const BACKUP_TABLES: ReadonlyArray<{ table: MySqlTable; scope: "workspace" | string }> = [
  { table: brewerMethods, scope: "workspace" },
  { table: beanProcesses, scope: "workspace" },
  { table: recipeStyles, scope: "workspace" },
  { table: grinders, scope: "workspace" },
  { table: waterProfiles, scope: "workspace" },
  { table: prepTools, scope: "workspace" },
  { table: brewProblems, scope: "workspace" },
  { table: ingredients, scope: "workspace" },
  { table: drinkCategories, scope: "workspace" },
  { table: brewers, scope: "workspace" },
  { table: prepToolBrewers, scope: "prepToolId" },
  { table: beans, scope: "workspace" },
  { table: beanFreezes, scope: "beanId" },
  { table: recipes, scope: "workspace" },
  { table: recipeSteps, scope: "recipeId" },
  { table: recipeGrindSettings, scope: "recipeId" },
  { table: drinks, scope: "workspace" },
  { table: drinkIngredients, scope: "drinkId" },
  { table: menuSections, scope: "workspace" },
  { table: menuItems, scope: "sectionId" },
  { table: brewLogs, scope: "workspace" },
  { table: brewLogMarks, scope: "brewLogId" },
  { table: brewLogTools, scope: "brewLogId" },
  { table: brewLogProblems, scope: "brewLogId" },
  { table: llmAnalyses, scope: "brewLogId" },
  { table: parameterSuggestions, scope: "beanId" },
];
// Not in a backup: people, their memberships and the server's own settings
// belong to the server, not the workspace, and the workspace row is the
// file's own "workspace" block. analysis_requests is queue state (when an
// automatic analysis is due, why one failed), meaningless without the queue.
export const NOT_BACKED_UP: readonly MySqlTable[] = [users, notificationChannels, workspaces, workspaceMembers, serverSettings, analysisRequests];

// Columns that only hold one of a list (varchar in the database).
const ENUMS: Record<string, readonly string[]> = {
  "bean_processes.builtin": BEAN_PROCESSES,
  "brewer_methods.builtin": METHOD_KINDS,
  "brewer_methods.behaviour": METHOD_KINDS,
  "recipe_styles.kind": METHOD_KINDS,
  "recipe_styles.builtin": RECIPE_STYLES,
  "recipe_styles.brewsLike": RECIPE_STYLES,
  "brewers.kind": METHOD_KINDS,
  "brewers.preinfusion": PREINFUSION_MODES,
  "brewers.flowControl": PROFILE_CONTROLS,
  "brewers.pressureControl": PROFILE_CONTROLS,
  "grinders.adjustment": GRINDER_ADJUSTMENTS,
  "grinders.burrType": BURR_TYPES,
  "grinders.power": GRINDER_POWER,
  "brew_problems.methodKind": METHOD_KINDS,
  "beans.roastLevel": ROAST_LEVELS,
  "beans.roastType": ROAST_TYPES,
  "beans.detailedRoastLevel": DETAILED_ROAST_LEVELS,
  "beans.blendType": BLEND_TYPES,
  "beans.originArea": ORIGIN_AREAS,
  "recipes.flowUnit": FLOW_UNITS,
  "recipes.steepTemp": STEEP_TEMPS,
  "recipes.dilutionWith": DILUTION_WITH,
  "recipe_steps.stepType": RECIPE_STEP_TYPES,
  "recipe_steps.advance": STEP_ADVANCE,
  "ingredients.ingredientType": INGREDIENT_TYPES,
  "drinks.kind": METHOD_KINDS,
  "drinks.servingUnit": SERVING_UNITS,
  "menu_items.itemType": MENU_ITEM_TYPES,
  "brew_logs.servingUnit": SERVING_UNITS,
  "brew_logs.steepTemp": STEEP_TEMPS,
  "brew_logs.dilutedWith": DILUTION_WITH,
  "brew_log_marks.kind": MARK_KINDS,
  "llm_analyses.suggestedGrindDelta": ["much_finer", "finer", "no_change", "coarser", "much_coarser"],
  "llm_analyses.confidence": ANALYSIS_CONFIDENCE,
  "parameter_suggestions.source": SUGGEST_SOURCES,
  "parameter_suggestions.status": SUGGESTION_STATUSES,
  "parameter_suggestions.confidence": ANALYSIS_CONFIDENCE,
};
// JSON columns, checked by what the API accepts.
// What was sent to the AI (docs/api/analysis.md §8c), when the file has it.
const aiRequest = z.object({ sections: z.array(z.string()), system: z.string(), input: z.record(z.string(), z.unknown()) }).strict().nullable();
const JSON_SCHEMAS: Record<string, z.ZodType> = {
  "menu_items.beanFields": z.array(z.enum(BEAN_MENU_FIELDS)).nullable(),
  "prep_tools.methodKinds": z.array(z.enum(METHOD_KINDS)),
  "llm_analyses.request": aiRequest,
  "parameter_suggestions.request": aiRequest,
  "parameter_suggestions.alternativesAsked": z.array(z.enum(SUGGEST_ALTERNATIVES)).nullable(),
  // The ids are the source workspace's, not rewritten: a restored one shows the name.
  "parameter_suggestions.alternatives": z
    .array(z.object({ kind: z.enum(SUGGEST_ALTERNATIVES), id: z.string(), name: z.string(), why: z.string() }).strict())
    .nullable(),
};
// Large, and only for looking back at: in a file only when asked for
// (docs/api/backup.md §2b, "What was sent to the AI").
export const AI_REQUEST_COLUMNS: Record<string, string> = { llm_analyses: "request", parameter_suggestions: "request" };
export interface BackupOptions {
  aiRequests?: boolean;
}

// What the schema says about a backed-up table.
export interface TableInfo {
  name: string; // e.g. "brew_logs", the key in the file
  table: MySqlTable;
  scope: "workspace" | string;
  columns: Record<string, Column>; // by TS key
  refs: Record<string, string>; // column key -> table it points at (backed-up tables only)
  userColumns: string[]; // columns pointing at users (brewed by)
  hasId: boolean;
}
export const TABLE_INFO: TableInfo[] = BACKUP_TABLES.map(({ table, scope }) => {
  const config = getTableConfig(table);
  const columns = getTableColumns(table) as Record<string, Column>;
  const keyOf = new Map(Object.entries(columns).map(([key, col]) => [col.name, key]));
  const refs: Record<string, string> = {};
  const userColumns: string[] = [];
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    const key = keyOf.get(ref.columns[0]!.name)!;
    const target = getTableConfig(ref.foreignTable).name;
    if (target === "workspaces") continue;
    if (target === "users") userColumns.push(key);
    else refs[key] = target;
  }
  return { name: config.name, table, scope, columns, refs, userColumns, hasId: "id" in columns };
});
const INFO_BY_NAME = new Map(TABLE_INFO.map((t) => [t.name, t]));

export type BackupRow = Record<string, unknown>;
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  workspace: { name: string; slug: string; settings: unknown; menuTitle: string | null; menuCurrency: string | null; isPublicMenuEnabled: boolean };
  tables: Record<string, BackupRow[]>;
}

// Everything the workspace owns. Brews say who made them by email
// (brewedBy), since people aren't part of a backup.
export async function buildBackup(workspaceId: string, options: BackupOptions = {}): Promise<BackupFile> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
  const ids = new Map<string, string[]>();
  const tables: Record<string, BackupRow[]> = {};
  const emails = new Map<string, string | null>();
  for (const t of TABLE_INFO) {
    let rows: BackupRow[] = [];
    if (t.scope === "workspace") {
      rows = (await db.select().from(t.table).where(eq(t.columns.workspaceId!, workspaceId))) as BackupRow[];
    } else {
      const parentIds = ids.get(t.refs[t.scope]!) ?? [];
      if (parentIds.length > 0) rows = (await db.select().from(t.table).where(inArray(t.columns[t.scope]!, parentIds))) as BackupRow[];
    }
    if (t.hasId) ids.set(t.name, rows.map((r) => r.id as string));
    for (const key of t.userColumns) {
      const missing = [...new Set(rows.map((r) => r[key] as string | null).filter((id): id is string => !!id && !emails.has(id)))];
      if (missing.length > 0) {
        for (const u of await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, missing))) emails.set(u.id, u.email);
      }
    }
    const aiColumn = options.aiRequests ? undefined : AI_REQUEST_COLUMNS[t.name];
    tables[t.name] = rows.map(({ workspaceId: _ws, ...row }) => {
      if (aiColumn) delete row[aiColumn];
      for (const key of t.userColumns) {
        const id = row[key] as string | null;
        delete row[key];
        row.brewedBy = id ? (emails.get(id) ?? null) : null;
      }
      return row;
    });
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: { name: ws.name, slug: ws.slug, settings: ws.settings ?? {}, menuTitle: ws.menuTitle, menuCurrency: ws.menuCurrency, isPublicMenuEnabled: ws.isPublicMenuEnabled },
    tables,
  };
}

// ---- Checking a file ---------------------------------------------------------

export type Checked = { ok: true; file: BackupFile } | { ok: false; error: string };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_STRING = /^\d{4}-\d{2}-\d{2}$/;

// The column types columnValue knows; a test checks every backed-up column
// has one of them.
export const COLUMN_TYPES = ["MySqlVarChar", "MySqlText", "MySqlInt", "MySqlDecimalNumber", "MySqlBoolean", "MySqlTimestamp", "MySqlDateString", "MySqlCustomColumn"];

// A value for a column, as the database would take it (dates as Date), or an error.
function columnValue(t: TableInfo, key: string, col: Column, value: unknown): { value: unknown } | { error: string } {
  if (value === null) return col.notNull ? { error: "is required" } : { value: null };
  const json = JSON_SCHEMAS[`${t.name}.${key}`];
  switch (col.columnType) {
    case "MySqlVarChar":
    case "MySqlText": {
      if (typeof value !== "string") return { error: "must be text" };
      const length = (col as Column & { length?: number }).length;
      if (length !== undefined && value.length > length) return { error: `must be at most ${length} characters` };
      const allowed = ENUMS[`${t.name}.${key}`];
      if (allowed && !allowed.includes(value)) return { error: `must be one of ${allowed.join(", ")}` };
      return { value };
    }
    case "MySqlInt":
      return typeof value === "number" && Number.isInteger(value) ? { value } : { error: "must be a whole number" };
    case "MySqlDecimalNumber":
      return typeof value === "number" && Number.isFinite(value) ? { value } : { error: "must be a number" };
    case "MySqlBoolean":
      return typeof value === "boolean" ? { value } : { error: "must be true or false" };
    case "MySqlTimestamp": {
      const date = typeof value === "string" ? new Date(value) : null;
      return date && !Number.isNaN(date.getTime()) ? { value: date } : { error: "must be a date and time" };
    }
    case "MySqlDateString":
      return typeof value === "string" && DATE_STRING.test(value) ? { value } : { error: "must be a date (YYYY-MM-DD)" };
    case "MySqlCustomColumn": {
      if (!json) return { value };
      const parsed = json.safeParse(value);
      return parsed.success ? { value: parsed.data } : { error: parsed.error.issues[0]?.message ?? "is not valid" };
    }
    default:
      return { error: `has an unsupported type (${col.columnType})` };
  }
}

// The whole file, before anything is written: shape, version, every table
// and column known, values of the right type, and every reference pointing
// at a row in the file. The first problem is reported.
export function checkBackup(input: unknown): Checked {
  if (!isObject(input) || input.format !== BACKUP_FORMAT) return { ok: false, error: "backup: not a Barista backup file" };
  if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 1) return { ok: false, error: "backup.version: missing" };
  if (input.version > BACKUP_VERSION) return { ok: false, error: "backup.version: made by a newer version of the app; update this server first" };
  let file = input as unknown as BackupFile;
  for (let v = file.version; v < BACKUP_VERSION; v++) file = UPGRADES[v]!(file);

  const ws = file.workspace;
  if (!isObject(ws)) return { ok: false, error: "backup.workspace: missing" };
  const settings = workspaceSettingsObject.safeParse(ws.settings ?? {});
  if (!settings.success) return { ok: false, error: `backup.workspace.settings: ${settings.error.issues[0]?.message ?? "not valid"}` };
  if (ws.menuTitle != null && (typeof ws.menuTitle !== "string" || ws.menuTitle.length > 255)) return { ok: false, error: "backup.workspace.menuTitle: not valid" };
  if (ws.menuCurrency != null && (typeof ws.menuCurrency !== "string" || !/^[A-Z]{3}$/.test(ws.menuCurrency))) return { ok: false, error: "backup.workspace.menuCurrency: not valid" };
  if (!isObject(file.tables)) return { ok: false, error: "backup.tables: missing" };
  for (const name of Object.keys(file.tables)) if (!INFO_BY_NAME.has(name)) return { ok: false, error: `tables.${name}: not a table a backup has` };

  const ids = new Map<string, Set<string>>();
  const tables: Record<string, BackupRow[]> = {};
  for (const t of TABLE_INFO) {
    const rows = file.tables[t.name] ?? [];
    if (!Array.isArray(rows)) return { ok: false, error: `tables.${t.name}: must be a list` };
    const seen = new Set<string>();
    const checked: BackupRow[] = [];
    for (const [i, raw] of rows.entries()) {
      const at = `tables.${t.name}[${i}]`;
      if (!isObject(raw)) return { ok: false, error: `${at}: must be an object` };
      const row: BackupRow = {};
      for (const [key, value] of Object.entries(raw)) {
        if (key === "brewedBy" && t.userColumns.length > 0) {
          if (value !== null && typeof value !== "string") return { ok: false, error: `${at}.brewedBy: must be an email or null` };
          continue; // kept in the file only; restored brews are the restorer's
        }
        const col = t.columns[key];
        if (!col || key === "workspaceId" || t.userColumns.includes(key)) return { ok: false, error: `${at}.${key}: not a column a backup has` };
        const v = columnValue(t, key, col, value);
        if ("error" in v) return { ok: false, error: `${at}.${key}: ${v.error}` };
        row[key] = v.value;
      }
      for (const [key, col] of Object.entries(t.columns)) {
        if (key === "workspaceId" || t.userColumns.includes(key) || key in row) continue;
        if (col.notNull && !col.hasDefault) return { ok: false, error: `${at}.${key}: is required` };
      }
      if (t.hasId) {
        const id = row.id as string;
        if (seen.has(id)) return { ok: false, error: `${at}.id: appears twice` };
        seen.add(id);
      }
      // References point at rows above (or, for a parent drink, this table).
      for (const [key, target] of Object.entries(t.refs)) {
        const ref = row[key];
        if (ref == null || target === t.name) continue;
        if (!ids.get(target)?.has(ref as string)) return { ok: false, error: `${at}.${key}: not in the file` };
      }
      checked.push(row);
    }
    for (const [key, target] of Object.entries(t.refs)) {
      if (target !== t.name) continue;
      for (const [i, row] of checked.entries()) {
        if (row[key] != null && !seen.has(row[key] as string)) return { ok: false, error: `tables.${t.name}[${i}].${key}: not in the file` };
      }
    }
    if (t.hasId) ids.set(t.name, seen);
    tables[t.name] = checked;
  }
  return { ok: true, file: { ...file, workspace: { ...ws, settings: settings.data }, tables } };
}

// ---- Restoring -------------------------------------------------------------

const CHUNK = 500;

// Into a new workspace, owned by ownerId: no default lists (the file has the
// workspace's own), the public menu off, and every brew the owner's.
export async function restoreBackup(file: BackupFile, target: { name: string; slug: string; ownerId: string }): Promise<string> {
  const workspaceId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({
      id: workspaceId,
      name: target.name,
      slug: target.slug,
      settings: file.workspace.settings as Record<string, never>,
      menuTitle: file.workspace.menuTitle,
      menuCurrency: file.workspace.menuCurrency,
      isPublicMenuEnabled: false,
    });
    await tx.insert(workspaceMembers).values({ userId: target.ownerId, workspaceId, role: "owner" });

    const newIds = new Map<string, Map<string, string>>();
    for (const t of TABLE_INFO) {
      const rows = file.tables[t.name] ?? [];
      const map = new Map<string, string>();
      if (t.hasId) for (const row of rows) map.set(row.id as string, randomUUID());
      newIds.set(t.name, map);
      const later: Array<{ id: string; key: string; ref: string }> = []; // references to this table itself
      const values = rows.map((row) => {
        const out: BackupRow = { ...row };
        if (t.hasId) out.id = map.get(row.id as string);
        if ("workspaceId" in t.columns) out.workspaceId = workspaceId;
        for (const key of t.userColumns) out[key] = target.ownerId;
        for (const [key, refTable] of Object.entries(t.refs)) {
          const old = row[key] as string | null | undefined;
          if (old == null) continue;
          if (refTable === t.name) {
            later.push({ id: out.id as string, key, ref: map.get(old)! });
            out[key] = null;
          } else out[key] = newIds.get(refTable)!.get(old)!;
        }
        return out;
      });
      for (let i = 0; i < values.length; i += CHUNK) await tx.insert(t.table).values(values.slice(i, i + CHUNK));
      for (const { id, key, ref } of later) await tx.update(t.table).set({ [key]: ref }).where(eq(t.columns.id!, id));
    }
  });
  return workspaceId;
}

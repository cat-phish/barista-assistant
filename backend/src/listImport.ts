// Export and import by list (docs/api/backup.md §2b, "By list"). An export
// is a backup file holding only the chosen rows and everything they need;
// an import brings a file's lists into an existing workspace, matching what
// it already has by name instead of adding it again.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildBackup, TABLE_INFO, type BackupFile, type BackupOptions, type BackupRow, type TableInfo } from "./backup.js";
import { db } from "./db.js";

// What can be exported or imported on its own (table names, as in the file).
export const LISTS = ["beans", "recipes", "drinks", "ingredients", "brewers", "grinders", "water_profiles", "prep_tools", "brew_problems", "brew_logs"] as const;
export type ListName = (typeof LISTS)[number];

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
// A bean's roast date as YYYY-MM-DD ("" when unknown): a Date from the
// database, an ISO string from a file.
const roastDay = (v: unknown) => (v ? new Date(v as string | Date).toISOString().slice(0, 10) : "");

// How a row is recognised in another workspace, for each top-level table:
// any shared key means "the same thing". References in a row are already in
// the target workspace's IDs when this is called. A test checks every
// top-level table has one.
export const MATCH_KEYS: Record<string, (row: BackupRow) => string[]> = {
  brewer_methods: (r) => [...(r.builtin ? [`b:${r.builtin}`] : []), `n:${lower(r.name)}`],
  bean_processes: (r) => [...(r.builtin ? [`b:${r.builtin}`] : []), `n:${lower(r.name)}`],
  recipe_styles: (r) => [...(r.builtin ? [`b:${r.kind}:${r.builtin}`] : []), `n:${r.kind}:${lower(r.name)}`],
  grinders: (r) => [lower(r.name)],
  water_profiles: (r) => [lower(r.name)],
  prep_tools: (r) => [lower(r.name)],
  brew_problems: (r) => [lower(r.name)],
  ingredients: (r) => [lower(r.name)],
  drink_categories: (r) => [lower(r.name)],
  brewers: (r) => [lower(r.name)],
  roasting_machines: (r) => [lower(r.name)],
  green_coffees: (r) => [lower(r.name)],
  // Two bags of the same coffee are two beans: the roast date tells them apart.
  beans: (r) => [`${lower(r.roasterName)}|${lower(r.beanName)}|${lower(r.batchNumber)}|${roastDay(r.roastDate)}`],
  recipes: (r) => [`${lower(r.name)}|${r.brewerId}`],
  drinks: (r) => [`${lower(r.name)}|${r.kind}`],
  menu_sections: (r) => [lower(r.name)],
  // The same brew imported twice: same moment, bean and dose.
  brew_logs: (r) => [`${new Date(r.timestamp as string | Date).toISOString()}|${r.beanId}|${Number(r.actualDoseGrams)}`],
};

// The column a copy's "(2)" goes on: its name, or for a bean its bean name
// (the roaster stays). Brews have none and are never copied.
const NAME_COLUMN: Record<string, string> = { beans: "beanName" };
const nameColumn = (table: string) => NAME_COLUMN[table] ?? "name";

// How a row is named in a summary.
export function rowLabel(table: string, r: BackupRow): string {
  if (table === "beans") {
    const extra = [r.batchNumber ? `batch ${r.batchNumber}` : "", r.roastDate ? `roasted ${roastDay(r.roastDate)}` : ""].filter(Boolean).join(", ");
    return [r.roasterName, r.beanName, extra ? `(${extra})` : ""].filter(Boolean).join(" ");
  }
  if (table === "brew_logs") return `Brew of ${new Date(r.timestamp as string | Date).toISOString().slice(0, 16).replace("T", " ")}`;
  return String(r.name ?? "");
}

// The chosen rows plus everything they need: their child rows (steps,
// freezes, marks…) and, repeatedly, every row they point at (a drink's
// recipe, that recipe's brewer, the brewer's method…).
function closure(tables: Record<string, BackupRow[]>, roots: Map<string, Set<string>>): Map<string, Set<string>> {
  const keep = new Map<string, Set<string>>(TABLE_INFO.map((t) => [t.name, new Set(roots.get(t.name) ?? [])]));
  const byId = new Map(TABLE_INFO.map((t) => [t.name, new Map((tables[t.name] ?? []).filter(() => t.hasId).map((r) => [r.id as string, r]))]));
  let changed = true;
  while (changed) {
    changed = false;
    // Walk from the end, so children are found before what they point at.
    for (const t of [...TABLE_INFO].reverse()) {
      const kept = keep.get(t.name)!;
      const rows = tables[t.name] ?? [];
      rows.forEach((row, i) => {
        const key = t.hasId ? (row.id as string) : `#${i}`;
        if (!kept.has(key) && t.scope !== "workspace" && keep.get(t.refs[t.scope]!)!.has(row[t.scope] as string)) {
          kept.add(key);
          changed = true;
        }
        if (!kept.has(key)) return;
        for (const [col, target] of Object.entries(t.refs)) {
          const ref = row[col] as string | null;
          if (ref && byId.get(target)!.has(ref) && !keep.get(target)!.has(ref)) {
            keep.get(target)!.add(ref);
            changed = true;
          }
        }
      });
    }
  }
  return keep;
}

function pick(tables: Record<string, BackupRow[]>, keep: Map<string, Set<string>>): Record<string, BackupRow[]> {
  return Object.fromEntries(
    TABLE_INFO.map((t) => [t.name, (tables[t.name] ?? []).filter((row, i) => keep.get(t.name)!.has(t.hasId ? (row.id as string) : `#${i}`))]),
  );
}

export interface ExportFile extends BackupFile {
  scope: "lists";
  lists: ListName[];
}

// Whole lists, or (with ids) only some of a list's items, with what they need.
export async function buildExport(workspaceId: string, lists: ListName[], ids?: Partial<Record<ListName, string[]>>, options: BackupOptions = {}): Promise<ExportFile> {
  const backup = await buildBackup(workspaceId, options);
  const roots = new Map<string, Set<string>>();
  for (const list of lists) {
    const chosen = ids?.[list];
    roots.set(list, new Set((backup.tables[list] ?? []).map((r) => r.id as string).filter((id) => !chosen || chosen.includes(id))));
  }
  return { ...backup, scope: "lists", lists, tables: pick(backup.tables, closure(backup.tables, roots)) };
}

// ---- Importing ---------------------------------------------------------------

export type Duplicates = "existing" | "copy";
export interface ImportSummary {
  // Per table, what's added and what's already here and used instead.
  tables: Array<{ table: string; added: string[]; matched: Array<{ name: string; existing: string }> }>;
  // Rows that come along with what's added (steps, freezes, marks…).
  details: Record<string, number>;
}

interface Planned {
  summary: ImportSummary;
  inserts: Array<{ t: TableInfo; rows: BackupRow[] }>;
  later: Array<{ t: TableInfo; id: string; key: string; ref: string }>;
}

// Works out the whole import without writing anything: the preview shows
// it, the import then writes it.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function plan(conn: typeof db | Tx, workspaceId: string, userId: string, file: BackupFile, lists: ListName[], duplicates: Duplicates): Promise<Planned> {
  const roots = new Map<string, Set<string>>();
  for (const list of lists) roots.set(list, new Set((file.tables[list] ?? []).map((r) => r.id as string)));
  const needed = pick(file.tables, closure(file.tables, roots));
  const chosen = new Set<string>(lists);

  const idMap = new Map<string, Map<string, string>>(); // table -> file id -> workspace id
  const added = new Map<string, Set<string>>(); // table -> file ids added (their children come too)
  const summary: ImportSummary = { tables: [], details: {} };
  const inserts: Planned["inserts"] = [];
  const later: Planned["later"] = [];

  for (const t of TABLE_INFO) {
    const rows = needed[t.name] ?? [];
    const map = new Map<string, string>();
    idMap.set(t.name, map);
    added.set(t.name, new Set());
    if (rows.length === 0) continue;
    const toInsert: BackupRow[] = [];
    const entry = { table: t.name, added: [] as string[], matched: [] as Array<{ name: string; existing: string }> };

    // What the workspace has already, by match key, and the names it uses.
    const keyFn = MATCH_KEYS[t.name];
    const existing = new Map<string, BackupRow>();
    const names = new Set<string>();
    if (t.scope === "workspace") {
      for (const row of (await conn.select().from(t.table).where(eq(t.columns.workspaceId!, workspaceId))) as BackupRow[]) {
        for (const k of keyFn!(row)) existing.set(k, row);
        if (nameColumn(t.name) in t.columns) names.add(lower(row[nameColumn(t.name)]));
      }
    }

    for (const row of rows) {
      const out: BackupRow = { ...row };
      delete out.brewedBy;
      // References into tables above, now in this workspace's IDs.
      let parentSkipped = false;
      for (const [col, target] of Object.entries(t.refs)) {
        const old = row[col] as string | null | undefined;
        if (old == null) continue;
        if (target === t.name) continue; // a drink's parent: filled in after
        const mapped = idMap.get(target)!.get(old);
        if (col === t.scope && !added.get(target)!.has(old)) parentSkipped = true;
        out[col] = mapped ?? null;
      }
      if (t.scope !== "workspace") {
        // A child comes with a parent that's added, never on its own.
        if (parentSkipped) continue;
        if (t.hasId) map.set(row.id as string, (out.id = randomUUID()) as string);
        for (const key of t.userColumns) out[key] = userId;
        toInsert.push(out);
        summary.details[t.name] = (summary.details[t.name] ?? 0) + 1;
        continue;
      }

      const match = keyFn!(out).map((k) => existing.get(k)).find(Boolean);
      // Copies are only made of the chosen lists; what they need is reused,
      // and a brew already in the journal is never added twice.
      const copy = duplicates === "copy" && chosen.has(t.name) && t.name !== "brew_logs";
      if (match && !copy) {
        map.set(row.id as string, match.id as string);
        entry.matched.push({ name: rowLabel(t.name, row), existing: rowLabel(t.name, match) });
        continue;
      }
      const id = randomUUID();
      map.set(row.id as string, id);
      added.get(t.name)!.add(row.id as string);
      out.id = id;
      out.workspaceId = workspaceId;
      for (const key of t.userColumns) out[key] = userId;
      // A copy gets a name of its own: "House V60 (2)", a bean "Guji (2)".
      const col = nameColumn(t.name);
      if (copy && col in t.columns && typeof out[col] === "string") {
        const base = out[col];
        for (let n = 2; names.has(lower(out[col])); n++) out[col] = `${base} (${n})`;
        names.add(lower(out[col]));
      }
      // One default water at most: the workspace's stays.
      if (t.name === "water_profiles") out.isDefault = false;
      for (const k of keyFn!(out)) existing.set(k, out);
      toInsert.push(out);
      entry.added.push(rowLabel(t.name, out));
    }
    // A drink's parent, once every drink has its ID.
    for (const [col, target] of Object.entries(t.refs)) {
      if (target !== t.name) continue;
      for (const row of rows) {
        const old = row[col] as string | null;
        if (!old || !added.get(t.name)!.has(row.id as string)) continue;
        const out = toInsert.find((r) => r.id === map.get(row.id as string))!;
        out[col] = null;
        const ref = map.get(old);
        if (ref) later.push({ t, id: out.id as string, key: col, ref });
      }
    }
    if (t.scope === "workspace" && (entry.added.length || entry.matched.length)) summary.tables.push(entry);
    inserts.push({ t, rows: toInsert });
  }
  return { summary, inserts, later };
}

export function previewImport(workspaceId: string, userId: string, file: BackupFile, lists: ListName[], duplicates: Duplicates): Promise<ImportSummary> {
  return plan(db, workspaceId, userId, file, lists, duplicates).then((p) => p.summary);
}

const CHUNK = 500;

export async function runImport(workspaceId: string, userId: string, file: BackupFile, lists: ListName[], duplicates: Duplicates): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    // Planned inside the transaction, so it sees the workspace as it's written.
    const { summary, inserts, later } = await plan(tx, workspaceId, userId, file, lists, duplicates);
    for (const { t, rows } of inserts) {
      for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(t.table).values(rows.slice(i, i + CHUNK));
    }
    for (const { t, id, key, ref } of later) await tx.update(t.table).set({ [key]: ref }).where(eq(t.columns.id!, id));
    return summary;
  });
}

// The lists a file offers: those it was exported with, else every list it
// has rows for (a whole backup).
export function fileLists(file: BackupFile & { lists?: unknown }): ListName[] {
  const named = Array.isArray(file.lists) ? (file.lists as string[]).filter((l): l is ListName => (LISTS as readonly string[]).includes(l)) : null;
  return named ?? LISTS.filter((l) => (file.tables[l]?.length ?? 0) > 0);
}
export const isList = (v: string): v is ListName => (LISTS as readonly string[]).includes(v);

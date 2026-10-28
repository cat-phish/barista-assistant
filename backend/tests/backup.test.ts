import { randomUUID } from "node:crypto";
import { is } from "drizzle-orm";
import { getTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import * as schema from "@barista/shared/schema";
import { BACKUP_TABLES, BACKUP_VERSION, COLUMN_TYPES, NOT_BACKED_UP, TABLE_INFO } from "../src/backup.js";
import { db } from "../src/db.js";
import { addMember, brewerId, menuAdd, menuSection, newBean, newBrewLog, newUser, newWorkspace, styleId, type TestUser } from "./helpers.js";

// What was sent to the AI, saved with an analysis and a suggestion.
const SENT = { sections: ["core", "end"], system: "You are an expert.", input: { brew: { rating: 4 } } };

// A workspace with something in every table a backup has.
async function populated() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await owner.agent.post(`${base}/${path}`).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    return res.body;
  };
  expect((await owner.agent.patch(`${base}/settings`).send({ roastScale: "levels", hiddenFields: ["brew.tds"] })).status).toBe(200);
  expect((await owner.agent.patch(`${base}/menu`).send({ title: "Our bar", currency: "USD" })).status).toBe(200);

  await post("bean-processes", { name: "Yeast inoculated" });
  await post("brewer-methods", { name: "Siphon", behaviour: "filter" });
  const c40 = (await post("grinders", { name: "C40" })).grinder.id as string;
  const water = (await post("water-profiles", { name: "TWW", tdsPpm: 120 })).waterProfile.id as string;
  const stalled = (await post("brew-problems", { name: "Paper taste", methodKind: "filter" })).problem.id as string;
  const v60 = await brewerId(owner, ws.id, "V60");
  const wdt = (await post("prep-tools", { name: "Needle", methodKinds: ["espresso"], brewerIds: [v60] })).tool.id as string;
  const recipe = (
    await post("recipes", {
      name: "House V60",
      brewerId: v60,
      styleId: await styleId(owner, ws.id, "filter", "pour_over"),
      targetDoseGrams: 15,
      targetWaterGrams: 250,
      defaultGrinderId: c40,
      grindSettings: [{ grinderId: c40, setting: 20 }],
      steps: [
        { stepType: "bloom", durationSec: 30, targetWaterGrams: 45 },
        { stepType: "pour", durationSec: 60, targetWaterGrams: 250 },
      ],
    })
  ).recipe.id as string;
  const syrup = (await post("ingredients", { name: "Vanilla syrup", ingredientType: "syrup" })).ingredient.id as string;
  const category = (await post("drink-categories", { name: "Signature" })).category.id as string;
  const drink = (await post("drinks", { name: "The Atlas", kind: "filter", defaultRecipeId: recipe, categoryId: category, ingredients: [{ ingredientId: syrup }] })).drink.id as string;
  await post("drinks", { name: "Atlas iced", kind: "filter", parentDrinkId: drink });
  const section = await menuSection(owner, ws.id, "Coffee");
  await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: drink });
  await menuAdd(owner, ws.id, section, { itemType: "beans", beanFields: ["origin"] });

  const bean = await newBean(owner, ws.id, { roastDate: "2026-10-01" });
  await owner.agent.post(`${base}/beans/${bean}/freeze`).send({ date: "2026-10-05" });
  const log = await newBrewLog(owner, ws.id, bean, {
    recipeId: recipe,
    grinderId: c40,
    waterProfileId: water,
    drinkId: drink,
    toolIds: [wdt],
    problemIds: [stalled],
    marks: [{ kind: "step_end", stepOrder: 1, atSec: 31.5 }],
    rating: 4,
    tastingNotes: "Sweet",
  });
  await db.insert(schema.llmAnalyses).values({ id: randomUUID(), brewLogId: log, reasoning: "Fine", suggestedGrindDelta: "finer", suggestedTempDelta: 1, request: SENT });
  await db.insert(schema.parameterSuggestions).values({ id: randomUUID(), beanId: bean, recipeId: recipe, brewerId: v60, grinderId: c40, source: "beanRecipe", maxBrews: 5, status: "done", reasoning: "Stay", batchDoseGrams: 15, batchWaterGrams: 250, grindSetting: 20, tempC: 94, ratio: 16.5, confidence: "low", request: SENT });
  await owner.agent.patch(`${base}/grinders/${c40}`).send({ archived: true });
  return { owner, ws, base };
}

// What the workspace looks like through the API, without IDs (they differ
// after a restore) and with lists in a stable order.
const LISTS = ["bean-processes", "brewer-methods", "recipe-styles", "grinders", "water-profiles", "prep-tools", "brew-problems", "brewers", "beans", "recipes", "ingredients", "drink-categories", "drinks", "menu", "brew-logs"];
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "id" && !/Ids?$/.test(key) && key !== "total")
      .map(([key, v]) => [key, strip(v)]),
  );
}
const sorted = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(sorted).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value;
async function workspaceOf(user: TestUser, workspaceId: string) {
  const list = (await user.agent.get("/api/workspaces")).body.workspaces as Array<Record<string, unknown> & { id: string }>;
  return list.find((w) => w.id === workspaceId)!;
}
async function snapshot(user: TestUser, workspaceId: string) {
  const out: Record<string, unknown> = {};
  for (const list of LISTS) {
    const res = await user.agent.get(`/api/workspaces/${workspaceId}/${list}`);
    expect(res.status, list).toBe(200);
    out[list] = Object.fromEntries(Object.entries(res.body as Record<string, unknown>).map(([k, v]) => [k, sorted(strip(v))]));
  }
  const logs = (await user.agent.get(`/api/workspaces/${workspaceId}/brew-logs`)).body.brewLogs as Array<{ id: string }>;
  out.analyses = await Promise.all(logs.map(async (l) => strip((await user.agent.get(`/api/workspaces/${workspaceId}/brew-logs/${l.id}`)).body.brewLog.latestAnalysis)));
  const ws = await workspaceOf(user, workspaceId);
  out.workspace = { settings: ws.settings, menuTitle: ws.menuTitle, menuCurrency: ws.menuCurrency };
  return out;
}

describe("workspace backup and restore (docs/api/backup.md §2b)", () => {
  it("restores into a new workspace that looks the same, with new IDs", async () => {
    const { owner, ws, base } = await populated();
    const res = await owner.agent.get(`${base}/backup?aiRequests=true`); // everything there is
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`attachment; filename="${ws.slug}-backup-\\d{4}-\\d{2}-\\d{2}\\.json"`));
    const backup = res.body;
    expect(backup).toMatchObject({ format: "barista-backup", version: BACKUP_VERSION, workspace: { slug: ws.slug, menuTitle: "Our bar" } });
    // The test workspace has rows in every table, so the comparison below covers them all.
    for (const t of TABLE_INFO) expect(backup.tables[t.name]?.length, t.name).toBeGreaterThan(0);
    expect(backup.tables.brew_logs[0]).toMatchObject({ brewedBy: owner.email });
    expect(backup.tables.brew_logs[0]).not.toHaveProperty("userId");
    expect(backup.tables.brew_logs[0]).not.toHaveProperty("workspaceId");

    const restored = await owner.agent.post("/api/workspaces/restore").send({ name: "Copy", slug: `copy-${ws.slug}`, backup });
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    const copyId = restored.body.workspaceId as string;
    expect(copyId).not.toBe(ws.id);

    expect(await snapshot(owner, copyId)).toEqual(await snapshot(owner, ws.id));
    // IDs are left out above, so check the prep tool still points at the copy's V60.
    const needle = (await owner.agent.get(`/api/workspaces/${copyId}/prep-tools`)).body.tools.find((t: { name: string }) => t.name === "Needle");
    expect(needle.brewerIds).toEqual([await brewerId(owner, copyId, "V60")]);
    const copy = await workspaceOf(owner, copyId);
    expect(copy).toMatchObject({ name: "Copy", slug: `copy-${ws.slug}`, isPublicMenuEnabled: false });
    // New IDs throughout: nothing in the copy points into the original.
    const copyBackup = (await owner.agent.get(`/api/workspaces/${copyId}/backup?aiRequests=true`)).body;
    const originalIds = new Set(Object.values(backup.tables as Record<string, Array<{ id?: string }>>).flatMap((rows) => rows.map((r) => r.id)));
    expect(JSON.stringify(copyBackup.tables).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g)?.some((id) => originalIds.has(id))).toBe(false);
  });

  it("leaves out what was sent to the AI unless asked, and restores it when it's there", async () => {
    const { owner, base } = await populated();
    const plain = (await owner.agent.get(`${base}/backup`)).body;
    expect(plain.tables.llm_analyses[0]).not.toHaveProperty("request");
    expect(plain.tables.parameter_suggestions[0]).not.toHaveProperty("request");
    expect((await owner.agent.get(`${base}/backup?aiRequests=maybe`)).status).toBe(400);

    const full = (await owner.agent.get(`${base}/backup?aiRequests=true`)).body;
    expect(full.tables.llm_analyses[0].request).toEqual(SENT);
    expect(full.tables.parameter_suggestions[0].request).toEqual(SENT);
    const restored = await owner.agent.post("/api/workspaces/restore").send({ name: "With AI", slug: `ai-${randomUUID().slice(0, 8)}`, backup: full });
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    const copy = (await owner.agent.get(`/api/workspaces/${restored.body.workspaceId}/backup?aiRequests=true`)).body;
    expect(copy.tables.llm_analyses[0].request).toEqual(SENT);

    // Checked like any column.
    full.tables.llm_analyses[0].request = { system: 1 };
    expect((await owner.agent.post("/api/workspaces/restore").send({ name: "Bad", slug: `bad-${randomUUID().slice(0, 8)}`, backup: full })).status).toBe(400);
  });

  it("gives every restored brew to the person restoring", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const barista = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    await newBrewLog(barista, ws.id, await newBean(owner, ws.id));
    const backup = (await owner.agent.get(`/api/workspaces/${ws.id}/backup`)).body;
    expect(backup.tables.brew_logs[0].brewedBy).toBe(barista.email);

    const other = await newUser();
    const restored = await other.agent.post("/api/workspaces/restore").send({ name: "Mine", slug: `mine-${ws.slug}`, backup });
    expect(restored.status).toBe(201);
    const logs = (await other.agent.get(`/api/workspaces/${restored.body.workspaceId}/brew-logs`)).body.brewLogs;
    expect(logs[0].brewedBy.email).toBe(other.email);
    const members = (await other.agent.get(`/api/workspaces/${restored.body.workspaceId}/members`)).body.members as Array<{ email: string; role: string }>;
    expect(members.map((m) => [m.email, m.role])).toEqual([[other.email, "owner"]]);
  });

  it("is for owners only", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const barista = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    expect((await barista.agent.get(`/api/workspaces/${ws.id}/backup`)).status).toBe(403);
    expect((await (await newUser()).agent.get(`/api/workspaces/${ws.id}/backup`)).status).toBe(404);
  });

  it("restores a version 1 file, where a prep tool had one methodKind", async () => {
    const { owner, base } = await populated();
    const backup = (await owner.agent.get(`${base}/backup`)).body;
    const v1 = {
      ...backup,
      version: 1,
      tables: {
        ...backup.tables,
        prep_tool_brewers: undefined,
        prep_tools: backup.tables.prep_tools.map(({ methodKinds, ...r }: Record<string, unknown> & { methodKinds: string[] }) => ({ ...r, methodKind: methodKinds[0] ?? null })),
      },
    };
    const restored = await owner.agent.post("/api/workspaces/restore").send({ name: "Old", slug: `old-${randomUUID().slice(0, 8)}`, backup: v1 });
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    const tools = (await owner.agent.get(`/api/workspaces/${restored.body.workspaceId}/prep-tools`)).body.tools as Array<{ name: string; methodKinds: string[]; brewerIds: string[] }>;
    expect(tools.find((t) => t.name === "Needle")).toMatchObject({ methodKinds: ["espresso"], brewerIds: [] });
    expect(tools.find((t) => t.name === "RDT")).toMatchObject({ methodKinds: [] });
  });

  it("refuses a bad file or a taken slug, and creates nothing", async () => {
    const { owner, ws, base } = await populated();
    const backup = (await owner.agent.get(`${base}/backup`)).body;
    const count = async () => ((await owner.agent.get("/api/workspaces")).body.workspaces as unknown[]).length;
    const before = await count();
    const restore = (file: unknown, slug = "fresh-copy") => owner.agent.post("/api/workspaces/restore").send({ name: "Copy", slug, backup: file });
    const changed = (table: string, change: Record<string, unknown>) => ({
      ...backup,
      tables: { ...backup.tables, [table]: backup.tables[table].map((r: Record<string, unknown>, i: number) => (i === 0 ? { ...r, ...change } : r)) },
    });

    const cases: Array<[unknown, RegExp]> = [
      [{ hello: "world" }, /not a Barista backup/],
      [{ ...backup, version: BACKUP_VERSION + 1 }, /newer version/],
      [{ ...backup, tables: { ...backup.tables, robots: [] } }, /tables\.robots/],
      [changed("grinders", { colour: "red" }), /tables\.grinders\[0\]\.colour/],
      [changed("brewers", { kind: "teapot" }), /tables\.brewers\[0\]\.kind: must be one of/],
      [changed("recipes", { brewerId: randomUUID() }), /tables\.recipes\[0\]\.brewerId: not in the file/],
      [changed("brew_logs", { actualDoseGrams: "lots" }), /actualDoseGrams: must be a number/],
      [changed("bean_freezes", { frozenOn: "yesterday" }), /frozenOn: must be a date/],
      [changed("menu_items", { beanFields: ["smell"] }), /tables\.menu_items\[0\]\.beanFields/],
      [{ ...backup, workspace: { ...backup.workspace, settings: { roastScale: "loud" } } }, /settings/],
    ];
    for (const [file, error] of cases) {
      const res = await restore(file);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toMatch(error);
    }
    const twoC40 = { ...backup, tables: { ...backup.tables, grinders: [...backup.tables.grinders, { ...backup.tables.grinders[0], id: randomUUID() }] } };
    expect((await restore(twoC40)).status).toBe(409);
    expect((await restore(backup, ws.slug)).status).toBe(409);
    expect((await restore(backup, "Not A Slug")).status).toBe(400);
    expect(await count()).toBe(before);
  });
});

describe("what a backup covers", () => {
  it("every table is backed up or deliberately left out", () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is MySqlTable => is(v, MySqlTable));
    const covered = new Set<MySqlTable>([...BACKUP_TABLES.map((t) => t.table), ...NOT_BACKED_UP]);
    expect(tables.filter((t) => !covered.has(t)).map((t) => getTableConfig(t).name)).toEqual([]);
  });

  it("tables only point at tables above them, and every column type can be restored", () => {
    TABLE_INFO.forEach((t, i) => {
      const above = new Set(TABLE_INFO.slice(0, i + 1).map((x) => x.name));
      for (const [key, target] of Object.entries(t.refs)) expect(above.has(target), `${t.name}.${key} -> ${target}`).toBe(true);
      if (t.scope !== "workspace") expect(t.refs[t.scope], `${t.name} scope`).toBeDefined();
      for (const [key, col] of Object.entries(t.columns)) expect(COLUMN_TYPES, `${t.name}.${key}`).toContain(col.columnType);
    });
  });
});

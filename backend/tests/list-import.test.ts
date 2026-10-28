import { describe, expect, it } from "vitest";
import { TABLE_INFO } from "../src/backup.js";
import { MATCH_KEYS } from "../src/listImport.js";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace, styleId, type TestUser } from "./helpers.js";

// A workspace with a recipe on two grinders, a drink of it, and a brew.
async function source() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await owner.agent.post(`${base}/${path}`).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    return res.body;
  };
  const c40 = (await post("grinders", { name: "C40" })).grinder.id as string;
  const ode = (await post("grinders", { name: "Ode" })).grinder.id as string;
  const recipe = (
    await post("recipes", {
      name: "House V60",
      brewerId: await brewerId(owner, ws.id, "V60"),
      styleId: await styleId(owner, ws.id, "filter", "pour_over"),
      targetDoseGrams: 15,
      targetWaterGrams: 250,
      defaultGrinderId: c40,
      grindSettings: [{ grinderId: c40, setting: 20 }, { grinderId: ode, setting: 4 }],
      steps: [{ stepType: "bloom", durationSec: 30, targetWaterGrams: 45 }],
    })
  ).recipe.id as string;
  const syrup = (await post("ingredients", { name: "Vanilla syrup", ingredientType: "syrup" })).ingredient.id as string;
  const drink = (await post("drinks", { name: "The Atlas", kind: "filter", defaultRecipeId: recipe, ingredients: [{ ingredientId: syrup }] })).drink.id as string;
  const bean = await newBean(owner, ws.id);
  const log = await newBrewLog(owner, ws.id, bean, { recipeId: recipe, grinderId: c40, rating: 4 });
  return { owner, ws, base, recipe, drink, bean, log, c40 };
}

const exportOf = async (user: TestUser, base: string, body: Record<string, unknown>) => {
  const res = await user.agent.post(`${base}/export`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const names = (rows: Array<{ name?: string }>) => rows.map((r) => r.name).sort();

describe("export by list (docs/api/backup.md §2b)", () => {
  it("brings what the items need, and only that", async () => {
    const { owner, base } = await source();
    const file = await exportOf(owner, base, { lists: ["recipes"] });
    expect(file).toMatchObject({ format: "barista-backup", scope: "lists", lists: ["recipes"] });
    expect(names(file.tables.recipes)).toEqual(["House V60"]);
    expect(names(file.tables.brewers)).toEqual(["V60"]);
    expect(names(file.tables.grinders)).toEqual(["C40", "Ode"]);
    expect(file.tables.recipe_steps).toHaveLength(1);
    expect(file.tables.recipe_grind_settings).toHaveLength(2);
    expect(file.tables.brewer_methods).toHaveLength(1);
    expect(file.tables.recipe_styles).toHaveLength(1);
    for (const none of ["beans", "brew_logs", "drinks", "ingredients", "prep_tools", "menu_items"]) expect(file.tables[none], none).toEqual([]);

    // A drink brings its recipe and ingredients; a brew its bean and recipe.
    const drinks = await exportOf(owner, base, { lists: ["drinks"] });
    expect(names(drinks.tables.ingredients)).toEqual(["Vanilla syrup"]);
    expect(names(drinks.tables.recipes)).toEqual(["House V60"]);
    const journal = await exportOf(owner, base, { lists: ["brew_logs"] });
    expect(journal.tables.beans).toHaveLength(1);
    expect(names(journal.tables.recipes)).toEqual(["House V60"]);
  });

  it("brings what was sent to the AI only when asked", async () => {
    const { owner, base, log } = await source();
    const { db } = await import("../src/db.js");
    const { llmAnalyses } = await import("@barista/shared/schema");
    const sent = { sections: ["core"], system: "You are an expert.", input: {} };
    await db.insert(llmAnalyses).values({ id: crypto.randomUUID(), brewLogId: log, reasoning: "r", suggestedGrindDelta: "finer", suggestedTempDelta: 0, request: sent });
    expect((await exportOf(owner, base, { lists: ["brew_logs"] })).tables.llm_analyses[0]).not.toHaveProperty("request");
    expect((await exportOf(owner, base, { lists: ["brew_logs"], ids: { brew_logs: [log] }, aiRequests: true })).tables.llm_analyses[0].request).toEqual(sent);
  });

  it("can take only some items of a list", async () => {
    const { owner, base, c40 } = await source();
    const file = await exportOf(owner, base, { lists: ["grinders"], ids: { grinders: [c40] } });
    expect(names(file.tables.grinders)).toEqual(["C40"]);
    expect(file.tables.recipes).toEqual([]);
  });

  it("is for owners only", async () => {
    const { owner, ws, base } = await source();
    const barista = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    expect((await barista.agent.post(`${base}/export`).send({ lists: ["recipes"] })).status).toBe(403);
    expect((await barista.agent.post(`${base}/import/preview`).send({ file: {} })).status).toBe(403);
    expect((await owner.agent.post(`${base}/export`).send({ lists: ["menu"] })).status).toBe(400);
  });
});

describe("import by list", () => {
  it("matches what the workspace has by name, adds the rest, and the preview says so", async () => {
    const { owner, base } = await source();
    const file = await exportOf(owner, base, { lists: ["recipes"] });
    const other = await newUser();
    const target = await newWorkspace(other);
    const tbase = `/api/workspaces/${target.id}`;
    const theirC40 = (await other.agent.post(`${tbase}/grinders`).send({ name: "c40" })).body.grinder.id as string;

    const preview = await other.agent.post(`${tbase}/import/preview`).send({ file });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const byTable = Object.fromEntries((preview.body.tables as Array<{ table: string }>).map((t) => [t.table, t]));
    expect(byTable.recipes).toEqual({ table: "recipes", added: ["House V60"], matched: [] });
    expect(byTable.grinders).toEqual({ table: "grinders", added: ["Ode"], matched: [{ name: "C40", existing: "c40" }] });
    expect(byTable.brewers).toEqual({ table: "brewers", added: [], matched: [{ name: "V60", existing: "V60" }] });
    expect(preview.body.details).toEqual({ recipe_steps: 1, recipe_grind_settings: 2 });
    expect((await other.agent.get(`${tbase}/recipes`)).body.recipes).toEqual([]); // nothing written yet

    const done = await other.agent.post(`${tbase}/import`).send({ file });
    expect(done.status).toBe(200);
    expect({ tables: done.body.tables, details: done.body.details }).toEqual({ tables: preview.body.tables, details: preview.body.details });
    const [recipe] = (await other.agent.get(`${tbase}/recipes`)).body.recipes;
    expect(recipe).toMatchObject({ name: "House V60", brewer: { name: "V60" }, defaultGrinderId: theirC40, style: { brewsLike: "pour_over" } });
    expect(recipe.grindSettings.map((g: { grinderName: string }) => g.grinderName).sort()).toEqual(["Ode", "c40"]);
    expect(recipe.steps).toHaveLength(1);

    // Again: everything's there now. As copies: a renamed recipe.
    const again = await other.agent.post(`${tbase}/import`).send({ file });
    expect(again.body.tables.find((t: { table: string }) => t.table === "recipes")).toEqual({ table: "recipes", added: [], matched: [{ name: "House V60", existing: "House V60" }] });
    const copies = await other.agent.post(`${tbase}/import`).send({ file, duplicates: "copy" });
    expect(copies.body.tables.find((t: { table: string }) => t.table === "recipes").added).toEqual(["House V60 (2)"]);
    // What a copy needs is still reused, not copied.
    expect(names((await other.agent.get(`${tbase}/grinders`)).body.grinders)).toEqual(["Ode", "c40"]);
    expect(names((await other.agent.get(`${tbase}/recipes`)).body.recipes)).toEqual(["House V60", "House V60 (2)"]);
  });

  it("a prep tool brings the brewers it's offered for, matched by name", async () => {
    const { owner, ws, base } = await source();
    const v60 = await brewerId(owner, ws.id, "V60");
    const tool = (await owner.agent.post(`${base}/prep-tools`).send({ name: "Paper sandwich", methodKinds: ["espresso"], brewerIds: [v60] })).body.tool.id as string;
    const file = await exportOf(owner, base, { lists: ["prep_tools"], ids: { prep_tools: [tool] } });
    expect(names(file.tables.prep_tools)).toEqual(["Paper sandwich"]);
    expect(names(file.tables.brewers)).toEqual(["V60"]);
    expect(file.tables.prep_tool_brewers).toHaveLength(1);

    const other = await newUser();
    const target = await newWorkspace(other);
    const tbase = `/api/workspaces/${target.id}`;
    expect((await other.agent.post(`${tbase}/import`).send({ file })).status).toBe(200);
    const imported = (await other.agent.get(`${tbase}/prep-tools`)).body.tools.find((t: { name: string }) => t.name === "Paper sandwich");
    expect(imported).toMatchObject({ methodKinds: ["espresso"], brewerIds: [await brewerId(other, target.id, "V60")] });
  });

  it("a bean copied back into its own workspace gets its bean name numbered, its process reused", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}`;
    const bean = await newBean(owner, ws.id, { roasterName: "Test Roaster", beanName: "Test Bean" });
    const file = await exportOf(owner, base, { lists: ["beans"], ids: { beans: [bean] } });
    const preview = await owner.agent.post(`${base}/import/preview`).send({ file, lists: ["beans"] });
    expect(preview.body.tables.find((t: { table: string }) => t.table === "beans")).toEqual({ table: "beans", added: [], matched: [{ name: "Test Roaster Test Bean", existing: "Test Roaster Test Bean" }] });
    const copy = await owner.agent.post(`${base}/import`).send({ file, lists: ["beans"], duplicates: "copy" });
    expect(copy.body.tables.find((t: { table: string }) => t.table === "beans").added).toEqual(["Test Roaster Test Bean (2)"]);
    await owner.agent.post(`${base}/import`).send({ file, lists: ["beans"], duplicates: "copy" });
    const beans = (await owner.agent.get(`${base}/beans`)).body.beans as Array<{ roasterName: string; beanName: string }>;
    expect(beans.map((b) => `${b.roasterName} | ${b.beanName}`).sort()).toEqual(["Test Roaster | Test Bean", "Test Roaster | Test Bean (2)", "Test Roaster | Test Bean (3)"]);
  });

  it("two bags of the same bean (different roast dates) stay two beans, each with its own brews", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}`;
    const early = await newBean(owner, ws.id, { roasterName: "R", beanName: "Test Bean", roastDate: "2026-10-01" });
    const late = await newBean(owner, ws.id, { roasterName: "R", beanName: "Test Bean", roastDate: "2026-10-15" });
    await newBrewLog(owner, ws.id, early, { rating: 3, timestamp: "2026-10-05T08:00:00Z" });
    await newBrewLog(owner, ws.id, late, { rating: 5, timestamp: "2026-10-20T08:00:00Z" });
    const file = await exportOf(owner, base, { lists: ["brew_logs"] });

    const other = await newUser();
    const target = await newWorkspace(other);
    const tbase = `/api/workspaces/${target.id}`;
    const preview = await other.agent.post(`${tbase}/import/preview`).send({ file });
    expect(preview.body.tables.find((t: { table: string }) => t.table === "beans")).toEqual({
      table: "beans",
      added: expect.arrayContaining(["R Test Bean (roasted 2026-10-01)", "R Test Bean (roasted 2026-10-15)"]),
      matched: [],
    });
    await other.agent.post(`${tbase}/import`).send({ file });
    const beans = (await other.agent.get(`${tbase}/beans`)).body.beans as Array<{ id: string; roastDate: string }>;
    expect(beans.map((b) => b.roastDate.slice(0, 10)).sort()).toEqual(["2026-10-01", "2026-10-15"]);
    const logs = (await other.agent.get(`${tbase}/brew-logs`)).body.brewLogs as Array<{ beanId: string; rating: number }>;
    const roastOf = (l: { beanId: string }) => beans.find((b) => b.id === l.beanId)!.roastDate.slice(0, 10);
    expect(logs.map((l) => [l.rating, roastOf(l)]).sort()).toEqual([[3, "2026-10-01"], [5, "2026-10-15"]]);

    // Back into the workspace that has both: each bag matches its own.
    for (const [id, day] of [[early, "2026-10-01"], [late, "2026-10-15"]] as const) {
      const one = await exportOf(owner, base, { lists: ["beans"], ids: { beans: [id] } });
      const again = await owner.agent.post(`${base}/import/preview`).send({ file: one });
      expect(again.body.tables.find((t: { table: string }) => t.table === "beans")).toEqual({ table: "beans", added: [], matched: [{ name: `R Test Bean (roasted ${day})`, existing: `R Test Bean (roasted ${day})` }] });
    }
  });

  it("never adds the same brew twice, and gives imported brews to the importer", async () => {
    const { owner, base } = await source();
    const file = await exportOf(owner, base, { lists: ["brew_logs"] });
    const other = await newUser();
    const target = await newWorkspace(other);
    const tbase = `/api/workspaces/${target.id}`;
    await other.agent.post(`${tbase}/import`).send({ file });
    await other.agent.post(`${tbase}/import`).send({ file, duplicates: "copy" });
    const logs = (await other.agent.get(`${tbase}/brew-logs`)).body.brewLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ rating: 4, brewedBy: { email: other.email }, recipe: { name: "House V60" }, grinder: { name: "C40" } });
  });

  it("takes a list at a time from a whole backup", async () => {
    const { owner, ws, base } = await source();
    const backup = (await owner.agent.get(`/api/workspaces/${ws.id}/backup`)).body;
    const other = await newUser();
    const target = await newWorkspace(other);
    const tbase = `/api/workspaces/${target.id}`;
    const res = await other.agent.post(`${tbase}/import`).send({ file: backup, lists: ["drinks"] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.lists).toEqual(["drinks"]);
    expect(names((await other.agent.get(`${tbase}/drinks`)).body.drinks)).toEqual(["The Atlas"]);
    expect(names((await other.agent.get(`${tbase}/ingredients`)).body.ingredients)).toEqual(["Vanilla syrup"]);
    expect((await other.agent.get(`${tbase}/beans`)).body.beans).toEqual([]);
    expect((await other.agent.get(`${tbase}/brew-logs`)).body.brewLogs).toEqual([]);
  });

  it("refuses a bad file or a list the file doesn't have, writing nothing", async () => {
    const { owner, base } = await source();
    const file = await exportOf(owner, base, { lists: ["grinders"] });
    const other = await newUser();
    const target = await newWorkspace(other);
    const tbase = `/api/workspaces/${target.id}`;
    expect((await other.agent.post(`${tbase}/import`).send({ file: { format: "nope" } })).status).toBe(400);
    const missing = await other.agent.post(`${tbase}/import`).send({ file, lists: ["recipes"] });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/no recipes/);
    const broken = { ...file, tables: { ...file.tables, grinders: [{ ...file.tables.grinders[0], burrType: "square" }] } };
    expect((await other.agent.post(`${tbase}/import`).send({ file: broken })).status).toBe(400);
    expect((await other.agent.get(`${tbase}/grinders`)).body.grinders).toEqual([]);
  });

  it("every top-level table has a match key", () => {
    const top = TABLE_INFO.filter((t) => t.scope === "workspace").map((t) => t.name);
    expect(top.filter((name) => !MATCH_KEYS[name])).toEqual([]);
  });
});

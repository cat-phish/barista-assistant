import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { addMember, menuAdd, menuSection, newBean, newUser, newWorkspace } from "./helpers.js";

// Units and defaults (docs/api/workspaces.md §2 settings, docs/api/auth.md §1 preferences).
describe("workspace settings", () => {
  it("come with every workspace, defaults filled in", async () => {
    const owner = await newUser();
    const created = await owner.agent.post("/api/workspaces").send({ name: "Bar", slug: "settings-bar" });
    expect(created.body.workspace.settings).toEqual({ recipeRoastLevel: "light", roastScale: "names", hiddenFields: [], aiHidden: [], autoAnalyze: false, autoAnalyzeDelayMinutes: 10, autoAnalyzeDailyCap: null, suggestSource: "beanRecipe", suggestMaxBrews: 5, suggestAlternatives: [], readLabels: true, labelWebLookup: false, labelWebContext: "high", homeRoasting: false, homeRoasterName: "Home roast", restDays: { filter: 7, espresso: 14, omni: 10 } });
    const list = await owner.agent.get("/api/workspaces");
    expect(list.body.workspaces[0].settings).toEqual({ recipeRoastLevel: "light", roastScale: "names", hiddenFields: [], aiHidden: [], autoAnalyze: false, autoAnalyzeDelayMinutes: 10, autoAnalyzeDailyCap: null, suggestSource: "beanRecipe", suggestMaxBrews: 5, suggestAlternatives: [], readLabels: true, labelWebLookup: false, labelWebContext: "high", homeRoasting: false, homeRoasterName: "Home roast", restDays: { filter: 7, espresso: 14, omni: 10 } });
  });

  it("owners change them; others get 403; bad values 400", async () => {
    const owner = await newUser();
    const barista = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    const path = `/api/workspaces/${ws.id}/settings`;

    expect((await barista.agent.patch(path).send({ recipeRoastLevel: "dark" })).status).toBe(403);
    expect((await owner.agent.patch(path).send({ recipeRoastLevel: "burnt" })).status).toBe(400);
    expect((await owner.agent.patch(path).send({ somethingElse: true })).status).toBe(400);
    expect((await owner.agent.patch(path).send({})).status).toBe(400);

    const ok = await owner.agent.patch(path).send({ recipeRoastLevel: "medium" });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toEqual({ recipeRoastLevel: "medium", roastScale: "names", hiddenFields: [], aiHidden: [], autoAnalyze: false, autoAnalyzeDelayMinutes: 10, autoAnalyzeDailyCap: null, suggestSource: "beanRecipe", suggestMaxBrews: 5, suggestAlternatives: [], readLabels: true, labelWebLookup: false, labelWebContext: "high", homeRoasting: false, homeRoasterName: "Home roast", restDays: { filter: 7, espresso: 14, omni: 10 } });
    expect((await owner.agent.patch(path).send({ roastScale: "levels" })).body.settings).toEqual({ recipeRoastLevel: "medium", roastScale: "levels", hiddenFields: [], aiHidden: [], autoAnalyze: false, autoAnalyzeDelayMinutes: 10, autoAnalyzeDailyCap: null, suggestSource: "beanRecipe", suggestMaxBrews: 5, suggestAlternatives: [], readLabels: true, labelWebLookup: false, labelWebContext: "high", homeRoasting: false, homeRoasterName: "Home roast", restDays: { filter: 7, espresso: 14, omni: 10 } });
    expect((await owner.agent.patch(path).send({ roastScale: "agtron" })).status).toBe(400);
    expect((await owner.agent.patch(path).send({ readLabels: "yes" })).status).toBe(400);
    expect((await owner.agent.patch(path).send({ readLabels: false })).body.settings.readLabels).toBe(false);
    expect((await owner.agent.patch(path).send({ labelWebLookup: "yes" })).status).toBe(400);
    expect((await owner.agent.patch(path).send({ labelWebLookup: true })).body.settings.labelWebLookup).toBe(true);
    expect((await owner.agent.patch(path).send({ labelWebContext: "huge" })).status).toBe(400);
    expect((await owner.agent.patch(path).send({ labelWebContext: "low" })).body.settings.labelWebContext).toBe("low");
    // Home roasting: on/off, the roaster name, rest days for every roast type.
    const roasting = await owner.agent.patch(path).send({ homeRoasting: true, homeRoasterName: "  Garage roast ", restDays: { filter: 5, espresso: 12, omni: 8 } });
    expect(roasting.body.settings).toMatchObject({ homeRoasting: true, homeRoasterName: "Garage roast", restDays: { filter: 5, espresso: 12, omni: 8 } });
    for (const bad of [{ homeRoasterName: " " }, { restDays: { filter: 5 } }, { restDays: { filter: 5, espresso: 61, omni: 8 } }, { restDays: { filter: 5, espresso: 12, omni: 8, cold: 1 } }, { homeRoasting: "on" }]) {
      expect((await owner.agent.patch(path).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const list = await barista.agent.get("/api/workspaces");
    expect(list.body.workspaces[0].settings.recipeRoastLevel).toBe("medium");
  });

  it("hiddenFields: field keys, each once; replaced as a whole (docs/api/workspaces.md §2)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const path = `/api/workspaces/${ws.id}/settings`;
    const ok = await owner.agent.patch(path).send({ hiddenFields: ["brew.tds", "bean.website", "recipe.flowUnit", "green.lot"] });
    expect(ok.body.settings).toMatchObject({ roastScale: "names", hiddenFields: ["brew.tds", "bean.website", "recipe.flowUnit", "green.lot"] });
    expect((await owner.agent.patch(path).send({ hiddenFields: ["brew.tds"] })).body.settings.hiddenFields).toEqual(["brew.tds"]);
    for (const hiddenFields of [["tds"], ["menu.price"], ["brew.tds", "brew.tds"], "brew.tds", [3], Array.from({ length: 101 }, (_, i) => `brew.f${"x".repeat(i)}`)]) {
      expect((await owner.agent.patch(path).send({ hiddenFields })).status, JSON.stringify(hiddenFields).slice(0, 40)).toBe(400);
    }
    expect((await owner.agent.get("/api/workspaces")).body.workspaces[0].settings.hiddenFields).toEqual(["brew.tds"]);
  });

  it("auto-analyze: on/off, a wait of 0, 5, 10, 15 or 30 minutes, no cap or 1-500 a day (docs/api/analysis.md §8)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const path = `/api/workspaces/${ws.id}/settings`;
    const ok = await owner.agent.patch(path).send({ autoAnalyze: true, autoAnalyzeDelayMinutes: 15, autoAnalyzeDailyCap: 20 });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ autoAnalyze: true, autoAnalyzeDelayMinutes: 15, autoAnalyzeDailyCap: 20 });
    expect((await owner.agent.patch(path).send({ autoAnalyzeDailyCap: null })).body.settings.autoAnalyzeDailyCap).toBeNull();
    expect((await owner.agent.patch(path).send({ autoAnalyzeDelayMinutes: 0 })).body.settings.autoAnalyzeDelayMinutes).toBe(0);
    for (const bad of [{ autoAnalyze: "yes" }, { autoAnalyzeDelayMinutes: 7 }, { autoAnalyzeDelayMinutes: -5 }, { autoAnalyzeDelayMinutes: "10" }, { autoAnalyzeDailyCap: 0 }, { autoAnalyzeDailyCap: 501 }, { autoAnalyzeDailyCap: 2.5 }]) {
      expect((await owner.agent.patch(path).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("aiHidden: AI_DETAILS keys, each once; replaced as a whole (docs/api/llm-contract.md §9)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const path = `/api/workspaces/${ws.id}/settings`;
    const ok = await owner.agent.patch(path).send({ aiHidden: ["water", "origin", "analyzeUnrated"] });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ hiddenFields: [], aiHidden: ["water", "origin", "analyzeUnrated"] });
    expect((await owner.agent.patch(path).send({ aiHidden: ["tds"] })).body.settings.aiHidden).toEqual(["tds"]);
    for (const aiHidden of [["price"], ["tds", "tds"], "tds", [3], null]) {
      expect((await owner.agent.patch(path).send({ aiHidden })).status, JSON.stringify(aiHidden)).toBe(400);
    }
    expect((await owner.agent.get("/api/workspaces")).body.workspaces[0].settings.aiHidden).toEqual(["tds"]);
  });
});

describe("roast scale", () => {
  it("light to dark: the public menu and preview leave roast names out, the bean keeps it", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const W = `/api/workspaces/${ws.id}`;
    const bean = await newBean(owner, ws.id, { beanName: "Guji", detailedRoastLevel: "city_plus" });
    await menuAdd(owner, ws.id, await menuSection(owner, ws.id, "Coffee"), { itemType: "beans" });
    await owner.agent.patch(W).send({ isPublicMenuEnabled: true });
    const guestBean = async () => (await request(app).get(`/api/public/menu/${ws.slug}`)).body.sections[0].items[0].beans[0];

    expect(await guestBean()).toMatchObject({ roastLevel: "medium", detailedRoastLevel: "city_plus" });
    await owner.agent.patch(`${W}/settings`).send({ roastScale: "levels" });
    expect(await guestBean()).toMatchObject({ roastLevel: "medium", detailedRoastLevel: null });
    expect((await owner.agent.get(`${W}/menu/preview`)).body.sections[0].items[0].beans[0].detailedRoastLevel).toBeNull();
    const stored = (await owner.agent.get(`${W}/beans`)).body.beans.find((b: { id: string }) => b.id === bean);
    expect(stored.detailedRoastLevel).toBe("city_plus"); // kept, only hidden

    // Picking a different level in the form replaces the name (one PATCH).
    const changed = await owner.agent.patch(`${W}/beans/${bean}`).send({ detailedRoastLevel: null, roastLevel: "dark" });
    expect(changed.body.bean).toMatchObject({ detailedRoastLevel: null, roastLevel: "dark" });
  });
});

describe("preferences", () => {
  const defaults = { volumeUnit: "fl_oz", showBothVolumes: false, altitudeUnit: "m", temperatureUnit: "c", theme: "system", rateReminders: true, rateReminderMinutes: 15, rateLaterDefault: false, repeatKeeps: ["size", "doseWater", "temp", "grinder", "grind", "waterProfile", "dilution", "window"], rememberSetup: ["what", "brewer", "recipe", "bean", "grinder", "grind"], startDelays: {}, steepReminders: true };

  it("come back on register and /me, defaults filled in", async () => {
    const user = await newUser();
    expect((await user.agent.get("/api/auth/me")).body.user.preferences).toEqual(defaults);
  });

  it("merge what's sent, are validated, and are per person", async () => {
    const a = await newUser();
    const b = await newUser();
    const path = "/api/auth/me/preferences";

    expect((await a.agent.patch(path).send({ temperatureUnit: "kelvin" })).status).toBe(400);
    expect((await a.agent.patch(path).send({ showBothVolumes: "yes" })).status).toBe(400);
    expect((await a.agent.patch(path).send({})).status).toBe(400);

    expect((await a.agent.patch(path).send({ temperatureUnit: "f" })).body.preferences).toEqual({ ...defaults, temperatureUnit: "f" });
    const both = await a.agent.patch(path).send({ altitudeUnit: "ft", volumeUnit: "ml", showBothVolumes: true });
    expect(both.body.preferences).toEqual({ volumeUnit: "ml", showBothVolumes: true, altitudeUnit: "ft", temperatureUnit: "f", theme: "system", rateReminders: true, rateReminderMinutes: 15, rateLaterDefault: false, repeatKeeps: ["size", "doseWater", "temp", "grinder", "grind", "waterProfile", "dilution", "window"], rememberSetup: ["what", "brewer", "recipe", "bean", "grinder", "grind"], startDelays: {}, steepReminders: true });
    expect((await a.agent.patch(path).send({ theme: "dark" })).body.preferences.theme).toBe("dark");
    expect((await a.agent.patch(path).send({ theme: "sepia" })).status).toBe(400);

    const login = await a.agent.post("/api/auth/login").send({ email: a.email, password: a.password });
    expect(login.body.user.preferences.altitudeUnit).toBe("ft");
    expect((await b.agent.get("/api/auth/me")).body.user.preferences).toEqual(defaults);
  });

  it("startDelays: 0, 3 or 5 seconds per method, whole map replaced, per person (docs/api/auth.md §1)", async () => {
    const me = await newUser();
    const other = await newUser();
    const path = "/api/auth/me/preferences";
    const startDelays = { filter: 5, espresso: 0, stovetop: 3, other: 5 };
    const result = await me.agent.patch(path).send({ startDelays });
    expect(result.status).toBe(200);
    expect(result.body.preferences).toEqual({ ...defaults, startDelays });
    expect((await me.agent.get("/api/auth/me")).body.user.preferences.startDelays).toEqual(startDelays);
    expect((await other.agent.get("/api/auth/me")).body.user.preferences.startDelays).toEqual({});
    for (const startDelays of [{ filter: 1 }, { espresso: "3" }, { stovetop: null }, { other: 4 }, { siphon: 3 }, 3, null, []]) {
      expect((await me.agent.patch(path).send({ startDelays })).status, JSON.stringify(startDelays)).toBe(400);
    }
    const partial = await me.agent.patch(path).send({ startDelays: { espresso: 0 } });
    expect(partial.body.preferences.startDelays).toEqual({ espresso: 0 });
    await me.agent.patch(path).send({ temperatureUnit: "f" });
    expect((await me.agent.get("/api/auth/me")).body.user.preferences.startDelays).toEqual({ espresso: 0 });
    expect((await me.agent.patch(path).send({ startDelays: {} })).body.preferences.startDelays).toEqual({});
  });

  it("need a session", async () => {
    const { anonymous } = await import("./helpers.js");
    expect((await anonymous().patch("/api/auth/me/preferences").send({ temperatureUnit: "f" })).status).toBe(401);
  });

  it("repeatKeeps: what a repeat copies, each once, from the known list (docs/api/auth.md §1)", async () => {
    const me = await newUser();
    const path = "/api/auth/me/preferences";
    const ok = await me.agent.patch(path).send({ repeatKeeps: ["grind", "grinderWeights", "notes"] });
    expect(ok.body.preferences.repeatKeeps).toEqual(["grind", "grinderWeights", "notes"]);
    expect((await me.agent.patch(path).send({ repeatKeeps: [] })).body.preferences.repeatKeeps).toEqual([]);
    for (const repeatKeeps of [["rating"], ["grind", "grind"], "grind"]) {
      expect((await me.agent.patch(path).send({ repeatKeeps })).status, JSON.stringify(repeatKeeps)).toBe(400);
    }
  });

  it("rememberSetup: what the brew page remembers, each once, from the known list (docs/api/auth.md §1)", async () => {
    const me = await newUser();
    const path = "/api/auth/me/preferences";
    const ok = await me.agent.patch(path).send({ rememberSetup: ["bean", "waterProfile", "size"] });
    expect(ok.body.preferences.rememberSetup).toEqual(["bean", "waterProfile", "size"]);
    expect(ok.body.preferences.repeatKeeps).toEqual(defaults.repeatKeeps);
    expect((await me.agent.patch(path).send({ rememberSetup: [] })).body.preferences.rememberSetup).toEqual([]);
    for (const rememberSetup of [["dose"], ["bean", "bean"], "bean"]) {
      expect((await me.agent.patch(path).send({ rememberSetup })).status, JSON.stringify(rememberSetup)).toBe(400);
    }
  });
});

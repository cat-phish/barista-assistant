import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { addMember, menuAdd, menuSection, newBean, newUser, newWorkspace } from "./helpers.js";

// Units and defaults (docs/api/workspaces.md §2 settings, docs/api/auth.md §1 preferences).
describe("workspace settings", () => {
  it("come with every workspace, defaults filled in", async () => {
    const owner = await newUser();
    const created = await owner.agent.post("/api/workspaces").send({ name: "Bar", slug: "settings-bar" });
    expect(created.body.workspace.settings).toEqual({ recipeRoastLevel: "light", roastScale: "names", hiddenFields: [] });
    const list = await owner.agent.get("/api/workspaces");
    expect(list.body.workspaces[0].settings).toEqual({ recipeRoastLevel: "light", roastScale: "names", hiddenFields: [] });
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
    expect(ok.body.settings).toEqual({ recipeRoastLevel: "medium", roastScale: "names", hiddenFields: [] });
    expect((await owner.agent.patch(path).send({ roastScale: "levels" })).body.settings).toEqual({ recipeRoastLevel: "medium", roastScale: "levels", hiddenFields: [] });
    expect((await owner.agent.patch(path).send({ roastScale: "agtron" })).status).toBe(400);
    const list = await barista.agent.get("/api/workspaces");
    expect(list.body.workspaces[0].settings.recipeRoastLevel).toBe("medium");
  });

  it("hiddenFields: field keys, each once; replaced as a whole (docs/api/workspaces.md §2)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const path = `/api/workspaces/${ws.id}/settings`;
    const ok = await owner.agent.patch(path).send({ hiddenFields: ["brew.tds", "bean.website", "recipe.flowUnit"] });
    expect(ok.body.settings).toMatchObject({ roastScale: "names", hiddenFields: ["brew.tds", "bean.website", "recipe.flowUnit"] });
    expect((await owner.agent.patch(path).send({ hiddenFields: ["brew.tds"] })).body.settings.hiddenFields).toEqual(["brew.tds"]);
    for (const hiddenFields of [["tds"], ["menu.price"], ["brew.tds", "brew.tds"], "brew.tds", [3], Array.from({ length: 101 }, (_, i) => `brew.f${"x".repeat(i)}`)]) {
      expect((await owner.agent.patch(path).send({ hiddenFields })).status, JSON.stringify(hiddenFields).slice(0, 40)).toBe(400);
    }
    expect((await owner.agent.get("/api/workspaces")).body.workspaces[0].settings.hiddenFields).toEqual(["brew.tds"]);
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
  const defaults = { volumeUnit: "fl_oz", showBothVolumes: false, altitudeUnit: "m", temperatureUnit: "c", theme: "system" };

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
    expect(both.body.preferences).toEqual({ volumeUnit: "ml", showBothVolumes: true, altitudeUnit: "ft", temperatureUnit: "f", theme: "system" });
    expect((await a.agent.patch(path).send({ theme: "dark" })).body.preferences.theme).toBe("dark");
    expect((await a.agent.patch(path).send({ theme: "sepia" })).status).toBe(400);

    const login = await a.agent.post("/api/auth/login").send({ email: a.email, password: a.password });
    expect(login.body.user.preferences.altitudeUnit).toBe("ft");
    expect((await b.agent.get("/api/auth/me")).body.user.preferences).toEqual(defaults);
  });

  it("need a session", async () => {
    const { anonymous } = await import("./helpers.js");
    expect((await anonymous().patch("/api/auth/me/preferences").send({ temperatureUnit: "f" })).status).toBe(401);
  });
});

import { describe, expect, it } from "vitest";
import { brewerId, menuAdd, menuSection, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Grinder details (§3b), brewers (§3) and brewers on brew logs (§6).

async function setup(): Promise<{ owner: TestUser; ws: { id: string; slug: string } }> {
  const owner = await newUser("owner");
  return { owner, ws: await newWorkspace(owner) };
}

describe("grinder details", () => {
  it("are optional, validated, and the range is a pair", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/grinders`;
    const details = { adjustment: "stepped", settingMin: 0, settingMax: 40, stepSize: 1, burrType: "conical", burrSizeMm: 39, power: "manual" };
    const created = await owner.agent.post(base).send({ name: "C40", ...details });
    expect(created.status).toBe(201);
    expect(created.body.grinder).toMatchObject({ name: "C40", notes: null, ...details, retiredAt: null });
    expect((await owner.agent.post(base).send({ name: "Plain" })).body.grinder).toMatchObject({ adjustment: null, settingMin: null, power: null });

    expect((await owner.agent.post(base).send({ name: "A", adjustment: "dial" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "B", settingMin: 0 })).status).toBe(400); // one end
    expect((await owner.agent.post(base).send({ name: "C", settingMin: 10, settingMax: 5 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "D", stepSize: 0 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "E", burrSizeMm: 5 })).status).toBe(400);

    const url = `${base}/${created.body.grinder.id}`;
    expect((await owner.agent.patch(url).send({ settingMax: 30 })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ settingMin: 0.5, settingMax: 30.25 })).body.grinder).toMatchObject({ settingMin: 0.5, settingMax: 30.25 });
    expect((await owner.agent.patch(url).send({ settingMin: null })).body.grinder).toMatchObject({ settingMin: null, settingMax: null, stepSize: 1 });
  });
});

describe("brewers", () => {
  it("espresso capabilities default to none and are limited to the known values; retire like grinders", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/brewers`;
    const plain = await owner.agent.post(base).send({ name: "Gaggia Classic", kind: "espresso" });
    expect(plain.body.brewer).toEqual({
      id: expect.any(String),
      name: "Gaggia Classic",
      kind: "espresso",
      notes: null,
      preinfusion: "none",
      flowControl: "none",
      pressureControl: "none",
      retiredAt: null,
      createdAt: expect.any(String),
    });
    const lm = await owner.agent.post(base).send({ name: "Linea Mini", kind: "espresso", preinfusion: "manual", flowControl: "manual" });
    expect(lm.body.brewer).toMatchObject({ preinfusion: "manual", flowControl: "manual", pressureControl: "none" });
    expect((await owner.agent.post(base).send({ name: "X", preinfusion: "sometimes" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "linea mini" })).status).toBe(409);

    const url = `${base}/${lm.body.brewer.id}`;
    expect((await owner.agent.patch(url).send({ pressureControl: "programmable" })).body.brewer.pressureControl).toBe("programmable");
    expect((await owner.agent.patch(url).send({ retired: true })).body.brewer.retiredAt).not.toBeNull();
    const list = await owner.agent.get(base);
    expect(list.body.brewers.map((m: { name: string }) => m.name).at(-1)).toBe("Linea Mini"); // retired last
    expect((await owner.agent.patch(url).send({ retired: false })).body.brewer.retiredAt).toBeNull();
  });

  it("viewers can't change brewers", async () => {
    const { owner, ws } = await setup();
    const viewer = await newUser();
    await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: viewer.email, role: "viewer" });
    expect((await viewer.agent.get(`/api/workspaces/${ws.id}/brewers`)).status).toBe(200);
    expect((await viewer.agent.post(`/api/workspaces/${ws.id}/brewers`).send({ name: "M" })).status).toBe(403);
  });
});

describe("brewers on the menu", () => {
  it("show under the item's name, and not once retired", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/brewers`;
    const lm = (await owner.agent.post(base).send({ name: "Linea Mini", kind: "espresso" })).body.brewer.id;
    const latte = (await owner.agent.post(`/api/workspaces/${ws.id}/drinks`).send({ name: "Latte", kind: "espresso" })).body.drink.id;
    const section = await menuSection(owner, ws.id, "Espresso");
    await menuAdd(owner, ws.id, section, { itemType: "brewer", brewerId: lm, name: "Espresso shot" });
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const menu = async () => (await owner.agent.get(`/api/public/menu/${ws.slug}`)).body.sections.flatMap((s: { items: unknown[] }) => s.items);
    expect(await menu()).toEqual([
      expect.objectContaining({ type: "brewer", name: "Espresso shot", method: "Espresso" }),
      expect.objectContaining({ type: "drink", name: "Latte", method: "Espresso" }),
    ]);
    await owner.agent.patch(`${base}/${lm}`).send({ retired: true });
    expect((await menu()).map((i: { name: string }) => i.name)).toEqual(["Latte"]);
  });
});

describe("brewers on brew logs", () => {
  it("a log records its recipe's brewer; brewers brews used can only be retired", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const lm = (await owner.agent.post(`/api/workspaces/${ws.id}/brewers`).send({ name: "Linea Mini", kind: "espresso" })).body.brewer.id as string;
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    // Look the brewers up first: an await inside .send() runs another request mid-request.
    const v60 = await brewerId(owner, ws.id, "V60");
    const shot = (await owner.agent.post(recipes).send({ name: "S", brewerId: lm, targetDoseGrams: 18, expectedYieldGrams: 36 })).body.recipe.id;
    const filter = (await owner.agent.post(recipes).send({ name: "F", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id;
    const base = `/api/workspaces/${ws.id}/brew-logs`;

    const ok = await owner.agent.post(base).send({ beanId: bean, recipeId: shot, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 });
    expect(ok.status).toBe(201);
    expect(ok.body.brewLog).toMatchObject({ brewerId: lm, brewer: { id: lm, name: "Linea Mini", kind: "espresso" } });
    expect((await owner.agent.post(base).send({ beanId: bean, recipeId: shot, machineId: lm, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ beanId: bean, actualDoseGrams: 18, actualWaterGrams: 250, actualTimeSec: 28 })).body.brewLog.brewer).toBeNull();

    // A new recipe brings its brewer; other edits keep it.
    const url = `${base}/${ok.body.brewLog.id}`;
    expect((await owner.agent.patch(url).send({ rating: 4 })).body.brewLog.brewerId).toBe(lm);
    const moved = await owner.agent.patch(url).send({ recipeId: filter, actualWaterGrams: 250, actualYieldGrams: null });
    expect(moved.body.brewLog).toMatchObject({ brewerId: v60, brewer: { name: "V60" } });
    await owner.agent.patch(url).send({ recipeId: shot, actualWaterGrams: null, actualYieldGrams: 36 });

    // Recipes block the delete first; once they're gone, the brew history does.
    const del = () => owner.agent.delete(`/api/workspaces/${ws.id}/brewers/${lm}`);
    expect((await del()).body).toMatchObject({ recipeCount: 1 });
    await owner.agent.delete(`${recipes}/${shot}`);
    const refused = await del();
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ recipeCount: 0, brewLogCount: 1 });
    expect(refused.body.error).toMatch(/Retire it instead/);
    expect((await owner.agent.get(url)).body.brewLog.brewer).toMatchObject({ name: "Linea Mini" }); // kept after the recipe went
    const unused = (await owner.agent.post(`/api/workspaces/${ws.id}/brewers`).send({ name: "Chemex" })).body.brewer.id;
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/brewers/${unused}`)).status).toBe(204);
  });
});

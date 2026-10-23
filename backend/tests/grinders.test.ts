import { describe, expect, it } from "vitest";
import { addMember, brewerId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/grinders`;
  const grinder = async (name: string) => {
    const res = await owner.agent.post(base).send({ name });
    expect(res.status).toBe(201);
    return res.body.grinder.id as string;
  };
  return { owner, ws, base, grinder };
}

async function brew(user: TestUser, wsId: string, fields: Record<string, unknown>) {
  const res = await user.agent.post(`/api/workspaces/${wsId}/brew-logs`).send({ actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, ...fields });
  return res;
}

describe("grinders", () => {
  it("create, list (active first), rename, notes; names unique per workspace", async () => {
    const { owner, base, grinder } = await setup();
    const c40 = await grinder("Comandante C40");
    const res = await owner.agent.post(base).send({ name: "  Timemore C3 ", notes: "  stepped " });
    expect(res.body.grinder).toMatchObject({ name: "Timemore C3", notes: "stepped", archivedAt: null });
    expect(typeof res.body.grinder.createdAt).toBe("string"); // date added, for sorting lists
    expect((await owner.agent.post(base).send({ name: "comandante c40" })).status).toBe(409);

    await owner.agent.patch(`${base}/${c40}`).send({ archived: true });
    const list = await owner.agent.get(base);
    expect(list.body.grinders.map((g: { name: string }) => g.name)).toEqual(["Timemore C3", "Comandante C40"]);

    const renamed = await owner.agent.patch(`${base}/${c40}`).send({ name: "C40 MK4", notes: "" });
    expect(renamed.body.grinder).toMatchObject({ name: "C40 MK4", notes: null });
  });

  it("archive keeps the first archive date; restore clears it", async () => {
    const { owner, base, grinder } = await setup();
    const id = await grinder("Ode");
    const first = (await owner.agent.patch(`${base}/${id}`).send({ archived: true })).body.grinder.archivedAt;
    expect(first).toEqual(expect.any(String));
    await new Promise((r) => setTimeout(r, 1100));
    expect((await owner.agent.patch(`${base}/${id}`).send({ archived: true })).body.grinder.archivedAt).toBe(first);
    expect((await owner.agent.patch(`${base}/${id}`).send({ archived: false })).body.grinder.archivedAt).toBeNull();
  });

  it("usage counts brews and recipes; delete unlinks them", async () => {
    const { owner, ws, base, grinder } = await setup();
    const unused = await grinder("Unused");
    expect((await owner.agent.get(`${base}/${unused}/usage`)).body).toEqual({ brewLogCount: 0, recipeCount: 0 });
    expect((await owner.agent.delete(`${base}/${unused}`)).status).toBe(204);
    const used = await grinder("Used");
    const bean = await newBean(owner, ws.id);
    const logged = await brew(owner, ws.id, { beanId: bean, grinderId: used });
    expect((await owner.agent.get(`${base}/${used}/usage`)).body.brewLogCount).toBe(1);
    expect((await owner.agent.delete(`${base}/${used}`)).status).toBe(204);
    const log = (await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${logged.body.brewLog.id}`)).body.brewLog;
    expect(log).toMatchObject({ grinderId: null, grinder: null });
    expect((await owner.agent.get(`${base}/${used}/usage`)).status).toBe(404);
  });

  it("viewers read only; outsiders get 404", async () => {
    const { owner, ws, base, grinder } = await setup();
    const id = await grinder("Shared");
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${id}`).send({ archived: true })).status).toBe(403);
    expect((await outsider.agent.get(base)).status).toBe(404);
  });
});

describe("brew logs with grinders", () => {
  it("record the grinder (archived ones included) and refuse another workspace's", async () => {
    const { owner, ws, base, grinder } = await setup();
    const bean = await newBean(owner, ws.id);
    const c40 = await grinder("Comandante C40");
    const created = await brew(owner, ws.id, { beanId: bean, grinderId: c40, actualGrindSetting: "20" });
    expect(created.body.brewLog).toMatchObject({ grinderId: c40, grinder: { id: c40, name: "Comandante C40" } });

    await owner.agent.patch(`${base}/${c40}`).send({ archived: true });
    const shown = await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${created.body.brewLog.id}`);
    expect(shown.body.brewLog.grinder).toEqual({ id: c40, name: "Comandante C40" }); // history keeps it
    expect((await brew(owner, ws.id, { beanId: bean, grinderId: c40 })).status).toBe(201); // backdated logging allowed

    const other = await newUser();
    const otherWs = await newWorkspace(other);
    const foreign = (await other.agent.post(`/api/workspaces/${otherWs.id}/grinders`).send({ name: "Theirs" })).body.grinder.id;
    const res = await brew(owner, ws.id, { beanId: bean, grinderId: foreign });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/grinderId/);

    const cleared = await owner.agent.patch(`/api/workspaces/${ws.id}/brew-logs/${created.body.brewLog.id}`).send({ grinderId: null });
    expect(cleared.body.brewLog).toMatchObject({ grinderId: null, grinder: null });
  });

  it("last-setting: newest brew with this grinder AND recipe that has a setting", async () => {
    const { owner, ws, base, grinder } = await setup();
    const bean = await newBean(owner, ws.id);
    const c40 = await grinder("C40");
    const ode = await grinder("Ode");
    const v60 = await brewerId(owner, ws.id, "V60");
    const mk = async (name: string) =>
      (await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({ name, brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const house = await mk("House");
    const iced = await mk("Iced");
    const at = (d: string) => `2026-10-${d}T08:00:00Z`;
    await brew(owner, ws.id, { beanId: bean, recipeId: house, grinderId: c40, actualGrindSetting: "22", timestamp: at("10") });
    await brew(owner, ws.id, { beanId: bean, recipeId: house, grinderId: c40, actualGrindSetting: "20", timestamp: at("12") });
    await brew(owner, ws.id, { beanId: bean, recipeId: house, grinderId: c40, timestamp: at("14") }); // no setting: skipped
    await brew(owner, ws.id, { beanId: bean, recipeId: house, grinderId: ode, actualGrindSetting: "4.2", timestamp: at("15") }); // other grinder
    await brew(owner, ws.id, { beanId: bean, recipeId: iced, grinderId: c40, actualGrindSetting: "16", timestamp: at("16") }); // other recipe

    const last = await owner.agent.get(`${base}/${c40}/last-setting?recipeId=${house}`);
    expect(last.body.lastSetting).toMatchObject({ grindSetting: "20", timestamp: "2026-10-12T08:00:00.000Z" });
    expect((await owner.agent.get(`${base}/${ode}/last-setting?recipeId=${house}`)).body.lastSetting.grindSetting).toBe("4.2");
    expect((await owner.agent.get(`${base}/${ode}/last-setting?recipeId=${iced}`)).body.lastSetting).toBeNull();
    expect((await owner.agent.get(`${base}/${c40}/last-setting`)).status).toBe(400);
  });
});

describe("recipe default grinder", () => {
  it("is optional, must be in the workspace, and clears when the grinder is deleted", async () => {
    const owner = await newUser("owner");
    const ws = await newWorkspace(owner);
    const v60 = await brewerId(owner, ws.id, "V60");
    const grinder = (await owner.agent.post(`/api/workspaces/${ws.id}/grinders`).send({ name: "C40" })).body.grinder.id as string;
    const base = `/api/workspaces/${ws.id}/recipes`;
    const recipe = { name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 };

    expect((await owner.agent.post(base).send(recipe)).body.recipe.defaultGrinderId).toBeNull();
    const created = await owner.agent.post(base).send({ ...recipe, defaultGrinderId: grinder });
    expect(created.body.recipe.defaultGrinderId).toBe(grinder);

    const other = await newWorkspace(owner);
    const foreign = (await owner.agent.post(`/api/workspaces/${other.id}/grinders`).send({ name: "Elsewhere" })).body.grinder.id;
    expect((await owner.agent.post(base).send({ ...recipe, defaultGrinderId: foreign })).body.error).toMatch(/defaultGrinderId/);
    const url = `${base}/${created.body.recipe.id}`;
    expect((await owner.agent.patch(url).send({ defaultGrinderId: foreign })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ defaultGrinderId: null })).body.recipe.defaultGrinderId).toBeNull();

    await owner.agent.patch(url).send({ defaultGrinderId: grinder });
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/grinders/${grinder}`)).status).toBe(204); // a default doesn't block deleting
    expect((await owner.agent.get(base)).body.recipes.find((r: { id: string }) => r.id === created.body.recipe.id).defaultGrinderId).toBeNull();
  });
});

describe("grind speed", () => {
  it("grinders: variableSpeed with an optional RPM range, a pair, only when variable speed (docs/api/grinders.md §3b)", async () => {
    const { owner, base } = await setup();
    const created = await owner.agent.post(base).send({ name: "EK43", variableSpeed: true, rpmMin: 300, rpmMax: 1500 });
    expect(created.status).toBe(201);
    expect(created.body.grinder).toMatchObject({ variableSpeed: true, rpmMin: 300, rpmMax: 1500 });
    expect((await owner.agent.post(base).send({ name: "Plain" })).body.grinder).toMatchObject({ variableSpeed: false, rpmMin: null, rpmMax: null });

    expect((await owner.agent.post(base).send({ name: "A", variableSpeed: true, rpmMin: 300 })).status).toBe(400); // one end
    expect((await owner.agent.post(base).send({ name: "B", variableSpeed: true, rpmMin: 900, rpmMax: 600 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "C", variableSpeed: true, rpmMin: 10, rpmMax: 600 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "D", rpmMin: 300, rpmMax: 600 })).status).toBe(400); // not variable speed

    const url = `${base}/${created.body.grinder.id}`;
    expect((await owner.agent.patch(url).send({ rpmMin: 400, rpmMax: 1200 })).body.grinder).toMatchObject({ rpmMin: 400, rpmMax: 1200 });
    expect((await owner.agent.patch(url).send({ rpmMax: null })).body.grinder).toMatchObject({ variableSpeed: true, rpmMin: null, rpmMax: null });
    await owner.agent.patch(url).send({ rpmMin: 400, rpmMax: 1200 });
    // Switching it off clears the range; a range alone then needs it back on.
    expect((await owner.agent.patch(url).send({ variableSpeed: false })).body.grinder).toMatchObject({ variableSpeed: false, rpmMin: null, rpmMax: null });
    expect((await owner.agent.patch(url).send({ rpmMin: 400, rpmMax: 1200 })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ variableSpeed: false, rpmMin: 400, rpmMax: 1200 })).status).toBe(400);
  });

  it("brews: grindRpm only with a variable-speed grinder, within its range when sent (docs/api/brew-logs.md §6)", async () => {
    const { owner, ws, base } = await setup();
    const bean = await newBean(owner, ws.id);
    const ek = (await owner.agent.post(base).send({ name: "EK43", variableSpeed: true, rpmMin: 300, rpmMax: 1500 })).body.grinder.id as string;
    const free = (await owner.agent.post(base).send({ name: "DF64V", variableSpeed: true })).body.grinder.id as string;
    const fixed = (await owner.agent.post(base).send({ name: "C40" })).body.grinder.id as string;

    const created = await brew(owner, ws.id, { beanId: bean, grinderId: ek, grindRpm: 900 });
    expect(created.status).toBe(201);
    expect(created.body.brewLog.grindRpm).toBe(900);
    expect((await brew(owner, ws.id, { beanId: bean, grinderId: free, grindRpm: 2000 })).status).toBe(201); // no range: any 50–5000
    expect((await brew(owner, ws.id, { beanId: bean, grinderId: fixed })).body.brewLog.grindRpm).toBeNull();

    expect((await brew(owner, ws.id, { beanId: bean, grinderId: ek, grindRpm: 1600 })).status).toBe(400); // outside the range
    expect((await brew(owner, ws.id, { beanId: bean, grinderId: fixed, grindRpm: 900 })).status).toBe(400);
    expect((await brew(owner, ws.id, { beanId: bean, grindRpm: 900 })).status).toBe(400); // no grinder
    expect((await brew(owner, ws.id, { beanId: bean, grinderId: free, grindRpm: 900.5 })).status).toBe(400);

    const url = `/api/workspaces/${ws.id}/brew-logs/${created.body.brewLog.id}`;
    // A narrower range later doesn't block editing the notes, only a new RPM.
    await owner.agent.patch(`${base}/${ek}`).send({ rpmMin: 1000, rpmMax: 1500 });
    expect((await owner.agent.patch(url).send({ tastingNotes: "sweet" })).status).toBe(200);
    expect((await owner.agent.patch(url).send({ grindRpm: 800 })).status).toBe(400);
    // Moving to a grinder without speed control needs the RPM cleared too.
    expect((await owner.agent.patch(url).send({ grinderId: fixed })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ grinderId: fixed, grindRpm: null })).body.brewLog).toMatchObject({ grinderId: fixed, grindRpm: null });
  });
});

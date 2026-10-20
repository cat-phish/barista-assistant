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
    expect(res.body.grinder).toMatchObject({ name: "Timemore C3", notes: "stepped", retiredAt: null });
    expect((await owner.agent.post(base).send({ name: "comandante c40" })).status).toBe(409);

    await owner.agent.patch(`${base}/${c40}`).send({ retired: true });
    const list = await owner.agent.get(base);
    expect(list.body.grinders.map((g: { name: string }) => g.name)).toEqual(["Timemore C3", "Comandante C40"]);

    const renamed = await owner.agent.patch(`${base}/${c40}`).send({ name: "C40 MK4", notes: "" });
    expect(renamed.body.grinder).toMatchObject({ name: "C40 MK4", notes: null });
  });

  it("retire keeps the first retirement date; restore clears it", async () => {
    const { owner, base, grinder } = await setup();
    const id = await grinder("Ode");
    const first = (await owner.agent.patch(`${base}/${id}`).send({ retired: true })).body.grinder.retiredAt;
    expect(first).toEqual(expect.any(String));
    await new Promise((r) => setTimeout(r, 1100));
    expect((await owner.agent.patch(`${base}/${id}`).send({ retired: true })).body.grinder.retiredAt).toBe(first);
    expect((await owner.agent.patch(`${base}/${id}`).send({ retired: false })).body.grinder.retiredAt).toBeNull();
  });

  it("delete: allowed when unused, refused (409 + count) once brews used it", async () => {
    const { owner, ws, base, grinder } = await setup();
    expect((await owner.agent.delete(`${base}/${await grinder("Unused")}`)).status).toBe(204);
    const used = await grinder("Used");
    const bean = await newBean(owner, ws.id);
    expect((await brew(owner, ws.id, { beanId: bean, grinderId: used })).status).toBe(201);
    const res = await owner.agent.delete(`${base}/${used}`);
    expect(res.status).toBe(409);
    expect(res.body.brewLogCount).toBe(1);
  });

  it("viewers read only; outsiders get 404", async () => {
    const { owner, ws, base, grinder } = await setup();
    const id = await grinder("Shared");
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${id}`).send({ retired: true })).status).toBe(403);
    expect((await outsider.agent.get(base)).status).toBe(404);
  });
});

describe("brew logs with grinders", () => {
  it("record the grinder (retired ones included) and refuse another workspace's", async () => {
    const { owner, ws, base, grinder } = await setup();
    const bean = await newBean(owner, ws.id);
    const c40 = await grinder("Comandante C40");
    const created = await brew(owner, ws.id, { beanId: bean, grinderId: c40, actualGrindSetting: "20" });
    expect(created.body.brewLog).toMatchObject({ grinderId: c40, grinder: { id: c40, name: "Comandante C40" } });

    await owner.agent.patch(`${base}/${c40}`).send({ retired: true });
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

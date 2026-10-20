import { describe, expect, it } from "vitest";
import { methodId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Grinder details (§3b), machines (§3c) and machines on brew logs (§6).

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

describe("machines", () => {
  it("capabilities default to none and are limited to the known values", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/machines`;
    const plain = await owner.agent.post(base).send({ name: "Gaggia Classic" });
    expect(plain.body.machine).toEqual({
      id: expect.any(String),
      name: "Gaggia Classic",
      notes: null,
      preinfusion: "none",
      flowControl: "none",
      pressureControl: "none",
      retiredAt: null,
    });
    const lm = await owner.agent.post(base).send({ name: "Linea Mini", preinfusion: "manual", flowControl: "manual" });
    expect(lm.body.machine).toMatchObject({ preinfusion: "manual", flowControl: "manual", pressureControl: "none" });
    expect((await owner.agent.post(base).send({ name: "X", preinfusion: "sometimes" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "linea mini" })).status).toBe(409);

    const url = `${base}/${lm.body.machine.id}`;
    expect((await owner.agent.patch(url).send({ pressureControl: "programmable" })).body.machine.pressureControl).toBe("programmable");
    expect((await owner.agent.patch(url).send({ retired: true })).body.machine.retiredAt).not.toBeNull();
    const list = await owner.agent.get(base);
    expect(list.body.machines.map((m: { name: string }) => m.name)).toEqual(["Gaggia Classic", "Linea Mini"]); // retired last
    expect((await owner.agent.patch(url).send({ retired: false })).body.machine.retiredAt).toBeNull();
  });

  it("viewers can't change machines", async () => {
    const { owner, ws } = await setup();
    const viewer = await newUser();
    await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: viewer.email, role: "viewer" });
    expect((await viewer.agent.get(`/api/workspaces/${ws.id}/machines`)).status).toBe(200);
    expect((await viewer.agent.post(`/api/workspaces/${ws.id}/machines`).send({ name: "M" })).status).toBe(403);
  });
});

describe("machines on brew logs", () => {
  it("only espresso brews record one; used machines can't be deleted", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const machine = (await owner.agent.post(`/api/workspaces/${ws.id}/machines`).send({ name: "Linea Mini" })).body.machine.id as string;
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    // Look the methods up first: an await inside .send() runs another request mid-request.
    const [espresso, v60] = [await methodId(owner, ws.id, "Espresso"), await methodId(owner, ws.id, "V60")];
    const shot = (await owner.agent.post(recipes).send({ name: "S", methodId: espresso, targetDoseGrams: 18, expectedYieldGrams: 36 })).body.recipe.id;
    const filter = (await owner.agent.post(recipes).send({ name: "F", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id;
    const base = `/api/workspaces/${ws.id}/brew-logs`;

    const ok = await owner.agent.post(base).send({ beanId: bean, recipeId: shot, machineId: machine, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 });
    expect(ok.status).toBe(201);
    expect(ok.body.brewLog).toMatchObject({ machineId: machine, machine: { id: machine, name: "Linea Mini" } });

    const filterLog = { beanId: bean, recipeId: filter, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };
    expect((await owner.agent.post(base).send({ ...filterLog, machineId: machine })).body.error).toMatch(/machineId/);
    const plain = await owner.agent.post(base).send(filterLog);
    expect(plain.body.brewLog.machine).toBeNull();
    expect((await owner.agent.patch(`${base}/${plain.body.brewLog.id}`).send({ machineId: machine })).status).toBe(400);

    const other = await newWorkspace(owner);
    const foreign = (await owner.agent.post(`/api/workspaces/${other.id}/machines`).send({ name: "Other" })).body.machine.id;
    expect((await owner.agent.patch(`${base}/${ok.body.brewLog.id}`).send({ machineId: foreign })).body.error).toMatch(/not a machine in this workspace/);

    const del = await owner.agent.delete(`/api/workspaces/${ws.id}/machines/${machine}`);
    expect(del.status).toBe(409);
    expect(del.body.brewLogCount).toBe(1);
  });
});

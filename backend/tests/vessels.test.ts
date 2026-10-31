import { describe, expect, it } from "vitest";
import { addMember, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/vessels`;
  const logs = `/api/workspaces/${ws.id}/brew-logs`;
  const vessel = async (name = "Carafe", weightGrams = 312.5) => (await owner.agent.post(base).send({ name, weightGrams })).body.vessel.id as string;
  return { owner, ws, base, logs, vessel };
}

describe("vessels (docs/api/vessels.md §3g)", () => {
  it("adds, changes and lists them; name and weight are both required", async () => {
    const { owner, base } = await setup();
    const created = await owner.agent.post(base).send({ name: " Carafe ", weightGrams: 312.5 });
    expect(created.status).toBe(201);
    expect(created.body.vessel).toMatchObject({ name: "Carafe", weightGrams: 312.5, archivedAt: null });
    expect((await owner.agent.post(base).send({ name: "carafe", weightGrams: 1 })).status).toBe(409);
    expect((await owner.agent.post(base).send({ name: "Mug" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ weightGrams: 300 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "Mug", weightGrams: 0 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "Mug", weightGrams: 1.234 })).status).toBe(400);

    const id = created.body.vessel.id as string;
    expect((await owner.agent.patch(`${base}/${id}`).send({ weightGrams: 310 })).body.vessel.weightGrams).toBe(310);
    await owner.agent.post(base).send({ name: "Mug", weightGrams: 280 });
    await owner.agent.patch(`${base}/${id}`).send({ archived: true });
    const { vessels } = (await owner.agent.get(base)).body as { vessels: Array<{ name: string }> };
    expect(vessels.map((v) => v.name)).toEqual(["Mug", "Carafe"]); // active first
  });

  it("viewers read only; other workspaces can't see them", async () => {
    const { owner, ws, base, vessel } = await setup();
    const id = await vessel();
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "Mug", weightGrams: 280 })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${id}`)).status).toBe(403);
    const stranger = await newUser();
    expect((await stranger.agent.get(base)).status).toBe(404);
  });

  it("a brew keeps the weight it subtracted when the vessel is re-weighed", async () => {
    const { owner, ws, base, logs, vessel } = await setup();
    const id = await vessel();
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean, { actualYieldGrams: 225, vesselId: id, vesselWeightGrams: 312.5 });
    await owner.agent.patch(`${base}/${id}`).send({ weightGrams: 400 });
    const { brewLog } = (await owner.agent.get(`${logs}/${log}`)).body;
    expect(brewLog).toMatchObject({ actualYieldGrams: 225, vesselId: id, vesselWeightGrams: 312.5, vessel: { id, name: "Carafe" } });
  });

  it("a brew's vessel is both fields, with a yield, from this workspace", async () => {
    const { owner, ws, logs, vessel } = await setup();
    const id = await vessel();
    const bean = await newBean(owner, ws.id);
    const brew = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };
    expect((await owner.agent.post(logs).send({ ...brew, actualYieldGrams: 225, vesselId: id })).status).toBe(400);
    expect((await owner.agent.post(logs).send({ ...brew, actualYieldGrams: 225, vesselWeightGrams: 300 })).status).toBe(400);
    expect((await owner.agent.post(logs).send({ ...brew, vesselId: id, vesselWeightGrams: 300 })).status).toBe(400);

    const other = await setup();
    const theirs = await other.vessel();
    expect((await owner.agent.post(logs).send({ ...brew, actualYieldGrams: 225, vesselId: theirs, vesselWeightGrams: 300 })).status).toBe(400);

    const log = await newBrewLog(owner, ws.id, bean, { actualYieldGrams: 225, vesselId: id, vesselWeightGrams: 300 });
    expect((await owner.agent.patch(`${logs}/${log}`).send({ actualYieldGrams: null })).status).toBe(400);
    expect((await owner.agent.patch(`${logs}/${log}`).send({ vesselId: null })).status).toBe(400);
    const cleared = await owner.agent.patch(`${logs}/${log}`).send({ actualYieldGrams: null, vesselId: null, vesselWeightGrams: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.brewLog).toMatchObject({ vesselId: null, vesselWeightGrams: null, vessel: null });
  });

  it("deleting one counts its brews, which keep their yield and become weighed directly", async () => {
    const { owner, ws, base, logs, vessel } = await setup();
    const id = await vessel();
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean, { actualYieldGrams: 225, vesselId: id, vesselWeightGrams: 312.5 });
    expect((await owner.agent.get(`${base}/${id}/usage`)).body).toEqual({ brewLogCount: 1 });
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(204);
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(404);
    const { brewLog } = (await owner.agent.get(`${logs}/${log}`)).body;
    expect(brewLog).toMatchObject({ actualYieldGrams: 225, vesselId: null, vesselWeightGrams: null, vessel: null });
  });
});

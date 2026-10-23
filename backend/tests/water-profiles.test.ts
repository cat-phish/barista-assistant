import { describe, expect, it } from "vitest";
import { addMember, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/water-profiles`;
  const profile = async (name: string, fields: Record<string, unknown> = {}) => {
    const res = await owner.agent.post(base).send({ name, ...fields });
    expect(res.status).toBe(201);
    return res.body.waterProfile.id as string;
  };
  const list = async () => (await owner.agent.get(base)).body.waterProfiles as Array<{ id: string; name: string; isDefault: boolean }>;
  return { owner, ws, base, profile, list };
}

describe("water profiles (docs/api/water-profiles.md §3c)", () => {
  it("store every figure; blank notes become null; names unique per workspace", async () => {
    const { owner, base } = await setup();
    const figures = {
      tdsPpm: 150, generalHardnessPpm: 102.5, alkalinityPpm: 0, calciumPpm: 30, magnesiumPpm: 12.25,
      sodiumPpm: 5, potassiumPpm: 1, bicarbonatePpm: 40, chloridePpm: 8, sulfatePpm: 20, ph: 7.4,
    };
    const res = await owner.agent.post(base).send({ name: " Third Wave Water ", notes: " ", ...figures });
    expect(res.status).toBe(201);
    expect(res.body.waterProfile).toMatchObject({ name: "Third Wave Water", notes: null, isDefault: false, retiredAt: null, ...figures });
    expect((await owner.agent.post(base).send({ name: "third wave water" })).status).toBe(409);

    const bare = (await owner.agent.post(base).send({ name: "Tap" })).body.waterProfile;
    expect(bare).toMatchObject({ tdsPpm: null, calciumPpm: null, ph: null });
  });

  it("reject out-of-range figures", async () => {
    const { owner, base } = await setup();
    for (const fields of [{ tdsPpm: -1 }, { calciumPpm: 10000 }, { magnesiumPpm: 1.234 }, { ph: 14.1 }, { ph: 7.25 }, { isDefault: "yes" }, { name: "" }]) {
      expect((await owner.agent.post(base).send({ name: "W", ...fields })).status, JSON.stringify(fields)).toBe(400);
    }
  });

  it("at most one default: setting one clears the others", async () => {
    const { owner, base, profile, list } = await setup();
    const tap = await profile("Tap", { isDefault: true });
    const twW = await profile("TWW", { isDefault: true });
    expect((await list()).filter((p) => p.isDefault).map((p) => p.id)).toEqual([twW]);
    await owner.agent.patch(`${base}/${tap}`).send({ isDefault: true });
    expect((await list()).filter((p) => p.isDefault).map((p) => p.id)).toEqual([tap]);
    await owner.agent.patch(`${base}/${tap}`).send({ isDefault: false });
    expect((await list()).some((p) => p.isDefault)).toBe(false);
  });

  it("retiring the default clears it; a retired profile can't be the default until restored", async () => {
    const { owner, base, profile } = await setup();
    const id = await profile("Tap", { isDefault: true });
    const retired = (await owner.agent.patch(`${base}/${id}`).send({ retired: true })).body.waterProfile;
    expect(retired).toMatchObject({ isDefault: false, retiredAt: expect.any(String) });
    expect((await owner.agent.patch(`${base}/${id}`).send({ isDefault: true })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${id}`).send({ retired: true, isDefault: true })).status).toBe(400);
    const restored = await owner.agent.patch(`${base}/${id}`).send({ retired: false, isDefault: true });
    expect(restored.body.waterProfile).toMatchObject({ isDefault: true, retiredAt: null });
  });

  it("delete: allowed when unused, refused (409 + count) once brews used it", async () => {
    const { owner, ws, base, profile } = await setup();
    expect((await owner.agent.delete(`${base}/${await profile("Unused")}`)).status).toBe(204);
    const used = await profile("Used");
    await newBrewLog(owner, ws.id, await newBean(owner, ws.id), { waterProfileId: used });
    const res = await owner.agent.delete(`${base}/${used}`);
    expect(res.status).toBe(409);
    expect(res.body.brewLogCount).toBe(1);
  });

  it("viewers read only; outsiders get 404", async () => {
    const { owner, ws, base, profile } = await setup();
    const id = await profile("Shared");
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${id}`).send({ isDefault: true })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${id}`)).status).toBe(403);
    expect((await outsider.agent.get(base)).status).toBe(404);
  });
});

describe("brew logs with water profiles", () => {
  it("record the water (retired ones included), clear it, and refuse another workspace's", async () => {
    const { owner, ws, base, profile } = await setup();
    const bean = await newBean(owner, ws.id);
    const tap = await profile("Tap");
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const id = await newBrewLog(owner, ws.id, bean, { waterProfileId: tap });
    expect((await owner.agent.get(`${logs}/${id}`)).body.brewLog).toMatchObject({ waterProfileId: tap, waterProfile: { id: tap, name: "Tap" } });

    await owner.agent.patch(`${base}/${tap}`).send({ retired: true });
    expect((await owner.agent.get(logs)).body.brewLogs[0].waterProfile).toEqual({ id: tap, name: "Tap" });
    await newBrewLog(owner, ws.id, bean, { waterProfileId: tap }); // retired is still accepted

    const cleared = await owner.agent.patch(`${logs}/${id}`).send({ waterProfileId: null });
    expect(cleared.body.brewLog).toMatchObject({ waterProfileId: null, waterProfile: null });

    const other = await setup();
    const theirs = await other.profile("Theirs");
    const res = await owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, waterProfileId: theirs });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/waterProfileId/);
  });
});

import { describe, expect, it } from "vitest";
import { addMember, newBean, newUser, newWorkspace } from "./helpers.js";

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const bean = await newBean(owner, ws.id, { roastDate: "2026-10-01" });
  const base = `/api/workspaces/${ws.id}/beans/${bean}`;
  return { owner, ws, bean, base };
}

describe("freezing beans", () => {
  it("records freeze periods and returns them on every bean response", async () => {
    const { owner, ws, base } = await setup();
    const frozen = await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-05" });
    expect(frozen.status).toBe(200);
    expect(frozen.body.bean.freezePeriods).toEqual([{ id: expect.any(String), frozenOn: "2026-10-05", thawedOn: null }]);

    const thawed = await owner.agent.post(`${base}/thaw`).send({ date: "2026-10-08" });
    expect(thawed.body.bean.freezePeriods).toMatchObject([{ frozenOn: "2026-10-05", thawedOn: "2026-10-08" }]);

    await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-10" });
    const list = await owner.agent.get(`/api/workspaces/${ws.id}/beans`);
    expect(list.body.beans[0].freezePeriods).toMatchObject([
      { frozenOn: "2026-10-05", thawedOn: "2026-10-08" },
      { frozenOn: "2026-10-10", thawedOn: null },
    ]);
    // PATCH responses include them too.
    const patched = await owner.agent.patch(base).send({ beanName: "Renamed" });
    expect(patched.body.bean.freezePeriods).toHaveLength(2);
  });

  it("defaults the date to today", async () => {
    const { owner, base } = await setup();
    const res = await owner.agent.post(`${base}/freeze`).send({});
    expect(res.body.bean.freezePeriods[0].frozenOn).toBe(today());
  });

  it("refuses double freeze, thaw when not frozen, and impossible dates", async () => {
    const { owner, base } = await setup();
    expect((await owner.agent.post(`${base}/thaw`).send({})).status).toBe(409);
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-09-30" })).body.error).toMatch(/before the roast date/);
    expect((await owner.agent.post(`${base}/freeze`).send({ date: daysFromNow(3) })).body.error).toMatch(/future/);
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "10/05/2026" })).status).toBe(400);
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-05", extra: 1 })).status).toBe(400);

    await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-05" });
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-06" })).status).toBe(409);
    expect((await owner.agent.post(`${base}/thaw`).send({ date: "2026-10-04" })).body.error).toMatch(/before it was frozen/);
    expect((await owner.agent.post(`${base}/thaw`).send({ date: "2026-10-09" })).status).toBe(200);
    // A new freeze can't start inside the previous period.
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-07" })).body.error).toMatch(/before the last thaw/);
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-09" })).status).toBe(200);
  });

  it("is for owners and baristas; outsiders get 404", async () => {
    const { owner, ws, base } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.post(`${base}/freeze`).send({})).status).toBe(403);
    expect((await outsider.agent.post(`${base}/freeze`).send({})).status).toBe(404);
  });

  it("freeze history is deleted with the bean", async () => {
    const { owner, ws, base } = await setup();
    await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-05" });
    expect((await owner.agent.delete(base)).status).toBe(204);
    const { db } = await import("../src/db.js");
    const { beanFreezes } = await import("@barista/shared/schema");
    expect(await db.select().from(beanFreezes)).toEqual([]);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/beans`)).body.beans).toEqual([]);
  });
});

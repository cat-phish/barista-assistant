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

  it("reports frozen from the history", async () => {
    const { owner, ws, base } = await setup();
    const list = async () => (await owner.agent.get(`/api/workspaces/${ws.id}/beans`)).body.beans[0];
    expect((await list()).frozen).toBe(false);
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-05" })).body.bean.frozen).toBe(true);
    expect((await list()).frozen).toBe(true);
    expect((await owner.agent.post(`${base}/thaw`).send({ date: "2026-10-06" })).body.bean.frozen).toBe(false);
  });
});

describe("correcting the latest freeze period", () => {
  async function twoPeriods() {
    const s = await setup();
    await s.owner.agent.post(`${s.base}/freeze`).send({ date: "2026-10-03" });
    await s.owner.agent.post(`${s.base}/thaw`).send({ date: "2026-10-06" });
    await s.owner.agent.post(`${s.base}/freeze`).send({ date: "2026-10-08" });
    await s.owner.agent.post(`${s.base}/thaw`).send({ date: "2026-10-10" });
    return { ...s, latest: `${s.base}/freezes/latest` };
  }

  it("edits the latest period's dates, only within the rules", async () => {
    const { owner, latest } = await twoPeriods();
    const res = await owner.agent.patch(latest).send({ frozenOn: "2026-10-07", thawedOn: "2026-10-12" });
    expect(res.status).toBe(200);
    expect(res.body.bean.freezePeriods).toMatchObject([
      { frozenOn: "2026-10-03", thawedOn: "2026-10-06" }, // the earlier period is untouched
      { frozenOn: "2026-10-07", thawedOn: "2026-10-12" },
    ]);
    const error = async (body: Record<string, unknown>) => (await owner.agent.patch(latest).send(body)).body.error as string;
    expect(await error({ frozenOn: "2026-10-05" })).toMatch(/before the previous thaw/);
    expect(await error({ thawedOn: "2026-10-06" })).toMatch(/before it was frozen/);
    expect(await error({ frozenOn: "2026-10-13" })).toMatch(/before it was frozen/); // after its own thaw
    expect(await error({ thawedOn: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) })).toMatch(/future/);
    expect((await owner.agent.patch(latest).send({})).status).toBe(400);
    expect((await owner.agent.patch(latest).send({ frozenOn: "2026-10-07", extra: 1 })).status).toBe(400);
  });

  it("can't move the only period before the roast date", async () => {
    const { owner, base } = await setup();
    await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-05" });
    expect((await owner.agent.patch(`${base}/freezes/latest`).send({ frozenOn: "2026-09-30" })).body.error).toMatch(/roast date/);
    expect((await owner.agent.patch(`${base}/freezes/latest`).send({ frozenOn: "2026-10-01" })).status).toBe(200);
  });

  it("un-thaws: the bean is frozen again from the same period", async () => {
    const { owner, base, latest } = await twoPeriods();
    const res = await owner.agent.patch(latest).send({ thawedOn: null });
    expect(res.body.bean.frozen).toBe(true);
    expect(res.body.bean.freezePeriods[1]).toMatchObject({ frozenOn: "2026-10-08", thawedOn: null });
    // Already frozen again, so a new freeze is refused; thawing works.
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-11" })).status).toBe(409);
    expect((await owner.agent.post(`${base}/thaw`).send({ date: "2026-10-11" })).status).toBe(200);
  });

  it("deletes the latest period; the one before becomes the latest", async () => {
    const { owner, base, latest } = await twoPeriods();
    const res = await owner.agent.delete(latest);
    expect(res.status).toBe(200);
    expect(res.body.bean.freezePeriods).toMatchObject([{ frozenOn: "2026-10-03", thawedOn: "2026-10-06" }]);
    expect((await owner.agent.patch(latest).send({ thawedOn: "2026-10-07" })).body.bean.freezePeriods).toMatchObject([
      { frozenOn: "2026-10-03", thawedOn: "2026-10-07" },
    ]);
    await owner.agent.delete(latest);
    expect((await owner.agent.delete(latest)).status).toBe(404);
    expect((await owner.agent.patch(latest).send({ thawedOn: null })).status).toBe(404);
    // With the history gone, a freeze can start anywhere after the roast again.
    expect((await owner.agent.post(`${base}/freeze`).send({ date: "2026-10-02" })).status).toBe(200);
  });

  it("is for owners and baristas", async () => {
    const { owner, ws, latest } = await twoPeriods();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.patch(latest).send({ thawedOn: null })).status).toBe(403);
    expect((await viewer.agent.delete(latest)).status).toBe(403);
    expect((await outsider.agent.delete(latest)).status).toBe(404);
  });
});

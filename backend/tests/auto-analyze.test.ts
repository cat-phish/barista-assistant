import { describe, expect, it } from "vitest";
import { brewAnalysisJobId } from "@barista/shared/jobs";
import { brewAnalysisQueue } from "../src/queue.js";
import { newBean, newBrewLog, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Auto-analyze (docs/api/analysis.md §8).
async function setup(settings: Record<string, unknown> = { autoAnalyze: true, autoAnalyzeDelayMinutes: 5 }): Promise<{ owner: TestUser; ws: { id: string }; bean: string }> {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  await owner.agent.patch(`/api/workspaces/${ws.id}/settings`).send(settings);
  return { owner, ws, bean: await newBean(owner, ws.id) };
}
const job = (id: string) => brewAnalysisQueue.getJob(brewAnalysisJobId(id));
const entry = async (owner: TestUser, ws: string, id: string) => (await owner.agent.get(`/api/workspaces/${ws}/brew-logs/${id}`)).body.brewLog;

describe("auto-analyze", () => {
  it("is off by default: saving a brew queues nothing, and it shows as not analyzed", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const id = await newBrewLog(owner, ws.id, await newBean(owner, ws.id), { rating: 4 });
    expect(await job(id)).toBeUndefined();
    expect(await entry(owner, ws.id, id)).toMatchObject({ analyzed: false, analysisDueAt: null, analysisError: null });
  });

  it("queues a rated brew after the workspace's wait, marked auto, and says when it's due", async () => {
    const { owner, ws, bean } = await setup();
    const before = Date.now();
    const res = await owner.agent.post(`/api/workspaces/${ws.id}/brew-logs`).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, rating: 4 });
    expect(res.status).toBe(201);
    const id = res.body.brewLog.id as string;
    const queued = await job(id);
    expect(queued?.data).toEqual({ brewLogId: id, auto: true });
    expect(queued?.opts.delay).toBe(5 * 60_000);
    expect(await queued?.isDelayed()).toBe(true);
    const due = new Date(res.body.brewLog.analysisDueAt).getTime();
    expect(due).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1000);
    expect(due).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
    const listed = (await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs`)).body.brewLogs[0];
    expect(listed).toMatchObject({ id, analyzed: false, analysisDueAt: res.body.brewLog.analysisDueAt });
  });

  it("an unrated brew waits for its first rating, then is analyzed straight away", async () => {
    const { owner, ws, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean);
    expect(await job(id)).toBeUndefined();
    const rated = await owner.agent.patch(`/api/workspaces/${ws.id}/brew-logs/${id}`).send({ rating: 3 });
    expect(rated.body.brewLog.analysisDueAt).not.toBeNull();
    const queued = await job(id);
    expect(queued?.data).toEqual({ brewLogId: id, auto: true });
    expect(await queued?.isDelayed()).toBe(false);
    // Changing the rating again doesn't queue another.
    await brewAnalysisQueue.obliterate({ force: true });
    await owner.agent.patch(`/api/workspaces/${ws.id}/brew-logs/${id}`).send({ rating: 4 });
    expect(await job(id)).toBeUndefined();
  });

  it("doesn't re-analyze a brew already analyzed when it's rated later", async () => {
    const { owner, ws, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean);
    const { db } = await import("../src/db.js");
    const { llmAnalyses } = await import("@barista/shared/schema");
    await db.insert(llmAnalyses).values({ id: crypto.randomUUID(), brewLogId: id, reasoning: "r", suggestedGrindDelta: "finer", suggestedTempDelta: 0 });
    await owner.agent.patch(`/api/workspaces/${ws.id}/brew-logs/${id}`).send({ rating: 3 });
    expect(await job(id)).toBeUndefined();
    expect(await entry(owner, ws.id, id)).toMatchObject({ analyzed: true });
  });

  it("a cold brew waits until it's finished with a rating", async () => {
    const { owner, ws, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean, { steeping: true, steepMinHours: 12, steepMaxHours: 18 });
    expect(await job(id)).toBeUndefined();
    await owner.agent.patch(`/api/workspaces/${ws.id}/brew-logs/${id}`).send({ steeping: false, rating: 4, actualTimeSec: 50_000 });
    expect((await job(id))?.data).toEqual({ brewLogId: id, auto: true });
  });

  it("asking for it while it waits runs it now, as asked for, and clears the due time", async () => {
    const { owner, ws, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean, { rating: 4 });
    expect(await (await job(id))?.isDelayed()).toBe(true);
    const asked = await owner.agent.post(`/api/brew-logs/${id}/analyze`);
    expect(asked.status).toBe(202);
    expect(asked.body.jobId).toBe(brewAnalysisJobId(id));
    const now = await job(id);
    expect(await now?.isDelayed()).toBe(false);
    expect(now?.data).toEqual({ brewLogId: id }); // no longer auto: the cap doesn't apply
    expect(await brewAnalysisQueue.getWaitingCount()).toBe(1);
    expect(await entry(owner, ws.id, id)).toMatchObject({ analysisDueAt: null, analysisError: null });
  });

  it("deleting the brew removes its waiting analysis", async () => {
    const { owner, ws, bean } = await setup();
    const id = await newBrewLog(owner, ws.id, bean, { rating: 4 });
    expect(await job(id)).toBeDefined();
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/brew-logs/${id}`)).status).toBe(204);
    expect(await job(id)).toBeUndefined();
  });
});

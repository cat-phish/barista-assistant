import { describe, expect, it } from "vitest";
import { addMember, newUser, newWorkspace } from "./helpers.js";
import { recapSummaryQueue } from "../src/queue.js";

// A recap's AI summary (docs/api/recaps.md §11c, "AI summary").
describe("recap summaries", () => {
  const week = { kind: "weekly", periodStart: "2026-11-02", scope: "mine" } as const;

  it("queues a summary for a period that has ended, and reads it back", async () => {
    const owner = await newUser("owner");
    const ws = (await newWorkspace(owner)).id;
    const base = `/api/workspaces/${ws}/recaps`;
    const query = `?kind=weekly&periodStart=2026-11-02&scope=mine`;
    expect((await owner.agent.get(base + query)).body).toEqual({ recap: null });

    const res = await owner.agent.post(base).send(week);
    expect(res.status).toBe(202);
    expect(res.body.recap).toMatchObject({ ...week, status: "pending", summary: null, highlights: [], error: null });
    const jobs = await recapSummaryQueue.getJobs(["waiting", "delayed", "prioritized"]);
    expect(jobs.some((j) => j.opts.attempts === 2)).toBe(true);
    // Asked again while pending: the same one.
    expect((await owner.agent.post(base).send(week)).body.recap.status).toBe("pending");
    expect((await owner.agent.get(base + query)).body.recap).toMatchObject({ status: "pending" });
    // Everyone's is its own.
    expect((await owner.agent.get(`${base}?kind=weekly&periodStart=2026-11-02&scope=all`)).body.recap).toBeNull();
  });

  it("refuses a period not started on a period start, in progress, or with summaries off", async () => {
    const owner = await newUser("owner");
    const ws = (await newWorkspace(owner)).id;
    const base = `/api/workspaces/${ws}/recaps`;
    expect((await owner.agent.post(base).send({ ...week, periodStart: "2026-11-03" })).status).toBe(400); // a Tuesday
    expect((await owner.agent.post(base).send({ ...week, kind: "yearly" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ kind: "monthly", periodStart: "2999-01-01", scope: "mine" })).body.code).toBe("recap_in_progress");
    // Sunday weeks: 1 Nov is a start.
    await owner.agent.patch("/api/auth/me/preferences").send({ weekStartsOn: 0 });
    expect((await owner.agent.post(base).send({ ...week, periodStart: "2026-11-01" })).status).toBe(202);
    await owner.agent.patch("/api/auth/me/preferences").send({ recapAi: "off" });
    const off = await owner.agent.post(base).send({ kind: "monthly", periodStart: "2026-10-01", scope: "all" });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe("recap_ai_off");
  });

  it("viewers can read but not ask; others' workspaces are off limits", async () => {
    const owner = await newUser("owner");
    const viewer = await newUser("viewer");
    const stranger = await newUser("stranger");
    const ws = (await newWorkspace(owner)).id;
    await addMember(owner, ws, viewer, "viewer");
    const base = `/api/workspaces/${ws}/recaps`;
    expect((await viewer.agent.post(base).send(week)).status).toBe(403);
    expect((await viewer.agent.get(`${base}?kind=weekly&periodStart=2026-11-02&scope=mine`)).status).toBe(200);
    expect((await stranger.agent.get(`${base}?kind=weekly&periodStart=2026-11-02&scope=mine`)).status).toBe(404);
  });
});

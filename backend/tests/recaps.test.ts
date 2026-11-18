import { describe, expect, it } from "vitest";
import { addMember, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";
import * as schema from "@barista/shared/schema";
import { freezeYearInCoffee } from "@barista/shared/yearFreeze";
import { db } from "../src/db.js";
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
    expect((await owner.agent.post(base).send({ ...week, kind: "yearly" })).status).toBe(400); // not 1 January
    expect((await owner.agent.post(base).send({ kind: "yearly", periodStart: "2999-01-01", scope: "mine" })).body.code).toBe("recap_in_progress");
    expect((await owner.agent.post(base).send({ kind: "monthly", periodStart: "2999-01-01", scope: "mine" })).body.code).toBe("recap_in_progress");
    // Sunday weeks: 1 Nov is a start.
    await owner.agent.patch("/api/auth/me/preferences").send({ weekStartsOn: 0 });
    expect((await owner.agent.post(base).send({ ...week, periodStart: "2026-11-01" })).status).toBe(202);
    // Automatic summaries off still leaves Write summary (docs/api/recaps.md §11c).
    await owner.agent.patch("/api/auth/me/preferences").send({ recapAutoSummaries: { weekly: false, monthly: false, yearly: false, yearInCoffee: false } });
    expect((await owner.agent.post(base).send({ kind: "monthly", periodStart: "2026-10-01", scope: "all" })).status).toBe(202);
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

// Your Year in Coffee's frozen copy (docs/api/recaps.md §11c "Your Year in Coffee").
describe("Your Year in Coffee, frozen", () => {
  it("counts 1 January–6 December per scope, live until the worker freezes it", async () => {
    const owner = await newUser("owner");
    const other = await newUser("other");
    const ws = (await newWorkspace(owner)).id;
    await addMember(owner, ws, other, "barista");
    const bean = await newBean(owner, ws, { country: "Kenya" });
    await newBrewLog(owner, ws, bean, { timestamp: "2024-06-01T08:00:00.000Z", utcOffsetMinutes: 0 });
    await newBrewLog(owner, ws, bean, { timestamp: "2025-03-01T08:00:00.000Z", utcOffsetMinutes: 0, rating: 4 });
    await newBrewLog(owner, ws, bean, { timestamp: "2025-12-06T20:00:00.000Z", utcOffsetMinutes: 0 });
    await newBrewLog(owner, ws, bean, { timestamp: "2025-12-07T08:00:00.000Z", utcOffsetMinutes: 0 }); // after the window
    await newBrewLog(other, ws, bean, { timestamp: "2025-05-01T08:00:00.000Z", utcOffsetMinutes: 0 });
    const url = (year: number, scope: string) => `/api/workspaces/${ws}/recaps/year-in-coffee/${year}?scope=${scope}`;

    const mine = await owner.agent.get(url(2025, "mine"));
    expect(mine.status).toBe(200);
    expect(mine.body.year).toMatchObject({ version: 1, period: { start: "2025-01-01", end: "2025-12-06" } });
    expect(mine.body.year.figures).toMatchObject({ year: 2025, recap: { brews: 2, previousBrews: 1 }, origins: [] });
    expect(mine.body.year.history.map((h: { year: number }) => h.year)).toEqual([2024]);
    expect((await owner.agent.get(url(2025, "all"))).body.year.figures.recap.brews).toBe(3);

    // Not frozen by opening it: counted live, nothing saved.
    expect(mine.body.frozen).toBe(false);
    expect(await db.select().from(schema.recaps)).toHaveLength(0);
    await newBrewLog(owner, ws, bean, { timestamp: "2025-04-01T08:00:00.000Z", utcOffsetMinutes: 0 });
    expect((await owner.agent.get(url(2025, "mine"))).body.year.figures.recap.brews).toBe(3);

    // Frozen (by the worker, from 7 December): a brew added later doesn't change it.
    await freezeYearInCoffee(db, ws, owner.id, 2025, "mine", "2025-12-07");
    await newBrewLog(owner, ws, bean, { timestamp: "2025-04-02T08:00:00.000Z", utcOffsetMinutes: 0 });
    const frozen = (await owner.agent.get(url(2025, "mine"))).body;
    expect(frozen).toMatchObject({ frozen: true, year: { figures: { recap: { brews: 3 } } } });
    // Someone else's is their own.
    expect((await other.agent.get(url(2025, "mine"))).body.year.figures.recap.brews).toBe(1);
  });

  it("isn't out before 7 December, and checks what it's asked", async () => {
    const owner = await newUser("owner");
    const stranger = await newUser("stranger");
    const ws = (await newWorkspace(owner)).id;
    const url = (rest: string) => `/api/workspaces/${ws}/recaps/year-in-coffee/${rest}`;
    expect((await owner.agent.get(url("2999?scope=mine"))).body.code).toBe("year_not_out");
    expect((await owner.agent.get(url("2025?scope=both"))).status).toBe(400);
    expect((await owner.agent.get(url("twenty?scope=mine"))).status).toBe(400);
    expect((await stranger.agent.get(url("2025?scope=mine"))).status).toBe(404);
  });
});

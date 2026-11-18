import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogGuests, brewLogs, brewServings, guests, recaps, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { requestRecapSummary, type RecapSummary } from "../src/llm.js";
import { resolveAi } from "../src/ai/resolve.js";
import type { AiClient } from "../src/ai/client.js";
import { loadPeriodContext, PERIOD_MAX_BREWS, spreadAcrossMonths } from "../src/periodContext.js";
import { toPeriodInput } from "../src/prompt.js";
import { writeRecapSummary } from "../src/recapSummary.js";
import { freezeYearInCoffee } from "@barista/shared/yearFreeze";

// docs/api/llm-contract.md §9f: real database, fake AI.
vi.mock("../src/llm.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/llm.js")>()), requestRecapSummary: vi.fn() }));
vi.mock("../src/ai/resolve.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/ai/resolve.js")>()), resolveAi: vi.fn() }));
const llm = vi.mocked(requestRecapSummary);
vi.mocked(resolveAi).mockResolvedValue({ provider: "openai", models: { main: "gpt-test", vision: "v", web: "w" } } as unknown as AiClient);
const ANSWER: RecapSummary = { summary: "A steady week on the V60.", highlights: ["Ramped Bloom rated best", "Try one click finer"] };

let userId: string;
let otherId: string;
let workspaceId: string;
let beanId: string;
let brewerId: string;
const brew = (timestamp: string, fields: Partial<typeof brewLogs.$inferInsert> = {}) =>
  db.insert(brewLogs).values({ id: randomUUID(), workspaceId, userId, beanId, brewerId, timestamp: new Date(timestamp), utcOffsetMinutes: 0, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, ...fields });

beforeEach(async () => {
  userId = randomUUID();
  otherId = randomUUID();
  workspaceId = randomUUID();
  beanId = randomUUID();
  brewerId = randomUUID();
  await db.insert(users).values([
    { id: userId, email: "a@example.com", passwordHash: "x" },
    { id: otherId, email: "b@example.com", passwordHash: "x" },
  ]);
  await db.insert(workspaces).values({ id: workspaceId, name: "Home", slug: "home" });
  await db.insert(workspaceMembers).values([
    { userId, workspaceId, role: "owner" },
    { userId: otherId, workspaceId, role: "barista" },
  ]);
  await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
  await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji" });
  llm.mockReset();
});

const week = { start: "2026-11-02", end: "2026-11-08" };
const before = { start: "2026-10-26", end: "2026-11-01" };

describe("loadPeriodContext", () => {
  it("has the period's brews (newest first), its figures and the period before's", async () => {
    await brew("2026-11-03T08:00:00Z", { rating: 4, tdsPercent: 1.4 });
    await brew("2026-11-07T08:00:00Z", { rating: 4.5 });
    await brew("2026-11-08T23:30:00Z", { utcOffsetMinutes: 60 }); // Monday 9 Nov there: next week
    await brew("2026-10-30T08:00:00Z", { rating: 3 });
    await brew("2026-11-04T08:00:00Z", { userId: otherId, rating: 5 });
    await brew("2026-11-05T08:00:00Z", { steeping: true }); // no result yet

    const ctx = await loadPeriodContext({ workspaceId, userId, kind: "weekly", period: week, previous: before });
    expect(ctx.brews.map((b) => b.day)).toEqual(["2026-11-07", "2026-11-03"]);
    expect(ctx.brews[0]).toMatchObject({ bean: "Onyx – Guji", brewer: "V60", rating: 4.5 });
    expect(ctx.figures).toEqual({
      brews: 2, daysBrewed: 2, ratedBrews: 2, averageRating: 4.3, bestRating: 4.5, coffeeGrams: 30, brewsForOthers: 0,
      beans: [{ bean: "Onyx – Guji", brews: 2 }], recipes: [], brewers: [{ brewer: "V60", brews: 2 }],
    });
    expect(ctx.previousFigures).toMatchObject({ brews: 1, averageRating: 3 });
    expect(ctx.brewsLeftOut).toBe(0);

    const everyone = await loadPeriodContext({ workspaceId, userId: null, kind: "weekly", period: week, previous: null });
    expect(everyone.figures.brews).toBe(3);
    expect(everyone.previousFigures).toBeNull();
  });

  it("counts the brews made for guests, without naming them (backlog 67)", async () => {
    const id = () => randomUUID();
    const [named, unnamed, notMine, batch] = [id(), id(), id(), id()];
    const sam = id();
    await db.insert(guests).values({ id: sam, workspaceId, name: "Sam" });
    await brew("2026-11-03T08:00:00Z");
    await brew("2026-11-03T09:00:00Z", { id: named });
    await brew("2026-11-03T10:00:00Z", { id: unnamed, unnamedGuests: 2 });
    await brew("2026-11-03T11:00:00Z", { id: notMine, forMe: false, unnamedGuests: 1 });
    await brew("2026-11-03T12:00:00Z", { id: batch });
    await db.insert(brewLogGuests).values({ brewLogId: named, guestId: sam });
    await db.insert(brewServings).values({ id: id(), brewLogId: batch, userId, concentrateGrams: 100, forGuest: true });

    const ctx = await loadPeriodContext({ workspaceId, userId, kind: "weekly", period: week, previous: null });
    expect(ctx.figures.brewsForOthers).toBe(4);
    expect(JSON.stringify(toPeriodInput(ctx, new Set()))).not.toContain("Sam");
  });

  it("sends the newest brews up to the cap and counts the rest", async () => {
    for (let i = 0; i < PERIOD_MAX_BREWS + 2; i++) await brew(new Date(Date.UTC(2026, 10, 2, 6) + i * 600_000).toISOString());
    const ctx = await loadPeriodContext({ workspaceId, userId, kind: "weekly", period: week, previous: null });
    expect(ctx.brews).toHaveLength(PERIOD_MAX_BREWS);
    expect(ctx.brewsLeftOut).toBe(2);
    expect(ctx.figures.brews).toBe(PERIOD_MAX_BREWS + 2);
    expect(toPeriodInput(ctx).brewsLeftOut).toBe(2);
    expect(ctx.brewsChosen).toBe("newest");
    expect(ctx.months).toBeUndefined();
  });

  it("a year: every month's figures, and brews spread across its months when there are too many", async () => {
    for (let i = 0; i < 20; i++) await brew(new Date(Date.UTC(2026, 0, 2, 6) + i * 3_600_000).toISOString(), { rating: 2 + (i % 4) }); // January
    for (let i = 0; i < 70; i++) await brew(new Date(Date.UTC(2026, 11, 2, 6) + i * 3_600_000).toISOString()); // December, unrated
    await brew("2026-06-10T08:00:00Z", { rating: 5 });
    const ctx = await loadPeriodContext({ workspaceId, userId, kind: "yearly", period: { start: "2026-01-01", end: "2026-12-31" }, previous: null });
    expect(ctx.figures.brews).toBe(91);
    expect(ctx.months!.map((m) => [m.month, m.brews])).toEqual([["2026-01", 20], ["2026-06", 1], ["2026-12", 70]]);
    expect(ctx.brewsChosen).toBe("spreadAcrossMonths");
    expect(ctx.brews).toHaveLength(PERIOD_MAX_BREWS);
    const perMonth = (m: string) => ctx.brews.filter((b) => b.day.startsWith(m)).length;
    expect([perMonth("2026-01"), perMonth("2026-06"), perMonth("2026-12")]).toEqual([20, 1, 39]);
    expect(ctx.brewsLeftOut).toBe(31);
    expect(toPeriodInput(ctx)).toMatchObject({ brewsChosen: "spreadAcrossMonths", months: expect.any(Array) });
  });
});

describe("spreadAcrossMonths", () => {
  const at = (month: number, day: number, rating: number | null) => ({ id: `${month}-${day}`, timestamp: new Date(Date.UTC(2026, month, day, 12)), utcOffsetMinutes: 0, rating });
  it("shares evenly, a month's best and lowest rated in turn, then the newest unrated", () => {
    const rows = [at(1, 9, null), at(1, 8, null), at(1, 5, 3), at(1, 4, 5), at(1, 3, 1), at(1, 2, 4), at(0, 3, 4), at(0, 2, 2), at(0, 1, 3)];
    expect(spreadAcrossMonths(rows, 4).map((b) => b.id)).toEqual(["1-4", "1-3", "0-3", "0-2"]);
    expect(spreadAcrossMonths(rows, 7).map((b) => b.id)).toEqual(["1-5", "1-4", "1-3", "1-2", "0-3", "0-2", "0-1"]);
    expect(spreadAcrossMonths(rows, 8).map((b) => b.id)).toEqual(["1-9", "1-5", "1-4", "1-3", "1-2", "0-3", "0-2", "0-1"]);
  });
});

describe("writeRecapSummary", () => {
  const recap = async (fields: Partial<typeof recaps.$inferInsert> = {}) => {
    const id = randomUUID();
    await db.insert(recaps).values({ id, workspaceId, userId, kind: "weekly", periodStart: "2026-11-02", scope: "mine", status: "pending", ...fields });
    return id;
  };

  it("saves the summary, with the model, version and tokens", async () => {
    await brew("2026-11-03T08:00:00Z", { rating: 4, tdsPercent: 1.4 });
    await db.update(workspaces).set({ settings: { aiHidden: ["tds"] } }).where(eq(workspaces.id, workspaceId));
    llm.mockResolvedValue({ summary: ANSWER, usage: { promptTokens: 900, completionTokens: 120 } });
    const id = await recap();
    expect(await writeRecapSummary({ recapId: id })).toEqual({ status: "saved", id });
    const [row] = await db.select().from(recaps).where(eq(recaps.id, id));
    expect(row).toMatchObject({ status: "done", summary: ANSWER.summary, highlights: ANSWER.highlights, error: null, model: "gpt-test", promptVersion: expect.stringMatching(/^2026-/), promptTokens: 900, completionTokens: 120 });
    // The period, with the previous one, and the workspace's hidden details.
    const [, context, hidden] = llm.mock.calls[0]!;
    expect(context.period).toEqual(week);
    expect(context.previous).toEqual(before);
    expect([...(hidden ?? [])]).toEqual(["tds"]);
  });

  it("a year gets its months' written summaries, same scope", async () => {
    await brew("2026-03-03T08:00:00Z", { rating: 4 });
    const month = (periodStart: string, fields: Partial<typeof recaps.$inferInsert> = {}) =>
      db.insert(recaps).values({ id: randomUUID(), workspaceId, userId, kind: "monthly", periodStart, scope: "mine", status: "done", summary: `Summary ${periodStart}`, highlights: ["One"], ...fields });
    await month("2026-03-01");
    await month("2026-01-01");
    await month("2026-02-01", { status: "failed", summary: null });
    await month("2026-04-01", { scope: "all" });
    await month("2025-12-01");
    llm.mockResolvedValue({ summary: ANSWER, usage: null });
    await writeRecapSummary({ recapId: await recap({ kind: "yearly", periodStart: "2026-01-01" }) });
    expect(llm.mock.calls[0]![1].monthlySummaries).toEqual([
      { month: "2026-01", summary: "Summary 2026-01-01", highlights: ["One"] },
      { month: "2026-03", summary: "Summary 2026-03-01", highlights: ["One"] },
    ]);
  });

  it("Your Year in Coffee: 1 January–6 December, its months to November, the frozen highlights", async () => {
    await brew("2026-03-03T08:00:00Z", { rating: 4 });
    await brew("2026-03-04T08:00:00Z", { rating: 3 });
    await brew("2026-12-10T08:00:00Z", { rating: 5 }); // after the window
    for (const periodStart of ["2026-11-01", "2026-12-01"])
      await db.insert(recaps).values({ id: randomUUID(), workspaceId, userId, kind: "monthly", periodStart, scope: "mine", status: "done", summary: `Summary ${periodStart}`, highlights: [] });
    await freezeYearInCoffee(db, workspaceId, userId, 2026, "mine", "2026-12-07");
    await db.update(workspaces).set({ settings: { aiHidden: ["origin"] } }).where(eq(workspaces.id, workspaceId));
    const [row] = await db.select({ id: recaps.id }).from(recaps).where(eq(recaps.kind, "yearInCoffee"));
    llm.mockResolvedValue({ summary: ANSWER, usage: null });
    expect(await writeRecapSummary({ recapId: row!.id })).toEqual({ status: "saved", id: row!.id });
    const [, context, hidden] = llm.mock.calls[0]!;
    expect(context).toMatchObject({ kind: "yearInCoffee", period: { start: "2026-01-01", end: "2026-12-06" }, previous: { start: "2025-01-01", end: "2025-12-06" } });
    expect(context.figures.brews).toBe(2);
    expect(context.monthlySummaries?.map((m) => m.month)).toEqual(["2026-11"]); // December's runs past 6 December
    expect(context.yearHighlights).toMatchObject({ longestStreak: { days: 2, start: "2026-03-03", end: "2026-03-04" }, busiestMonth: null }); // too few brews for that card
    // Origins follow their switch, as on a brew.
    const input = toPeriodInput(context, hidden) as { yearHighlights: Record<string, unknown> };
    expect(input.yearHighlights.origins).toBeUndefined();
    expect(input.yearHighlights.longestStreak).toBeDefined();
    expect((await db.select().from(recaps).where(eq(recaps.id, row!.id)))[0]).toMatchObject({ status: "done", summary: ANSWER.summary, figures: expect.anything() });
  });

  it("everyone's brews for scope all; fails a period without brews", async () => {
    await brew("2026-11-04T08:00:00Z", { userId: otherId, rating: 5 });
    llm.mockResolvedValue({ summary: ANSWER, usage: null });
    await writeRecapSummary({ recapId: await recap({ scope: "all" }) });
    expect(llm.mock.calls[0]![1].figures.brews).toBe(1);
    const mine = await recap();
    expect(await writeRecapSummary({ recapId: mine })).toEqual({ status: "skipped", reason: "no brews" });
    expect((await db.select().from(recaps).where(eq(recaps.id, mine)))[0]).toMatchObject({ status: "failed", error: "No brews in this period" });
  });
});

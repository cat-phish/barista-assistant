import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogs, recaps, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { requestRecapSummary, type RecapSummary } from "../src/llm.js";
import { resolveAi } from "../src/ai/resolve.js";
import type { AiClient } from "../src/ai/client.js";
import { loadPeriodContext, PERIOD_MAX_BREWS } from "../src/periodContext.js";
import { toPeriodInput } from "../src/prompt.js";
import { writeRecapSummary } from "../src/recapSummary.js";

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
      brews: 2, daysBrewed: 2, ratedBrews: 2, averageRating: 4.3, bestRating: 4.5, coffeeGrams: 30,
      beans: [{ bean: "Onyx – Guji", brews: 2 }], recipes: [], brewers: [{ brewer: "V60", brews: 2 }],
    });
    expect(ctx.previousFigures).toMatchObject({ brews: 1, averageRating: 3 });
    expect(ctx.brewsLeftOut).toBe(0);

    const everyone = await loadPeriodContext({ workspaceId, userId: null, kind: "weekly", period: week, previous: null });
    expect(everyone.figures.brews).toBe(3);
    expect(everyone.previousFigures).toBeNull();
  });

  it("sends the newest brews up to the cap and counts the rest", async () => {
    for (let i = 0; i < PERIOD_MAX_BREWS + 2; i++) await brew(new Date(Date.UTC(2026, 10, 2, 6) + i * 600_000).toISOString());
    const ctx = await loadPeriodContext({ workspaceId, userId, kind: "weekly", period: week, previous: null });
    expect(ctx.brews).toHaveLength(PERIOD_MAX_BREWS);
    expect(ctx.brewsLeftOut).toBe(2);
    expect(ctx.figures.brews).toBe(PERIOD_MAX_BREWS + 2);
    expect(toPeriodInput(ctx).brewsLeftOut).toBe(2);
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

import { randomUUID } from "node:crypto";
import { calendarDates, periodLabel, resolveChatPeriod, type ChatPeriodSpec } from "@barista/shared/chatPeriod";
import { beans, brewers, brewLogs, recipes, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadAttachments } from "../src/chat.js";
import { periodCap, periodInput } from "../src/chatPeriodInput.js";
import { db } from "../src/db.js";
import { loadPeriodContext } from "../src/periodContext.js";

// A live Period attachment in chat (docs/api/chat.md §12, "Periods").
const spec = (fields: Partial<ChatPeriodSpec> = {}): ChatPeriodSpec => ({ range: "7d", from: null, to: null, beanId: null, recipeId: null, brewerId: null, mine: false, ...fields });

describe("resolveChatPeriod", () => {
  it("counts a rolling range back from today, the same number of days before it", () => {
    expect(resolveChatPeriod(spec({ range: "7d" }), "2026-11-09")).toEqual({ period: { start: "2026-11-03", end: "2026-11-09" }, previous: { start: "2026-10-27", end: "2026-11-02" } });
    expect(resolveChatPeriod(spec({ range: "30d" }), "2026-11-09").period.start).toBe("2026-10-11");
  });
  it("compares a calendar month with the month before, custom dates with as many days before", () => {
    expect(resolveChatPeriod(spec({ range: "month", from: "2026-10-01", to: "2026-10-31" }), "2026-11-09").previous).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(resolveChatPeriod(spec({ range: "custom", from: "2026-10-10", to: "2026-10-12" }), "2026-11-09").previous).toEqual({ start: "2026-10-07", end: "2026-10-09" });
  });
  it("leaves all time open, with nothing before", () => {
    expect(resolveChatPeriod(spec({ range: "all" }), "2026-11-09")).toEqual({ period: { start: null, end: "2026-11-09" }, previous: null });
  });
});

describe("calendarDates", () => {
  it("fixes this and last week on the workspace's week start, and the months", () => {
    // 9 Nov 2026 is a Monday.
    expect(calendarDates("thisWeek", "2026-11-09", 1)).toEqual({ range: "week", from: "2026-11-09", to: "2026-11-15" });
    expect(calendarDates("lastWeek", "2026-11-09", 1)).toEqual({ range: "week", from: "2026-11-02", to: "2026-11-08" });
    expect(calendarDates("lastWeek", "2026-11-09", 0)).toEqual({ range: "week", from: "2026-11-01", to: "2026-11-07" });
    expect(calendarDates("thisMonth", "2026-11-09", 1)).toEqual({ range: "month", from: "2026-11-01", to: "2026-11-30" });
    expect(calendarDates("lastMonth", "2026-01-09", 1)).toEqual({ range: "month", from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("periodLabel", () => {
  it("names the days and the filters", () => {
    expect(periodLabel(spec({ range: "30d", mine: true }), { bean: "Guji" })).toBe("Brews, last 30 days · Guji · Only mine");
    expect(periodLabel(spec({ range: "week", from: "2026-10-26", to: "2026-11-01" }), {})).toBe("Brews, 26 Oct – 1 Nov");
    expect(periodLabel(spec({ range: "month", from: "2026-10-01", to: "2026-10-31" }), {})).toBe("Brews, October 2026");
    expect(periodLabel(spec({ range: "all" }), { brewer: "V60" })).toBe("Brews, all time · V60");
  });
});

describe("periodCap", () => {
  it("is the workspace's, or the person's own when lower", () => {
    expect(periodCap(60, null)).toBe(60);
    expect(periodCap(60, 20)).toBe(20);
    expect(periodCap(60, 200)).toBe(60);
  });
});

describe("a Period attachment", () => {
  let userId: string;
  let otherId: string;
  let workspaceId: string;
  let beanId: string;
  let otherBeanId: string;
  let brewerId: string;
  let recipeId: string;
  const now = new Date("2026-11-09T12:00:00Z");
  const brew = (timestamp: string, fields: Partial<typeof brewLogs.$inferInsert> = {}) =>
    db.insert(brewLogs).values({ id: randomUUID(), workspaceId, userId, beanId, brewerId, timestamp: new Date(timestamp), utcOffsetMinutes: 0, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, ...fields });

  beforeEach(async () => {
    userId = randomUUID();
    otherId = randomUUID();
    workspaceId = randomUUID();
    beanId = randomUUID();
    otherBeanId = randomUUID();
    brewerId = randomUUID();
    recipeId = randomUUID();
    await db.insert(users).values([
      { id: userId, email: `${userId}@example.com`, passwordHash: "x" },
      { id: otherId, email: `${otherId}@example.com`, passwordHash: "x" },
    ]);
    await db.insert(workspaces).values({ id: workspaceId, name: "Home", slug: workspaceId });
    await db.insert(workspaceMembers).values([
      { userId, workspaceId, role: "owner" },
      { userId: otherId, workspaceId, role: "barista" },
    ]);
    await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
    await db.insert(recipes).values({ id: recipeId, workspaceId, brewerId, name: "House", targetDoseGrams: 15 });
    await db.insert(beans).values([
      { id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji" },
      { id: otherBeanId, workspaceId, roasterName: "Onyx", beanName: "Monarch" },
    ]);
  });

  it("narrows to a bean, a recipe, a brewer and the chat owner's brews", async () => {
    await brew("2026-11-08T08:00:00Z", { recipeId, rating: 4 });
    await brew("2026-11-07T08:00:00Z", { beanId: otherBeanId });
    await brew("2026-11-06T08:00:00Z", { userId: otherId, recipeId });
    await brew("2026-10-30T08:00:00Z", { recipeId, rating: 3 }); // the 7 days before
    const input = await periodInput(spec({ beanId, recipeId, mine: true }), workspaceId, { userId }, now);
    expect(input).toMatchObject({ period: { start: "2026-11-03", end: "2026-11-09" }, filters: "Onyx – Guji · House · Only mine", figures: { brews: 1, averageRating: 4 }, previousFigures: { brews: 1, averageRating: 3 } });
    const everyone = await periodInput(spec({ brewerId }), workspaceId, { userId }, now);
    expect(everyone).toMatchObject({ filters: "V60", figures: { brews: 3 } });
  });

  it("is run again for each reply: a brew logged since is in it", async () => {
    const attachment = { kind: "period" as const, id: randomUUID(), label: "Brews, last 7 days", period: spec() };
    await brew("2026-11-08T08:00:00Z");
    const first = await loadAttachments([attachment], workspaceId, { userId });
    await brew(new Date().toISOString());
    const second = await loadAttachments([attachment], workspaceId, { userId });
    expect(((first[0]!.data as { figures: { brews: number } }).figures.brews)).toBeLessThan((second[0]!.data as { figures: { brews: number } }).figures.brews);
  });

  it("covers all time, with no period before", async () => {
    await brew("2024-01-02T08:00:00Z");
    await brew("2026-11-08T08:00:00Z");
    const input = await periodInput(spec({ range: "all" }), workspaceId, { userId }, now);
    expect(input).toMatchObject({ period: { end: "2026-11-09" }, figures: { brews: 2 } });
    expect(input?.previousPeriod).toBeUndefined();
  });

  it("sends the lower of the workspace's and the person's cap in detail", async () => {
    for (let i = 0; i < 14; i++) await brew(new Date(Date.UTC(2026, 10, 8, 6) + i * 600_000).toISOString());
    await db.update(workspaces).set({ settings: { chatPeriodMaxBrews: 12 } }).where(eq(workspaces.id, workspaceId));
    expect(await periodInput(spec(), workspaceId, { userId }, now)).toMatchObject({ brewsLeftOut: 2, figures: { brews: 14 } });
    const own = await periodInput(spec(), workspaceId, { userId, periodMaxBrews: 10 }, now);
    expect(own?.brews).toHaveLength(10);
    expect(own?.brewsLeftOut).toBe(4);
  });

  it("is unavailable when a filter is gone or from another workspace", async () => {
    const other = randomUUID();
    await db.insert(workspaces).values({ id: other, name: "O", slug: other });
    const [gone] = await loadAttachments([{ kind: "period", id: randomUUID(), label: "Brews, last 7 days · Guji", period: spec({ beanId }) }], other, { userId });
    expect(gone).toEqual({ ref: "a1", kind: "period", label: "Brews, last 7 days · Guji", unavailable: true });
    expect(await periodInput(spec({ mine: true }), workspaceId, { userId: null }, now)).toBeNull();
  });

  it("leaves recaps as they were: no filters, the default cap", async () => {
    await brew("2026-11-03T08:00:00Z");
    const ctx = await loadPeriodContext({ workspaceId, userId, kind: "weekly", period: { start: "2026-11-02", end: "2026-11-08" }, previous: null });
    expect(ctx.filters).toBeNull();
    expect(ctx.figures.brews).toBe(1);
  });
});

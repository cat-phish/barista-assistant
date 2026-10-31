import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogs, users, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBeanReviewContext } from "../src/beanReview.js";
import { db } from "../src/db.js";
import { beanReviewSent, parseBeanReviewMessage, requestBeanReview } from "../src/llm.js";
import { processAiPreview, processBeanReview } from "../src/processor.js";

// Real database, fake LLM.
vi.mock("../src/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/llm.js")>()),
  requestBeanReview: vi.fn(),
}));
const llm = vi.mocked(requestBeanReview);

const reply = (body: unknown) => ({ content: JSON.stringify(body), refusal: null });

describe("parseBeanReviewMessage (docs/api/llm-contract.md §9d)", () => {
  it("rounds the rating to a half step within 0.5-5", () => {
    expect(parseBeanReviewMessage(reply({ review: " Lovely. ", suggestedRating: 3.8 }))).toEqual({ review: "Lovely.", suggestedRating: 4 });
    expect(parseBeanReviewMessage(reply({ review: "Bad.", suggestedRating: 0 })).suggestedRating).toBe(0.5);
    expect(parseBeanReviewMessage(reply({ review: "Good.", suggestedRating: 9 })).suggestedRating).toBe(5);
  });
  it("cuts a long review, and refuses an empty one", () => {
    expect(parseBeanReviewMessage(reply({ review: "x".repeat(2500), suggestedRating: 4 })).review).toHaveLength(2000);
    expect(() => parseBeanReviewMessage(reply({ review: "  ", suggestedRating: 4 }))).toThrow();
  });
});

describe("a bean review's brews", () => {
  let workspaceId: string;
  let userId: string;
  let bean: string;
  let other: string;
  let v60: string;
  let chemex: string;
  const brew = (beanId: string, day: number, brewerId: string | null, rating: number | null, steeping = false) =>
    db.insert(brewLogs).values({ id: randomUUID(), workspaceId, userId, beanId, brewerId, rating, steeping, tastingNotes: `day ${day}`, timestamp: new Date(Date.UTC(2026, 9, day)), actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 });

  beforeEach(async () => {
    llm.mockReset();
    workspaceId = randomUUID();
    userId = randomUUID();
    bean = randomUUID();
    other = randomUUID();
    v60 = randomUUID();
    chemex = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x" });
    await db.insert(workspaces).values({ id: workspaceId, name: "Bar", slug: workspaceId });
    await db.insert(beans).values([bean, other].map((id) => ({ id, workspaceId, roasterName: "Onyx", beanName: "Guji", inventoryWeightGrams: 100, showOnPublicMenu: false })));
    await db.insert(brewers).values([{ id: v60, workspaceId, name: "V60", kind: "filter" as const }, { id: chemex, workspaceId, name: "Chemex", kind: "filter" as const }]);
    await brew(bean, 1, v60, 3);
    await brew(bean, 2, chemex, 4);
    await brew(bean, 3, v60, null);
    await brew(bean, 4, v60, 5, true); // steeping
    await brew(other, 5, v60, 1); // another bag
  });
  const job = (over = {}) => ({ beanId: bean, brewerIds: null, maxBrews: 10, ratedOnly: false, requestedBy: userId, note: null, ...over });
  const days = async (over = {}) => (await loadBeanReviewContext(job(over)))?.brews.map((b) => b.tastingNotes);

  it("sends this bag's finished brews, newest first, with the brewer's name", async () => {
    const context = await loadBeanReviewContext(job());
    expect(context?.brews.map((b) => [b.tastingNotes, b.brewer])).toEqual([["day 3", "V60"], ["day 2", "Chemex"], ["day 1", "V60"]]);
  });
  it("filters by brewer, rated only and how many", async () => {
    expect(await days({ brewerIds: [chemex] })).toEqual(["day 2"]);
    expect(await days({ ratedOnly: true })).toEqual(["day 2", "day 1"]);
    expect(await days({ maxBrews: 1 })).toEqual(["day 3"]);
  });
  it("has nothing to review with no match, or the bean gone", async () => {
    expect(await loadBeanReviewContext(job({ brewerIds: [randomUUID()] }))).toBeNull();
    expect(await processBeanReview(job({ beanId: randomUUID() }))).toBeNull();
    expect(llm).not.toHaveBeenCalled();
  });
  it("answers with the draft and how many brews it read, and hides what the workspace hides", async () => {
    llm.mockResolvedValue({ review: "Juicy.", suggestedRating: 4 });
    await db.update(workspaces).set({ settings: { aiHidden: ["origin"] } }).where(eq(workspaces.id, workspaceId));
    expect(await processBeanReview(job())).toEqual({ review: "Juicy.", suggestedRating: 4, brewCount: 3 });
    expect(llm.mock.calls[0]![1]).toEqual(new Set(["origin"]));
  });
  it("previews the same request, with the note, without asking the AI", async () => {
    const preview = await processAiPreview({ kind: "beanReview", review: job({ note: "Mostly with milk." }) });
    expect(preview?.sections).toEqual(["reviewCore", "reviewOutput", "note", "end"]);
    expect(preview?.system).toContain("Mostly with milk.");
    expect(llm).not.toHaveBeenCalled();
    const context = await loadBeanReviewContext(job());
    expect(beanReviewSent(context!).input).toMatchObject({ ratingScale: "0.5-5", brews: expect.any(Array) });
  });
});

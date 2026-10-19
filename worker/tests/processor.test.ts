import { randomUUID } from "node:crypto";
import { beans, brewLogs, brewMethods, llmAnalyses, recipes, recipeSteps, users, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrewContext } from "../src/context.js";
import { db } from "../src/db.js";
import { analyzeWithLlm } from "../src/llm.js";
import { processBrewAnalysis } from "../src/processor.js";

// Real database, fake LLM.
vi.mock("../src/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/llm.js")>()),
  analyzeWithLlm: vi.fn(),
}));
const llm = vi.mocked(analyzeWithLlm);
const ANALYSIS = { reasoning: "Under-extracted: grind finer.", suggestedGrindDelta: "finer" as const, suggestedTempDelta: 1 };

let beanId: string;
let workspaceId: string;
let userId: string;
const logIds: Record<string, string> = {};

// One bean roasted 2026-10-01, a V60 recipe with steps, and brews on days 2..9.
beforeEach(async () => {
  llm.mockReset();
  workspaceId = randomUUID();
  userId = randomUUID();
  beanId = randomUUID();
  const methodId = randomUUID();
  const recipeId = randomUUID();
  await db.insert(users).values({ id: userId, email: "b@example.com", passwordHash: "x" });
  await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: "w" });
  await db.insert(brewMethods).values({ id: methodId, workspaceId, name: "V60" });
  await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji", roastDate: new Date("2026-10-01T00:00:00Z") });
  await db.insert(recipes).values({ id: recipeId, workspaceId, name: "House V60", methodId, targetDoseGrams: 15, targetYieldGrams: 250, targetTempC: 94 });
  await db.insert(recipeSteps).values([
    { id: randomUUID(), recipeId, stepOrder: 1, actionName: "Bloom", targetTimeSec: 45, targetWaterGrams: 50 },
    { id: randomUUID(), recipeId, stepOrder: 2, actionName: "Pour", targetTimeSec: 150, targetWaterGrams: 250 },
  ]);
  for (let day = 2; day <= 9; day++) {
    const id = randomUUID();
    logIds[`day${day}`] = id;
    await db.insert(brewLogs).values({
      id, workspaceId, userId, beanId, recipeId: day === 8 ? recipeId : null,
      timestamp: new Date(`2026-10-0${day}T08:00:00Z`),
      actualDoseGrams: 15, actualYieldGrams: 250, actualTimeSec: 140 + day, rating: 3, tastingNotes: `day ${day}`,
    });
  }
});

describe("processBrewAnalysis", () => {
  it("sends the brew, the recipe and the 5 brews before it, then saves the analysis", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const result = await processBrewAnalysis({ brewLogId: logIds.day8! });

    expect(result.status).toBe("saved");
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ tastingNotes: "day 8", roastAgeDays: 7, brewRatio: 16.67, recipeName: "House V60" });
    expect(context.recipe).toMatchObject({ name: "House V60", method: "V60", steps: [{ actionName: "Bloom" }, { actionName: "Pour" }] });
    expect(context.bean).toEqual({ roasterName: "Onyx", beanName: "Guji", process: null, roastDate: "2026-10-01" });
    // Only earlier brews (day 9 is later), newest first, at most 5.
    expect(context.previousBrews.map((b) => b.tastingNotes)).toEqual(["day 7", "day 6", "day 5", "day 4", "day 3"]);
    expect(context.ratingScale).toBe("1-5");

    const saved = await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day8!));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(ANALYSIS);
  });

  it("skips a brew log that was deleted after the job was queued, without calling the LLM", async () => {
    const result = await processBrewAnalysis({ brewLogId: randomUUID() });
    expect(result).toEqual({ status: "skipped", reason: "brew log no longer exists" });
    expect(llm).not.toHaveBeenCalled();
  });

  it("skips (doesn't fail) when the log is deleted while the LLM is answering", async () => {
    llm.mockImplementation(async () => {
      await db.delete(brewLogs).where(eq(brewLogs.id, logIds.day9!));
      return ANALYSIS;
    });
    const result = await processBrewAnalysis({ brewLogId: logIds.day9! });
    expect(result).toEqual({ status: "skipped", reason: "brew log deleted during analysis" });
    expect(await db.select().from(llmAnalyses)).toEqual([]);
  });

  it("lets LLM errors propagate so BullMQ retries, and saves nothing", async () => {
    llm.mockRejectedValue(new Error("LLM refused: no"));
    await expect(processBrewAnalysis({ brewLogId: logIds.day8! })).rejects.toThrow("LLM refused");
    expect(await db.select().from(llmAnalyses)).toEqual([]);
  });

  it("still works for a brew whose author deleted their account (user_id null)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.delete(users).where(eq(users.id, userId)); // brew_logs.user_id -> NULL
    expect((await processBrewAnalysis({ brewLogId: logIds.day5! })).status).toBe("saved");
  });
});

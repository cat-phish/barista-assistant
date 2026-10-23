import { randomUUID } from "node:crypto";
import { beanFreezes, beans, brewLogMarks, brewLogs, brewers, ingredients, drinkIngredients, drinks, grinders, llmAnalyses, recipeGrindSettings, recipes, recipeSteps, users, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractionYield, type BrewContext } from "../src/context.js";
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
  const brewerId = randomUUID();
  const recipeId = randomUUID();
  await db.insert(users).values({ id: userId, email: "b@example.com", passwordHash: "x" });
  await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: "w" });
  await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
  await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji", roastLevel: "light", detailedRoastLevel: "city", roastType: "filter", blendType: "single_origin", flavorProfile: "Peach, black tea", originArea: "africa", country: "Ethiopia", region: "Guji", altitudeMasl: 2100, roastDate: new Date("2026-10-01T00:00:00Z") });
  await db.insert(recipes).values({ id: recipeId, workspaceId, name: "House V60", brewerId, targetDoseGrams: 15, targetWaterGrams: 250, expectedYieldGrams: 220, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, targetTempC: 94, style: "pour_over" });
  await db.insert(recipeSteps).values([
    { id: randomUUID(), recipeId, stepOrder: 1, stepType: "bloom", durationSec: 45, advance: "tap", targetWaterGrams: 50, targetTempC: 85 },
    { id: randomUUID(), recipeId, stepOrder: 2, stepType: "swirl", label: "Gentle swirl", durationSec: 0 },
    { id: randomUUID(), recipeId, stepOrder: 3, stepType: "pour", durationSec: 90, targetWaterGrams: 250 },
  ]);
  for (let day = 2; day <= 9; day++) {
    const id = randomUUID();
    logIds[`day${day}`] = id;
    await db.insert(brewLogs).values({
      id, workspaceId, userId, beanId, recipeId: day === 8 ? recipeId : null,
      timestamp: new Date(`2026-10-0${day}T08:00:00Z`),
      actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: day === 8 ? 221.5 : null, tdsPercent: day === 8 ? 1.38 : day === 7 ? 1.3 : null, actualTimeSec: 140 + day, rating: 3, tastingNotes: `day ${day}`,
    });
  }
});

describe("processBrewAnalysis", () => {
  it("sends the brew, the recipe and the 5 brews before it, then saves the analysis", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const result = await processBrewAnalysis({ brewLogId: logIds.day8! });

    expect(result.status).toBe("saved");
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ tastingNotes: "day 8", roastAgeDays: 7, daysFrozenBeforeBrew: 0, brewRatio: 16.67, recipeName: "House V60", recipeStyle: "pour_over", methodKind: "filter", actualWaterGrams: 250, actualYieldGrams: 221.5, tdsPercent: 1.38, extractionYieldPercent: 20.4 });
    // No yield measured and no recipe: the TDS goes through, extraction can't be worked out.
    expect(context.previousBrews[0]).toMatchObject({ recipeName: null, methodKind: null, tdsPercent: 1.3, extractionYieldPercent: null });
    expect(context.recipe).toMatchObject({
      name: "House V60", brewer: "V60", style: "pour_over", methodKind: "filter", firstDropMinSec: null, targetWaterGrams: 250, expectedYieldGrams: 220, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, grindStartingPoints: [],
      steps: [
        { stepType: "bloom", label: null, durationSec: 45, advance: "tap", targetWaterGrams: 50, targetTempC: 85, pressureBar: null },
        { stepType: "swirl", label: "Gentle swirl", durationSec: 0, advance: "auto", targetWaterGrams: null },
        { stepType: "pour", durationSec: 90, targetWaterGrams: 250 },
      ],
    });
    expect(context.bean).toEqual({
      roasterName: "Onyx",
      beanName: "Guji",
      process: null,
      roastLevel: "light",
      detailedRoastLevel: "city",
      roastType: "filter",
      blendType: "single_origin",
      decaf: false,
      roastDate: "2026-10-01",
      flavorProfile: "Peach, black tea",
      originArea: "africa",
      country: "Ethiopia",
      region: "Guji",
      altitudeMasl: 2100,
    });
    // Only earlier brews (day 9 is later), newest first, at most 5.
    expect(context.previousBrews.map((b) => b.tastingNotes)).toEqual(["day 7", "day 6", "day 5", "day 4", "day 3"]);
    expect(context.ratingScale).toBe("1-5");

    const saved = await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day8!));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(ANALYSIS);
  });

  it("espresso brews: no water, ratio from the shot weight, first-drop window from the recipe", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const brewerId = randomUUID();
    const recipeId = randomUUID();
    const id = randomUUID();
    await db.insert(brewers).values({ id: brewerId, workspaceId, name: "Linea Mini", kind: "espresso", preinfusion: "manual", flowControl: "manual" });
    await db.insert(recipes).values({ id: recipeId, workspaceId, name: "Classic", brewerId, targetDoseGrams: 18, expectedYieldGrams: 36, expectedFinishMinSec: 25, expectedFinishMaxSec: 32, firstDropMinSec: 6, firstDropMaxSec: 9 });
    await db.insert(brewLogs).values({ id, workspaceId, userId, beanId, recipeId, brewerId, timestamp: new Date("2026-10-09T09:00:00Z"), actualDoseGrams: 18, actualYieldGrams: 40, tdsPercent: 9.5, actualTimeSec: 27 });
    await db.insert(brewLogMarks).values([
      { id: randomUUID(), brewLogId: id, kind: "first_drop", atSec: 7.4 },
      { id: randomUUID(), brewLogId: id, kind: "step_end", stepOrder: 1, atSec: 6 },
    ]);

    await processBrewAnalysis({ brewLogId: id });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ methodKind: "espresso", actualWaterGrams: null, actualYieldGrams: 40, brewRatio: 2.22, tdsPercent: 9.5, extractionYieldPercent: 21.1 });
    expect(context.brew.machine).toEqual({ name: "Linea Mini", preinfusion: "manual", flowControl: "manual", pressureControl: "none" });
    expect(context.drink).toBeNull();
    expect(context.brew.marks).toEqual([{ kind: "step_end", stepOrder: 1, atSec: 6 }, { kind: "first_drop", stepOrder: null, atSec: 7.4 }]);
    expect(context.previousBrews[0]?.marks).toEqual([]);
    expect(context.recipe).toMatchObject({ methodKind: "espresso", targetWaterGrams: null, expectedYieldGrams: 36, firstDropMinSec: 6, firstDropMaxSec: 9, flowUnit: "g_s" });
  });

  it("includes the drink a brew was for, with its ingredients in order", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const drinkId = randomUUID();
    const milk = randomUUID();
    const syrup = randomUUID();
    await db.insert(drinks).values({ id: drinkId, workspaceId, name: "Vanilla Oat Latte", kind: "espresso" });
    await db.insert(ingredients).values([
      { id: milk, workspaceId, name: "Steamed oat milk", ingredientType: "milk" },
      { id: syrup, workspaceId, name: "Vanilla", ingredientType: "syrup" },
    ]);
    await db.insert(drinkIngredients).values([
      { id: randomUUID(), drinkId, ingredientId: syrup, position: 1, amountValue: 1, amountUnit: "pump" },
      { id: randomUUID(), drinkId, ingredientId: milk, position: 2, amountValue: 180, amountUnit: "g", note: "microfoam" },
    ]);
    await db.update(brewLogs).set({ drinkId }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.drink).toEqual({
      name: "Vanilla Oat Latte",
      servingSize: null,
      ingredients: [
        { name: "Vanilla", ingredientType: "syrup", amount: "1 pump", note: null },
        { name: "Steamed oat milk", ingredientType: "milk", amount: "180 g", note: "microfoam" },
      ],
    });
  });

  it("scales the drink's amounts to the size made", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const drinkId = randomUUID();
    const syrup = randomUUID();
    await db.insert(drinks).values({ id: drinkId, workspaceId, name: "Vanilla Latte", kind: "espresso", servingSize: 8, servingUnit: "fl_oz" });
    await db.insert(ingredients).values({ id: syrup, workspaceId, name: "Vanilla", ingredientType: "syrup" });
    await db.insert(drinkIngredients).values({ id: randomUUID(), drinkId, ingredientId: syrup, position: 1, amountValue: 2, amountUnit: "pump" });
    await db.update(brewLogs).set({ drinkId, servingSize: 12, servingUnit: "fl_oz" }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.drink).toEqual({
      name: "Vanilla Latte",
      servingSize: "12 fl oz",
      ingredients: [{ name: "Vanilla", ingredientType: "syrup", amount: "3 pump", note: null }],
    });
  });

  it("labels each brew with how it was served, and keeps the shot and drink tasting apart", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const drinkId = randomUUID();
    const milk = randomUUID();
    const syrup = randomUUID();
    await db.insert(drinks).values({ id: drinkId, workspaceId, name: "Vanilla Latte", kind: "espresso" });
    await db.insert(ingredients).values([
      { id: milk, workspaceId, name: "Steamed milk", ingredientType: "milk" },
      { id: syrup, workspaceId, name: "Vanilla", ingredientType: "syrup" },
    ]);
    await db.insert(drinkIngredients).values([
      { id: randomUUID(), drinkId, ingredientId: syrup, position: 1 },
      { id: randomUUID(), drinkId, ingredientId: milk, position: 2 },
    ]);
    await db.update(brewLogs).set({ drinkId, rating: null, tastingNotes: null, drinkRating: 5, drinkTastingNotes: "sweet, caramel" }).where(eq(brewLogs.id, logIds.day8!));
    await db.update(brewLogs).set({ drinkId, drinkRating: 4, drinkTastingNotes: "milky" }).where(eq(brewLogs.id, logIds.day6!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({
      drink: { name: "Vanilla Latte", ingredientTypes: ["milk", "syrup"] },
      rating: null,
      tastingNotes: null,
      drinkRating: 5,
      drinkTastingNotes: "sweet, caramel",
    });
    const served = context.previousBrews.map((b) => [b.tastingNotes, b.drink?.name ?? null, b.drinkTastingNotes]);
    expect(served.slice(0, 2)).toEqual([
      ["day 7", null, null], // straight
      ["day 6", "Vanilla Latte", "milky"], // in milk, with its own tasting
    ]);
  });

  it("uses the effective roast age at each brew's date, excluding days frozen", async () => {
    llm.mockResolvedValue(ANALYSIS);
    // Roasted Oct 1; frozen Oct 4 -> Oct 6 (2 days). Brews on days 2..9.
    await db.insert(beanFreezes).values({ id: randomUUID(), beanId, frozenOn: "2026-10-04", thawedOn: "2026-10-06" });
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ roastAgeDays: 5, daysFrozenBeforeBrew: 2 }); // Oct 8: 7 days - 2 frozen
    const byDay = Object.fromEntries(context.previousBrews.map((b) => [b.tastingNotes, [b.roastAgeDays, b.daysFrozenBeforeBrew]]));
    expect(byDay["day 3"]).toEqual([2, 0]); // before the freeze
    expect(byDay["day 5"]).toEqual([3, 1]); // mid-freeze: age paused at 3
    expect(byDay["day 7"]).toEqual([4, 2]); // after thawing: resumed
  });

  it("names a stovetop brew's method and style", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const moka = randomUUID();
    const mokaRecipe = randomUUID();
    await db.insert(brewers).values({ id: moka, workspaceId, name: "Bialetti", kind: "stovetop" });
    await db.insert(recipes).values({ id: mokaRecipe, workspaceId, name: "3-cup moka", brewerId: moka, targetDoseGrams: 15, targetWaterGrams: 150, style: "moka" });
    const id = randomUUID();
    await db.insert(brewLogs).values({
      id, workspaceId, userId, beanId, recipeId: mokaRecipe, brewerId: moka, timestamp: new Date("2026-10-08T09:00:00Z"),
      actualDoseGrams: 15, actualWaterGrams: 150, actualTimeSec: 240,
    });
    await processBrewAnalysis({ brewLogId: id });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ methodKind: "stovetop", recipeStyle: "moka" });
  });

  it("dates each brew by the logging device's UTC offset", async () => {
    llm.mockResolvedValue(ANALYSIS);
    // Oct 9, 03:00 UTC is still Oct 8 in the evening at UTC-7: one day younger.
    const id = randomUUID();
    await db.insert(brewLogs).values({
      id, workspaceId, userId, beanId, timestamp: new Date("2026-10-09T03:00:00Z"), utcOffsetMinutes: -420,
      actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150,
    });
    await processBrewAnalysis({ brewLogId: id });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew.roastAgeDays).toBe(7); // Oct 1 -> Oct 8 (UTC would say 8)
  });

  it("tells the LLM which grinder each brew used, with its details (retired grinders included)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const c40 = randomUUID();
    await db.insert(grinders).values({ id: c40, workspaceId, name: "Comandante C40", adjustment: "stepped", settingMin: 0, settingMax: 40, stepSize: 1, retiredAt: new Date() });
    await db.update(brewLogs).set({ grinderId: c40, actualGrindSetting: "20" }).where(eq(brewLogs.id, logIds.day8!));
    await db.update(brewLogs).set({ grinderId: c40, actualGrindSetting: "22" }).where(eq(brewLogs.id, logIds.day6!));
    const recipeId = (await db.select({ id: recipes.id }).from(recipes))[0]!.id;
    await db.insert(recipeGrindSettings).values({ id: randomUUID(), recipeId, grinderId: c40, setting: "21" });
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ actualGrindSetting: "20", machine: null });
    expect(context.brew.grinder).toEqual({ name: "Comandante C40", adjustment: "stepped", settingMin: 0, settingMax: 40, stepSize: 1, burrType: null, burrSizeMm: null, power: null });
    const byDay = Object.fromEntries(context.previousBrews.map((b) => [b.tastingNotes, b.grinder?.name ?? null]));
    expect(byDay).toMatchObject({ "day 6": "Comandante C40", "day 7": null });
    expect(context.recipe?.grindStartingPoints).toEqual([{ grinderName: "Comandante C40", setting: "21" }]);
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

describe("extractionYield (docs/api/brew-logs.md §6)", () => {
  const log = { tdsPercent: 1.38, actualDoseGrams: 15, actualWaterGrams: 250, actualYieldGrams: 220 } as Parameters<typeof extractionYield>[0];
  it("uses the yield for percolation and the water for immersion styles", () => {
    expect(extractionYield(log, "pour_over")).toBe(20.2);
    expect(extractionYield(log, null)).toBe(20.2);
    expect(extractionYield(log, "immersion")).toBe(23);
    expect(extractionYield(log, "cold_brew")).toBe(23);
  });
  it("is null without a TDS reading", () => {
    expect(extractionYield({ ...log, tdsPercent: null }, "pour_over")).toBeNull();
  });
});

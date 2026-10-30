import { randomUUID } from "node:crypto";
import { analysisRequests, beanFreezes, beans, brewLogMarks, brewLogs, brewers, ingredients, drinkIngredients, drinks, grinders, llmAnalyses, recipeGrindSettings, recipes, recipeSteps, users, waterProfiles, workspaces, prepTools, brewLogTools, brewProblems, brewLogProblems, brewLogFlavors, recipeStyles } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractionYield, loadBrewContext, type BrewContext } from "../src/context.js";
import { db } from "../src/db.js";
import { analysisSent, analyzeWithLlm, PROMPT_VERSION } from "../src/llm.js";
import { CAP_REACHED, failureMessage, processAiPreview, processBrewAnalysis, settleRequest } from "../src/processor.js";

// Real database, fake LLM.
vi.mock("../src/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/llm.js")>()),
  analyzeWithLlm: vi.fn(),
}));
const llm = vi.mocked(analyzeWithLlm);
const ANALYSIS = { reasoning: "Under-extracted: grind finer.", nextStep: "Grind a step finer.", confidence: "medium" as const, suggestedGrindDelta: "finer" as const, suggestedTempDelta: 1, suggestedRpmDelta: null, suggestedDoseDelta: null, suggestedYieldDelta: null };

let beanId: string;
let workspaceId: string;
let userId: string;
const logIds: Record<string, string> = {};
// Another brew as the AI would see it, analyzed on its own.
const brewOf = async (day: string) => (await loadBrewContext(logIds[day]!))!.brew;

// One bean roasted 2026-10-01, a V60 recipe with steps, and brews on days 2..9.
beforeEach(async () => {
  llm.mockReset();
  workspaceId = randomUUID();
  userId = randomUUID();
  beanId = randomUUID();
  const brewerId = randomUUID();
  const recipeId = randomUUID();
  const pourOver = randomUUID();
  await db.insert(users).values({ id: userId, email: "b@example.com", passwordHash: "x" });
  await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: "w" });
  await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
  await db.insert(recipeStyles).values({ id: pourOver, workspaceId, kind: "filter", name: "Pour over", position: 1, builtin: "pour_over", brewsLike: "pour_over" });
  await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji", roastLevel: "light", detailedRoastLevel: "city", roastType: "filter", blendType: "single_origin", flavorProfile: "Peach, black tea", originArea: "africa", country: "Ethiopia", region: "Guji", altitudeMasl: 2100, varieties: ["Heirloom"], species: ["arabica"], roastWeightLossPercent: 15.5, roastDate: new Date("2026-10-01T00:00:00Z") });
  await db.insert(recipes).values({ id: recipeId, workspaceId, name: "House V60", brewerId, targetDoseGrams: 15, targetWaterGrams: 250, expectedYieldGrams: 220, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, targetTempC: 94, styleId: pourOver });
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
  it("sends the brew and its recipe, no earlier brews, then saves the analysis", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const result = await processBrewAnalysis({ brewLogId: logIds.day8! });

    expect(result.status).toBe("saved");
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ tastingNotes: "day 8", roastAgeDays: 7, daysFrozenBeforeBrew: 0, brewRatio: 16.67, recipeName: "House V60", recipeStyle: { name: "Pour over", brewsLike: "pour_over" }, methodKind: "filter", actualWaterGrams: 250, actualYieldGrams: 221.5, tdsPercent: 1.38, extractionYieldPercent: 20.4 });
    // No yield measured and no recipe: the TDS goes through, extraction can't be worked out.
    expect(await brewOf("day7")).toMatchObject({ recipeName: null, methodKind: null, tdsPercent: 1.3, extractionYieldPercent: null });
    expect(context.recipe).toMatchObject({
      name: "House V60", brewer: "V60", style: { name: "Pour over", brewsLike: "pour_over" }, methodKind: "filter", firstDropMinSec: null, targetWaterGrams: 250, expectedYieldGrams: 220, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, grindStartingPoints: [],
      steps: [
        { stepType: "bloom", label: null, durationSec: 45, advance: "tap", targetWaterGrams: 50, targetTempC: 85, pressureBar: null },
        { stepType: "swirl", label: "Gentle swirl", durationSec: 0, advance: "auto", targetWaterGrams: null },
        { stepType: "pour", durationSec: 90, targetWaterGrams: 250 },
      ],
    });
    expect(context.bean).toEqual({
      roasterName: "Onyx",
      beanName: "Guji",
      batchNumber: null,
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
      varieties: ["Heirloom"],
      species: ["arabica"],
      roastWeightLossPercent: 15.5,
    });
    // Only this brew: history goes to "Suggest parameters" (docs/api/llm-contract.md §9).
    expect(Object.keys(context).sort()).toEqual(["bean", "brew", "drink", "ratingScale", "recipe"]);
    expect(context.ratingScale).toBe("0.5-5");

    const saved = await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day8!));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(ANALYSIS);
    // What was sent, saved with it (docs/api/analysis.md §8c).
    expect(saved[0]!.request).toEqual(analysisSent(context, new Set()));
    expect(saved[0]!.request).toMatchObject({ sections: expect.arrayContaining(["core", "output", "end"]), system: expect.stringContaining("Analyze this one brew"), input: { brew: { tastingNotes: "day 8" } } });
  });

  it("uses the brew's barista's own prompt and the note, and marks the version custom (docs/api/auth.md §1c)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const prompt = { instructions: "I like it light.", overrides: { core: "Be brief." } };
    await db.update(users).set({ aiPrompt: prompt }).where(eq(users.id, userId));
    await processBrewAnalysis({ brewLogId: logIds.day8!, note: "Tasted it cold." });
    expect(llm.mock.calls[0]![2]).toEqual({ prompt, note: "Tasted it cold." });
    const [saved] = await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day8!));
    expect(saved!.promptVersion).toBe(`${PROMPT_VERSION}+custom`);
    expect(saved!.request?.sections).toEqual(expect.arrayContaining(["instructions", "note"]));
    expect(saved!.request?.system.startsWith("Be brief.")).toBe(true);
    // The preview uses the same.
    expect((await processAiPreview({ kind: "analysis", brewLogId: logIds.day8!, note: "Tasted it cold." }))?.system).toBe(saved!.request?.system);
  });

  it("without a prompt of their own or a note: the defaults, and the plain version", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    expect(llm.mock.calls[0]![2]).toEqual({ prompt: { instructions: null, labelInstructions: null, overrides: {} }, note: null });
    const [saved] = await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day8!));
    expect(saved!.promptVersion).toBe(PROMPT_VERSION);
  });

  it("a preview is what the analysis would send, without calling the AI (docs/api/analysis.md §8d)", async () => {
    await db.update(workspaces).set({ settings: { aiHidden: ["water"] } }).where(eq(workspaces.id, workspaceId));
    const preview = await processAiPreview({ kind: "analysis", brewLogId: logIds.day8! });
    expect(preview).toEqual(analysisSent((await loadBrewContext(logIds.day8!))!, new Set(["water"])));
    expect(llm).not.toHaveBeenCalled();
    expect(await processAiPreview({ kind: "analysis", brewLogId: randomUUID() })).toBeNull();
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
    expect((await brewOf("day8")).marks).toEqual([]);
    expect(context.recipe).toMatchObject({ methodKind: "espresso", targetWaterGrams: null, expectedYieldGrams: 36, firstDropMinSec: 6, firstDropMaxSec: 9, flowUnit: "g_s" });
  });

  it("sends the step times a bigger batch was timed against (docs/api/recipes.md §5)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(recipes).set({ stepTimeScaling: 0.5 }).where(eq(recipes.workspaceId, workspaceId));
    await db.update(brewLogs).set({ actualDoseGrams: 30, actualWaterGrams: 500 }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    // A double batch: the pour takes 90 × √2 ≈ 127 s, the bloom and swirl stay; the window moves by the 37 s gained.
    expect(context.recipe).toMatchObject({
      stepTimeScaling: 0.5, targetWaterGrams: 250, expectedFinishMinSec: 202, expectedFinishMaxSec: 232,
      steps: [{ stepType: "bloom", durationSec: 45 }, { stepType: "swirl", durationSec: 0 }, { stepType: "pour", durationSec: 127 }],
    });
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
    expect(await brewOf("day7")).toMatchObject({ drink: null, drinkTastingNotes: null }); // straight
    expect(await brewOf("day6")).toMatchObject({ drink: { name: "Vanilla Latte" }, tastingNotes: "day 6", drinkTastingNotes: "milky" }); // in milk, with its own tasting
  });

  it("uses the effective roast age at each brew's date, excluding days frozen", async () => {
    llm.mockResolvedValue(ANALYSIS);
    // Roasted Oct 1; frozen Oct 4 -> Oct 6 (2 days). Brews on days 2..9.
    await db.insert(beanFreezes).values({ id: randomUUID(), beanId, frozenOn: "2026-10-04", thawedOn: "2026-10-06" });
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ roastAgeDays: 5, daysFrozenBeforeBrew: 2 }); // Oct 8: 7 days - 2 frozen
    expect(await brewOf("day3")).toMatchObject({ roastAgeDays: 2, daysFrozenBeforeBrew: 0 }); // before the freeze
    expect(await brewOf("day5")).toMatchObject({ roastAgeDays: 3, daysFrozenBeforeBrew: 1 }); // mid-freeze: age paused at 3
    expect(await brewOf("day7")).toMatchObject({ roastAgeDays: 4, daysFrozenBeforeBrew: 2 }); // after thawing: resumed
  });

  it("names a stovetop brew's method and style", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const moka = randomUUID();
    const mokaRecipe = randomUUID();
    const mokaStyle = randomUUID();
    await db.insert(brewers).values({ id: moka, workspaceId, name: "Bialetti", kind: "stovetop" });
    await db.insert(recipeStyles).values({ id: mokaStyle, workspaceId, kind: "stovetop", name: "Moka", position: 1, builtin: "moka", brewsLike: "moka" });
    await db.insert(recipes).values({ id: mokaRecipe, workspaceId, name: "3-cup moka", brewerId: moka, targetDoseGrams: 15, targetWaterGrams: 150, styleId: mokaStyle });
    const id = randomUUID();
    await db.insert(brewLogs).values({
      id, workspaceId, userId, beanId, recipeId: mokaRecipe, brewerId: moka, timestamp: new Date("2026-10-08T09:00:00Z"),
      actualDoseGrams: 15, actualWaterGrams: 150, actualTimeSec: 240,
    });
    await processBrewAnalysis({ brewLogId: id });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ methodKind: "stovetop", recipeStyle: { name: "Moka", brewsLike: "moka" } });
  });

  it("counts a flash chilled brew's ice in its ratio (docs/api/llm-contract.md §9)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(recipes).set({ targetWaterGrams: 150, targetIceGrams: 100 }).where(eq(recipes.workspaceId, workspaceId));
    await db.update(brewLogs).set({ actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 228, tdsPercent: null }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 228, brewRatio: 16.67, extractionYieldPercent: null });
    expect(context.recipe).toMatchObject({ targetWaterGrams: 150, targetIceGrams: 100 });
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

  it("tells the LLM which grinder each brew used, with its details (archived grinders included)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const c40 = randomUUID();
    await db.insert(grinders).values({ id: c40, workspaceId, name: "Comandante C40", adjustment: "stepped", settingMin: 0, settingMax: 40, stepSize: 1, archivedAt: new Date() });
    await db.update(brewLogs).set({ grinderId: c40, actualGrindSetting: 20 }).where(eq(brewLogs.id, logIds.day8!));
    await db.update(brewLogs).set({ grinderId: c40, actualGrindSetting: 22 }).where(eq(brewLogs.id, logIds.day6!));
    const recipeId = (await db.select({ id: recipes.id }).from(recipes))[0]!.id;
    await db.insert(recipeGrindSettings).values({ id: randomUUID(), recipeId, grinderId: c40, setting: 21 });
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ actualGrindSetting: 20, machine: null });
    expect(context.brew.grinder).toEqual({
      name: "Comandante C40", adjustment: "stepped", settingMin: 0, settingMax: 40, stepSize: 1, burrType: null, burrSizeMm: null, power: null,
      variableSpeed: false, rpmMin: null, rpmMax: null,
    });
    expect(context.brew.grindRpm).toBeNull();
    expect((await brewOf("day6")).grinder?.name).toBe("Comandante C40");
    expect((await brewOf("day7")).grinder).toBeNull();
    expect(context.recipe?.grindStartingPoints).toEqual([{ grinderName: "Comandante C40", setting: 21 }]);
  });

  it("tells the LLM a variable-speed grinder's range and each brew's RPM", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const ek = randomUUID();
    await db.insert(grinders).values({ id: ek, workspaceId, name: "EK43", variableSpeed: true, rpmMin: 300, rpmMax: 1500 });
    await db.update(brewLogs).set({ grinderId: ek, grindRpm: 900 }).where(eq(brewLogs.id, logIds.day8!));
    await db.update(brewLogs).set({ grinderId: ek, grindRpm: 1200 }).where(eq(brewLogs.id, logIds.day6!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew.grinder).toMatchObject({ name: "EK43", variableSpeed: true, rpmMin: 300, rpmMax: 1500 });
    expect(context.brew.grindRpm).toBe(900);
    expect((await brewOf("day6")).grindRpm).toBe(1200);
  });

  it("tells the LLM the weights in and out of the grinder, and the retention", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(brewLogs).set({ beanWeightInGrams: 18.2, groundWeightOutGrams: 17.9 }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ beanWeightInGrams: 18.2, groundWeightOutGrams: 17.9, grinderRetentionGrams: 0.3 });
    expect((await brewOf("day7")).grinderRetentionGrams).toBeNull(); // not weighed
  });

  it("cold brews: sends the steep and dilution, and doesn't analyze a brew still steeping", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(brewLogs).set({ steeping: true }).where(eq(brewLogs.id, logIds.day7!));
    await db.update(brewLogs).set({ steepTemp: "fridge", dilutionRatio: 1, dilutedWith: "milk", steepMinHours: 14, steepMaxHours: 20 }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew).toMatchObject({ steeping: false, steepTemp: "fridge", dilutionRatio: 1, dilutedWith: "milk", steepMinHours: 14, steepMaxHours: 20, expectedFinishMinSec: null });
    expect(context.recipe).toMatchObject({ steepMinHours: null, dilutionRatio: null });

    llm.mockClear();
    expect(await processBrewAnalysis({ brewLogId: logIds.day7! })).toEqual({ status: "skipped", reason: "still steeping" });
    expect(llm).not.toHaveBeenCalled();
  });

  it("tells the LLM the water each brew used, with its figures", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const tww = randomUUID();
    await db.insert(waterProfiles).values({ id: tww, workspaceId, name: "Third Wave Water", generalHardnessPpm: 102, alkalinityPpm: 0, calciumPpm: 30, archivedAt: new Date() });
    await db.update(brewLogs).set({ waterProfileId: tww }).where(eq(brewLogs.id, logIds.day8!));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew.water).toEqual({
      name: "Third Wave Water", tdsPpm: null, generalHardnessPpm: 102, alkalinityPpm: 0, calciumPpm: 30, magnesiumPpm: null,
      sodiumPpm: null, potassiumPpm: null, bicarbonatePpm: null, chloridePpm: null, sulfatePpm: null, ph: null,
    });
    expect((await brewOf("day7")).water).toBeNull();
  });

  it("tells the LLM the prep tools each brew used, in checklist order", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const [rdt, wdt] = [randomUUID(), randomUUID()];
    await db.insert(prepTools).values([
      { id: rdt, workspaceId, name: "RDT", methodKinds: [], position: 2 },
      { id: wdt, workspaceId, name: "WDT", methodKinds: ["espresso"], position: 1, archivedAt: new Date() },
    ]);
    await db.insert(brewLogTools).values([
      { brewLogId: logIds.day8!, toolId: rdt },
      { brewLogId: logIds.day8!, toolId: wdt },
    ]);
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew.prepTools).toEqual(["WDT", "RDT"]);
    expect((await brewOf("day7")).prepTools).toEqual([]);
  });

  it("tells the LLM what went wrong in each brew, in list order", async () => {
    llm.mockResolvedValue(ANALYSIS);
    const [slow, tared] = [randomUUID(), randomUUID()];
    await db.insert(brewProblems).values([
      { id: tared, workspaceId, name: "Scale not tared", methodKind: null, position: 2 },
      { id: slow, workspaceId, name: "Slow drawdown", methodKind: "filter", position: 1, archivedAt: new Date() },
    ]);
    await db.insert(brewLogProblems).values([
      { brewLogId: logIds.day8!, problemId: tared },
      { brewLogId: logIds.day8!, problemId: slow },
      { brewLogId: logIds.day7!, problemId: tared },
    ]);
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew.problems).toEqual(["Slow drawdown", "Scale not tared"]);
    expect((await brewOf("day7")).problems).toEqual(["Scale not tared"]);
    expect((await brewOf("day6")).problems).toEqual([]);
  });

  it("tells the LLM the flavors picked on the wheel, in wheel order, with their place", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.insert(brewLogFlavors).values([
      { brewLogId: logIds.day8!, flavorKey: "off.stale.papery" },
      { brewLogId: logIds.day8!, flavorKey: "fruity.citrus.lemon" },
      { brewLogId: logIds.day8!, flavorKey: "sweet" },
    ]);
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    const context = llm.mock.calls[0]![0] as BrewContext;
    expect(context.brew.flavors).toEqual(["Lemon (Fruity › Citrus)", "Sweet", "Papery (Off flavors › Stale)"]);
    expect((await brewOf("day7")).flavors).toEqual([]);
  });

  it("passes on what the workspace keeps from the AI (Settings → AI)", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    expect(llm.mock.calls[0]![1]).toEqual(new Set());

    llm.mockClear();
    await db.update(workspaces).set({ settings: { aiHidden: ["water", "origin"] } }).where(eq(workspaces.id, workspaceId));
    await processBrewAnalysis({ brewLogId: logIds.day8! });
    expect(llm.mock.calls[0]![1]).toEqual(new Set(["water", "origin"]));
  });

  it("skips an unrated brew when the workspace only analyzes rated ones", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(workspaces).set({ settings: { aiHidden: ["analyzeUnrated"] } }).where(eq(workspaces.id, workspaceId));
    await db.update(brewLogs).set({ rating: null }).where(eq(brewLogs.id, logIds.day8!));
    expect(await processBrewAnalysis({ brewLogId: logIds.day8! })).toEqual({ status: "skipped", reason: "unrated brews aren't analyzed" });
    expect(llm).not.toHaveBeenCalled();

    await db.update(brewLogs).set({ drinkRating: 4 }).where(eq(brewLogs.id, logIds.day8!)); // a drink rating counts
    expect((await processBrewAnalysis({ brewLogId: logIds.day8! })).status).toBe("saved");
  });

  it("auto-analyze: marks the analysis auto and clears the due time; skips once switched off", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(workspaces).set({ settings: { autoAnalyze: true } }).where(eq(workspaces.id, workspaceId));
    await db.insert(analysisRequests).values({ brewLogId: logIds.day8!, dueAt: new Date() });
    expect((await processBrewAnalysis({ brewLogId: logIds.day8!, auto: true })).status).toBe("saved");
    expect((await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day8!)))[0]).toMatchObject({ auto: true });
    expect(await db.select().from(analysisRequests)).toEqual([]);

    // Asked for: not auto.
    await processBrewAnalysis({ brewLogId: logIds.day7! });
    expect((await db.select().from(llmAnalyses).where(eq(llmAnalyses.brewLogId, logIds.day7!)))[0]).toMatchObject({ auto: false });

    llm.mockClear();
    await db.update(workspaces).set({ settings: { autoAnalyze: false } }).where(eq(workspaces.id, workspaceId));
    expect(await processBrewAnalysis({ brewLogId: logIds.day6!, auto: true })).toEqual({ status: "skipped", reason: "auto-analyze is off" });
    expect(llm).not.toHaveBeenCalled();
  });

  it("auto-analyze: stops at the daily cap, says why; asked-for analyses aren't capped", async () => {
    llm.mockResolvedValue(ANALYSIS);
    await db.update(workspaces).set({ settings: { autoAnalyze: true, autoAnalyzeDailyCap: 1 } }).where(eq(workspaces.id, workspaceId));
    expect((await processBrewAnalysis({ brewLogId: logIds.day8!, auto: true })).status).toBe("saved");
    expect(await processBrewAnalysis({ brewLogId: logIds.day7!, auto: true })).toEqual({ status: "skipped", reason: "daily cap reached" });
    expect(await db.select().from(analysisRequests)).toEqual([expect.objectContaining({ brewLogId: logIds.day7!, dueAt: null, error: CAP_REACHED })]);
    expect((await processBrewAnalysis({ brewLogId: logIds.day7! })).status).toBe("saved");
    expect(await db.select().from(analysisRequests)).toEqual([]);

    // An auto analysis older than a day no longer counts.
    await db.update(llmAnalyses).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(llmAnalyses.brewLogId, logIds.day8!));
    expect((await processBrewAnalysis({ brewLogId: logIds.day6!, auto: true })).status).toBe("saved");
  });

  it("records why the last attempt failed, for the journal (settleRequest)", async () => {
    await settleRequest(logIds.day8!, failureMessage(false));
    expect(await db.select().from(analysisRequests)).toEqual([expect.objectContaining({ error: "The AI service couldn't be reached" })]);
    await settleRequest(logIds.day8!, failureMessage(true));
    expect((await db.select().from(analysisRequests))[0]?.error).toBe("The AI service refused the request");
    await settleRequest(randomUUID(), "x"); // a deleted brew: nothing to keep, no error
    await settleRequest(logIds.day8!, null);
    expect(await db.select().from(analysisRequests)).toEqual([]);
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
  const log = { tdsPercent: 1.38, actualDoseGrams: 15, actualWaterGrams: 250, actualIceGrams: null, actualYieldGrams: 220 } as Parameters<typeof extractionYield>[0];
  const style = (brewsLike: "pour_over" | "immersion" | "cold_brew", name = "Style") => ({ name, brewsLike });
  it("uses the yield for percolation and the water for immersion styles", () => {
    expect(extractionYield(log, style("pour_over"))).toBe(20.2);
    expect(extractionYield(log, null)).toBe(20.2);
    expect(extractionYield(log, style("immersion"))).toBe(23);
    expect(extractionYield(log, style("cold_brew"))).toBe(23);
  });
  it("is null for a brew made onto ice, which takes no TDS", () => {
    expect(extractionYield({ ...log, actualWaterGrams: 150, actualIceGrams: 100 }, style("pour_over"))).toBeNull();
  });
  it("goes by what a custom style brews like, not its name", () => {
    expect(extractionYield(log, style("immersion", "Inverted"))).toBe(23);
  });
  it("is null without a TDS reading", () => {
    expect(extractionYield({ ...log, tdsPercent: null }, style("pour_over"))).toBeNull();
  });
});

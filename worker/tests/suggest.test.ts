import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogs, grinders, llmAnalyses, parameterSuggestions, recipes, users, workspaces, type SuggestSource } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { requestSuggestion, suggestionSent } from "../src/llm.js";
import { failSuggestion, processAiPreview, processParameterSuggestion } from "../src/processor.js";
import { loadSuggestContext, type SuggestRequest } from "../src/suggestContext.js";

// Real database, fake LLM.
vi.mock("../src/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/llm.js")>()),
  requestSuggestion: vi.fn(),
}));
const llm = vi.mocked(requestSuggestion);
const RESULT = { reasoning: "Last cup was sour: a touch finer.", nextStep: "Watch the drawdown.", confidence: "medium" as const, grindSetting: 19, grindRpm: null, tempC: 94, ratio: 16, alternatives: [] };

let workspaceId: string;
let userId: string;
const id = { guji: "", kenya: "", v60: "", chemex: "", house: "", strong: "", chemexRecipe: "", c40: "", ode: "" };
const log: Record<string, string> = {};

// Two beans; a V60 with two recipes and a Chemex; brews on days 1..6:
//   day1 guji house c40 · day2 guji strong c40 · day3 guji chemex ode
//   day4 kenya house c40 · day5 guji house ode · day6 kenya chemex c40
beforeEach(async () => {
  llm.mockReset();
  workspaceId = randomUUID();
  userId = randomUUID();
  for (const k of Object.keys(id) as Array<keyof typeof id>) id[k] = randomUUID();
  await db.insert(users).values({ id: userId, email: "s@example.com", passwordHash: "x" });
  await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: "w" });
  await db.insert(brewers).values([
    { id: id.v60, workspaceId, name: "V60" },
    { id: id.chemex, workspaceId, name: "Chemex" },
  ]);
  await db.insert(beans).values([
    { id: id.guji, workspaceId, roasterName: "Onyx", beanName: "Guji", roastLevel: "light", roastDate: new Date("2026-10-01T00:00:00Z") },
    { id: id.kenya, workspaceId, roasterName: "Sey", beanName: "Kenya", roastLevel: "light", country: "Kenya", roastDate: new Date("2026-10-02T00:00:00Z") },
  ]);
  await db.insert(recipes).values([
    { id: id.house, workspaceId, name: "House V60", brewerId: id.v60, targetDoseGrams: 15, targetWaterGrams: 250, targetTempC: 94 },
    { id: id.strong, workspaceId, name: "Strong V60", brewerId: id.v60, targetDoseGrams: 18, targetWaterGrams: 250 },
    { id: id.chemexRecipe, workspaceId, name: "Chemex 3-cup", brewerId: id.chemex, targetDoseGrams: 30, targetWaterGrams: 500 },
  ]);
  await db.insert(grinders).values([
    { id: id.c40, workspaceId, name: "C40", settingMin: 0, settingMax: 40 },
    { id: id.ode, workspaceId, name: "Ode" },
  ]);
  const brews: Array<[string, string, string, string, string]> = [
    ["day1", id.guji, id.house, id.v60, id.c40],
    ["day2", id.guji, id.strong, id.v60, id.c40],
    ["day3", id.guji, id.chemexRecipe, id.chemex, id.ode],
    ["day4", id.kenya, id.house, id.v60, id.c40],
    ["day5", id.guji, id.house, id.v60, id.ode],
    ["day6", id.kenya, id.chemexRecipe, id.chemex, id.c40],
  ];
  for (const [day, beanId, recipeId, brewerId, grinderId] of brews) {
    log[day] = randomUUID();
    await db.insert(brewLogs).values({
      id: log[day]!, workspaceId, userId, beanId, recipeId, brewerId, grinderId,
      timestamp: new Date(`2026-10-1${day.slice(3)}T08:00:00Z`),
      actualDoseGrams: 15, actualWaterGrams: 250, actualGrindSetting: 20, actualTimeSec: 180, rating: 3, tastingNotes: day,
    });
  }
});

const request = (source: SuggestSource, over: Partial<SuggestRequest> = {}): SuggestRequest => ({
  beanId: id.guji, recipeId: id.house, brewerId: id.v60, grinderId: id.c40, source, maxBrews: 5,
  batchDoseGrams: null, batchWaterGrams: null, batchIceGrams: null, batchYieldGrams: null, alternativesAsked: null, ...over,
});
const notes = async (r: SuggestRequest, options = {}) => (await loadSuggestContext(r, options))!.brews.map((b) => b.tastingNotes);

describe("which earlier brews Suggest parameters sends (docs/api/analysis.md §8b)", () => {
  it.each([
    ["bag", ["day5", "day3", "day2", "day1"]],
    ["bagRecipe", ["day5", "day1"]],
    ["bagBrewer", ["day5", "day2", "day1"]],
    ["bean", ["day5", "day3", "day2", "day1"]], // only one bag of Guji yet
    ["beanRecipe", ["day5", "day1"]],
    ["beanBrewer", ["day5", "day2", "day1"]],
    ["brewer", ["day5", "day4", "day2", "day1"]],
    ["recipe", ["day5", "day4", "day1"]],
  ] as const)("%s: %j, newest first", async (source, expected) => {
    expect(await notes(request(source))).toEqual(expected);
  });

  it("at most maxBrews, without brews still steeping, and only rated ones when asked", async () => {
    expect(await notes(request("bean", { maxBrews: 2 }))).toEqual(["day5", "day3"]);
    await db.update(brewLogs).set({ steeping: true }).where(eq(brewLogs.id, log.day5!));
    await db.update(brewLogs).set({ rating: null }).where(eq(brewLogs.id, log.day3!));
    expect(await notes(request("bean"))).toEqual(["day3", "day2", "day1"]);
    expect(await notes(request("bean"), { ratedOnly: true })).toEqual(["day2", "day1"]);
    expect(await notes(request("bean"), { before: new Date("2026-10-13T00:00:00Z") })).toEqual(["day2", "day1"]);
  });

  it("sends the batch asked with, else the recipe's", async () => {
    expect((await loadSuggestContext(request("bean", { batchDoseGrams: 22.5, batchWaterGrams: 375 })))!.batch).toEqual({ doseGrams: 22.5, waterGrams: 375, iceGrams: null, yieldGrams: null, ratio: 16.67 });
    expect((await loadSuggestContext(request("bean", { batchDoseGrams: 20, batchWaterGrams: 200, batchIceGrams: 100 })))!.batch.ratio).toBe(15); // the ice counts
    expect((await loadSuggestContext(request("bean")))!.batch).toEqual({ doseGrams: 15, waterGrams: 250, iceGrams: null, yieldGrams: null, ratio: 16.67 });
    expect((await loadSuggestContext(request("bean", { recipeId: null })))!.batch).toEqual({ doseGrams: null, waterGrams: null, iceGrams: null, yieldGrams: null, ratio: null });
  });

  it("bag: this exact bean; bean: every bag of its coffee, by roaster and name, in this workspace only", async () => {
    const bag2 = randomUUID();
    const ws2 = randomUUID();
    const elsewhere = randomUUID();
    await db.insert(workspaces).values({ id: ws2, name: "Other", slug: "other" });
    await db.insert(beans).values([
      { id: bag2, workspaceId, roasterName: " onyx", beanName: "GUJI ", roastLevel: "light", batchNumber: "2", roastDate: new Date("2026-10-08T00:00:00Z") },
      { id: elsewhere, workspaceId: ws2, roasterName: "Onyx", beanName: "Guji" },
    ]);
    const brew = (beanId: string, ws: string, day: string) => ({
      id: randomUUID(), workspaceId: ws, userId, beanId, recipeId: id.house, brewerId: id.v60, grinderId: id.c40,
      timestamp: new Date(`2026-10-1${day}T08:00:00Z`), actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 180, rating: 3, tastingNotes: `day${day}`,
    });
    await db.insert(brewLogs).values([brew(bag2, workspaceId, "7"), brew(elsewhere, ws2, "8")]);

    expect(await notes(request("bagRecipe"))).toEqual(["day5", "day1"]);
    expect(await notes(request("beanRecipe"))).toEqual(["day7", "day5", "day1"]);
    expect(await notes(request("bean"))).toEqual(["day7", "day5", "day3", "day2", "day1"]);
    expect(await notes(request("beanBrewer"))).toEqual(["day7", "day5", "day2", "day1"]);
    // From the newer bag, the older bag's brews are its coffee's too.
    expect(await notes(request("bagRecipe", { beanId: bag2 }))).toEqual(["day7"]);
    expect(await notes(request("beanRecipe", { beanId: bag2 }))).toEqual(["day7", "day5", "day1"]);

    const [day7, day5] = (await loadSuggestContext(request("beanRecipe")))!.brews;
    expect(day7).toMatchObject({ sameBag: false, sameBean: true, bean: { beanName: "GUJI ", batchNumber: "2" } });
    expect(day5).toMatchObject({ sameBag: true, sameBean: true, bean: null });
  });

  it("sends none when the source needs a recipe or brewer that's gone", async () => {
    expect(await notes(request("bagRecipe", { recipeId: null }))).toEqual([]);
    expect(await notes(request("beanRecipe", { recipeId: null }))).toEqual([]);
    expect(await notes(request("brewer", { brewerId: null }))).toEqual([]);
  });

  it("marks each brew like the one being set up or not, names another bean, and attaches its latest analysis", async () => {
    const analysis = { brewLogId: log.day1!, reasoning: "Sour.", suggestedGrindDelta: "finer", suggestedTempDelta: 1 };
    await db.insert(llmAnalyses).values([
      { id: randomUUID(), ...analysis, reasoning: "Older.", createdAt: new Date("2026-10-11T09:00:00Z") },
      { id: randomUUID(), ...analysis, nextStep: "Grind finer.", helpful: true, createdAt: new Date("2026-10-11T10:00:00Z") },
    ]);
    const context = (await loadSuggestContext(request("recipe")))!;
    expect(context).toMatchObject({
      source: "recipe",
      bean: { beanName: "Guji" },
      recipe: { name: "House V60", targetTempC: 94 },
      brewer: { name: "V60", kind: "filter" },
      grinder: { name: "C40", settingMin: 0, settingMax: 40 },
    });
    expect(context.roastAgeDays).toBeGreaterThan(20); // today, not at a brew
    const [day5, day4, day1] = context.brews;
    expect(day5).toMatchObject({ sameBag: true, sameBean: true, sameRecipe: true, sameGrinder: false, bean: null, analysis: null, grinder: { name: "Ode" } });
    expect(day4).toMatchObject({ sameBag: false, sameBean: false, sameGrinder: true, bean: { beanName: "Kenya", country: "Kenya" }, roastAgeDays: 12 }); // its own bean's age
    expect(day1?.analysis).toEqual({
      reasoning: "Sour.", nextStep: "Grind finer.", confidence: null, suggestedGrindDelta: "finer", suggestedTempDelta: 1,
      suggestedRpmDelta: null, suggestedDoseDelta: null, suggestedYieldDelta: null, helpful: true,
    });
  });
});

describe("what else it may suggest (docs/api/analysis.md §8b)", () => {
  it("nothing unless asked", async () => {
    expect((await loadSuggestContext(request("bean")))!.options).toEqual({});
    expect((await loadSuggestContext(request("bean", { alternativesAsked: [] })))!.options).toEqual({});
  });

  it("the workspace's other active recipes and brewers with a recipe, and other beans with weight left", async () => {
    const ws2 = randomUUID();
    await db.insert(workspaces).values({ id: ws2, name: "Other", slug: "other" });
    const lone = randomUUID();
    const archived = randomUUID();
    await db.insert(brewers).values([
      { id: lone, workspaceId, name: "Aeropress" }, // no recipe
      { id: archived, workspaceId, name: "Clever", archivedAt: new Date() },
    ]);
    await db.insert(recipes).values({ id: randomUUID(), workspaceId, name: "Clever steep", brewerId: archived, targetDoseGrams: 18, targetWaterGrams: 300 });
    const [ethiopia, empty, gone, elsewhere] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.update(beans).set({ inventoryWeightGrams: 200 }).where(eq(beans.id, id.guji));
    await db.insert(beans).values([
      { id: ethiopia, workspaceId, roasterName: "Sey", beanName: "Ethiopia", inventoryWeightGrams: 120, roastDate: new Date("2026-10-08T00:00:00Z") },
      { id: empty, workspaceId, roasterName: "Sey", beanName: "Empty", inventoryWeightGrams: 0 },
      { id: gone, workspaceId, roasterName: "Sey", beanName: "Gone", inventoryWeightGrams: 100, archivedAt: new Date() },
      { id: elsewhere, workspaceId: ws2, roasterName: "Sey", beanName: "Elsewhere", inventoryWeightGrams: 100 },
    ]);
    const { options } = (await loadSuggestContext(request("bean", { alternativesAsked: ["recipe", "brewer", "bean"] }), { before: new Date("2026-10-18T09:00:00Z") }))!;
    expect(options.recipes?.map((r) => [r.ref, r.name, r.brewer])).toEqual([
      ["r1", "Chemex 3-cup", "Chemex"],
      ["r2", "Strong V60", "V60"],
    ]); // not this one, nor the archived brewer's
    expect(options.recipes?.[0]).toMatchObject({ id: id.chemexRecipe, targetDoseGrams: 30, targetWaterGrams: 500, methodKind: "filter" });
    expect(options.brewers).toEqual([{ ref: "b1", id: id.chemex, name: "Chemex", kind: "filter" }]); // not this one, the archived one, or one with no recipe
    expect(options.beans?.map((b) => [b.id, b.bean.beanName, b.gramsLeft, b.roastAgeDays])).toEqual([[ethiopia, "Ethiopia", 120, 10]]);
    // Only the kinds asked.
    expect(Object.keys((await loadSuggestContext(request("bean", { alternativesAsked: ["bean"] })))!.options)).toEqual(["beans"]);
  });
});

describe("processAiPreview for a suggestion (docs/api/analysis.md §8d)", () => {
  it("is what asking would send, without calling the AI", async () => {
    await db.update(workspaces).set({ settings: { aiHidden: ["unratedHistory"] } }).where(eq(workspaces.id, workspaceId));
    await db.update(brewLogs).set({ rating: null }).where(eq(brewLogs.id, log.day5!));
    const preview = await processAiPreview({ kind: "suggest", suggestion: request("beanRecipe") });
    const context = (await loadSuggestContext(request("beanRecipe"), { ratedOnly: true }))!;
    expect(preview).toEqual(suggestionSent(context, new Set(["unratedHistory"])));
    expect((preview!.input.brews as Array<{ tastingNotes: string }>).map((b) => b.tastingNotes)).toEqual(["day1"]); // the unrated one left out
    expect(llm).not.toHaveBeenCalled();
    expect(await processAiPreview({ kind: "suggest", suggestion: request("bean", { beanId: randomUUID() }) })).toBeNull();
  });
});

describe("processParameterSuggestion", () => {
  const pending = async (over: Partial<typeof parameterSuggestions.$inferInsert> = {}) => {
    const suggestionId = randomUUID();
    await db.insert(parameterSuggestions).values({ id: suggestionId, beanId: id.guji, recipeId: id.house, brewerId: id.v60, grinderId: id.c40, source: "beanRecipe", maxBrews: 5, ...over });
    return suggestionId;
  };
  const row = async (suggestionId: string) => (await db.select().from(parameterSuggestions).where(eq(parameterSuggestions.id, suggestionId)))[0];

  it("sends the chosen brews and saves the values", async () => {
    llm.mockResolvedValue({ suggestion: RESULT, usage: null });
    const suggestionId = await pending();
    expect(await processParameterSuggestion({ suggestionId })).toEqual({ status: "saved", id: suggestionId });
    expect(llm.mock.calls[0]![0].brews.map((b) => b.tastingNotes)).toEqual(["day5", "day1"]);
    expect(await row(suggestionId)).toMatchObject({ ...RESULT, status: "done", brewCount: 2, model: "test-model", error: null, completedAt: expect.any(Date) });
    // What was sent, saved with it (docs/api/analysis.md §8c).
    expect((await row(suggestionId))!.request).toEqual(suggestionSent(llm.mock.calls[0]![0], new Set()));
    expect((await row(suggestionId))!.request?.sections).toContain("suggestCore");
  });

  it("uses the asker's own prompt and the note (docs/api/auth.md §1c)", async () => {
    llm.mockResolvedValue({ suggestion: RESULT, usage: null });
    const prompt = { instructions: "Our guests like it strong.", overrides: {} };
    await db.update(users).set({ aiPrompt: prompt }).where(eq(users.id, userId));
    const suggestionId = await pending({ requestedBy: userId, note: "For iced coffee" });
    await processParameterSuggestion({ suggestionId });
    expect(llm.mock.calls[0]![2]).toEqual({ prompt, note: "For iced coffee" });
    expect((await row(suggestionId))!.promptVersion).toMatch(/\+custom$/);
    expect((await row(suggestionId))!.request?.system).toContain("Our guests like it strong.");
  });

  it("leaves out unrated brews and passes on what the workspace keeps from the AI", async () => {
    llm.mockResolvedValue({ suggestion: RESULT, usage: null });
    await db.update(workspaces).set({ settings: { aiHidden: ["unratedHistory", "water"] } }).where(eq(workspaces.id, workspaceId));
    await db.update(brewLogs).set({ rating: null }).where(eq(brewLogs.id, log.day5!));
    await processParameterSuggestion({ suggestionId: await pending() });
    expect(llm.mock.calls[0]![0].brews.map((b) => b.tastingNotes)).toEqual(["day1"]);
    expect(llm.mock.calls[0]![1]).toEqual(new Set(["unratedHistory", "water"]));
  });

  it("skips one that's gone or already settled, and records why one failed", async () => {
    expect(await processParameterSuggestion({ suggestionId: randomUUID() })).toEqual({ status: "skipped", reason: "suggestion no longer exists" });
    const done = await pending({ status: "done" });
    expect(await processParameterSuggestion({ suggestionId: done })).toEqual({ status: "skipped", reason: "already done" });
    expect(llm).not.toHaveBeenCalled();

    const failing = await pending();
    await failSuggestion(failing, "The AI service couldn't be reached");
    expect(await row(failing)).toMatchObject({ status: "failed", error: "The AI service couldn't be reached" });
  });
});

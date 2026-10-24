import { describe, expect, it } from "vitest";
import type { AiDetail } from "@barista/shared/aiDetails";
import type { BrewContext, BrewSummary } from "../src/context.js";
import { buildCompletionRequest, parseAnalysisMessage } from "../src/llm.js";
import { buildSystemPrompt, compact, promptSections, toLlmInput } from "../src/prompt.js";

const reply = (body: unknown) => ({ content: JSON.stringify(body), refusal: null });
const valid = { reasoning: "Under-extracted.", nextStep: "Grind 2 clicks finer.", confidence: "medium", suggestedGrindDelta: "finer", suggestedTempDelta: 1, suggestedRpmDelta: null };

describe("parseAnalysisMessage", () => {
  it("accepts a valid reply", () => {
    expect(parseAnalysisMessage(reply(valid))).toEqual(valid);
  });

  it("rounds the temperature change to the column's 1 decimal", () => {
    expect(parseAnalysisMessage(reply({ ...valid, suggestedTempDelta: 1.25 })).suggestedTempDelta).toBe(1.3);
    expect(parseAnalysisMessage(reply({ ...valid, suggestedTempDelta: -0.04 })).suggestedTempDelta).toBe(-0);
  });

  it.each([
    ["temperature change over 10 °C", reply({ ...valid, suggestedTempDelta: 25 }), /within ±10/],
    ["unknown grind direction", reply({ ...valid, suggestedGrindDelta: "a_bit_finer" }), /suggestedGrindDelta/],
    ["empty reasoning", reply({ ...valid, reasoning: "  " }), /reasoning/],
    ["empty next step", reply({ ...valid, nextStep: "" }), /nextStep/],
    ["unknown confidence", reply({ ...valid, confidence: "certain" }), /confidence/],
    ["a fractional RPM change", reply({ ...valid, suggestedRpmDelta: 12.5 }), /suggestedRpmDelta/],
    ["a huge RPM change", reply({ ...valid, suggestedRpmDelta: 5000 }), /suggestedRpmDelta/],
    ["missing field", reply({ reasoning: "x", suggestedGrindDelta: "finer" }), /suggestedTempDelta/],
    ["refusal", { content: null, refusal: "I can't help" }, /refused/],
    ["empty reply", { content: "", refusal: null }, /empty/],
    ["no message at all", undefined, /empty/],
    ["invalid JSON", { content: "{not json", refusal: null }, /invalid JSON/],
  ])("rejects %s (so BullMQ retries)", (_label, message, error) => {
    expect(() => parseAnalysisMessage(message)).toThrow(error);
  });
});

// A filter brew and an earlier one of another recipe, on the same grinder and water.
const grinder = { name: "C40", adjustment: "stepped", settingMin: 0, settingMax: 40, stepSize: 1, burrType: "conical", burrSizeMm: 39, power: "manual", variableSpeed: false, rpmMin: null, rpmMax: null } as BrewSummary["grinder"];
const water = { name: "TWW", tdsPpm: 120, generalHardnessPpm: 80, alkalinityPpm: 40, calciumPpm: null, magnesiumPpm: null, sodiumPpm: null, potassiumPpm: null, bicarbonatePpm: null, chloridePpm: null, sulfatePpm: null, ph: null } as BrewSummary["water"];
const summary = (over: Partial<BrewSummary> = {}): BrewSummary => ({
  timestamp: "2026-10-20T08:00:00.000Z",
  roastAgeDays: 10,
  daysFrozenBeforeBrew: 0,
  recipeName: "House V60",
  recipeStyle: { name: "Pour over", brewsLike: "pour_over" },
  methodKind: "filter",
  grinder,
  water,
  machine: null,
  marks: [],
  prepTools: [],
  problems: [],
  actualDoseGrams: 15,
  actualWaterGrams: 250,
  actualYieldGrams: null,
  brewRatio: 16.67,
  tdsPercent: null,
  extractionYieldPercent: null,
  actualTempC: 93,
  actualGrindSetting: 20,
  grindRpm: null,
  steeping: false,
  beanWeightInGrams: null,
  groundWeightOutGrams: null,
  grinderRetentionGrams: null,
  actualTimeSec: 165,
  drink: null,
  rating: 3,
  tastingNotes: "A bit sour",
  drinkRating: null,
  drinkTastingNotes: null,
  steepTemp: null,
  dilutionRatio: null,
  dilutedWith: null,
  steepMinHours: null,
  steepMaxHours: null,
  expectedFinishMinSec: null,
  expectedFinishMaxSec: null,
  ...over,
});
const context = (over: { brew?: Partial<BrewSummary>; previous?: Array<Partial<BrewSummary>>; bean?: Partial<BrewContext["bean"]> } = {}): BrewContext => ({
  bean: { roasterName: "Onyx", beanName: "Monarch", batchNumber: null, process: "Washed", roastLevel: "light", detailedRoastLevel: null, roastType: null, blendType: "single_origin", decaf: false, roastDate: "2026-10-10", flavorProfile: null, originArea: "africa", country: "Ethiopia", region: null, altitudeMasl: 2000, ...over.bean },
  recipe: {
    name: "House V60",
    brewer: "V60",
    style: { name: "Pour over", brewsLike: "pour_over" },
    methodKind: "filter",
    targetDoseGrams: 15,
    targetWaterGrams: 250,
    expectedYieldGrams: 220,
    expectedFinishMinSec: 150,
    expectedFinishMaxSec: 180,
    firstDropMinSec: null,
    firstDropMaxSec: null,
    targetTempC: 94,
    steepMinHours: null,
    steepMaxHours: null,
    steepTemp: null,
    dilutionRatio: null,
    dilutionWith: null,
    grindStartingPoints: [{ grinderName: "C40", setting: 20 }],
    flowUnit: "g_s",
    steps: [{ stepOrder: 1, stepType: "bloom", label: null, durationSec: 30, advance: "auto", targetWaterGrams: 45, targetTempC: 94, pressureBar: null, pressureEndBar: null, flowRate: null, flowEndRate: null }],
  },
  brew: summary(over.brew),
  drink: null,
  previousBrews: (over.previous ?? [{ timestamp: "2026-10-18T08:00:00.000Z", recipeName: "Other V60", rating: null, tastingNotes: null }]).map(summary),
  ratingScale: "1-5",
});
const without = (...keys: AiDetail[]) => new Set<AiDetail>(keys);

describe("what the AI is sent (docs/api/llm-contract.md §9)", () => {
  it("leaves out what wasn't recorded, and names each grinder and water once", () => {
    const input = toLlmInput(context());
    expect(input).toMatchObject({
      ratingScale: "1-5",
      brew: { grinder: "C40", water: "TWW", actualTempC: 93, tastingNotes: "A bit sour" },
      equipment: { grinders: { C40: { adjustment: "stepped", stepSize: 1, variableSpeed: false } }, waters: { TWW: { tdsPpm: 120, generalHardnessPpm: 80, alkalinityPpm: 40 } } },
    });
    const brew = input.brew as Record<string, unknown>;
    for (const gone of ["tdsPercent", "machine", "marks", "prepTools", "problems", "drink", "steeping", "steepTemp"]) expect(brew, gone).not.toHaveProperty(gone);
    expect(input.bean).not.toHaveProperty("decaf"); // false: only said when true
    expect(input.bean).not.toHaveProperty("region");
    expect(input.recipe).not.toHaveProperty("flowUnit"); // the default
    expect(input.equipment).toEqual({ grinders: { C40: expect.any(Object) }, waters: { TWW: expect.any(Object) } });
    expect((input.equipment as { waters: { TWW: object } }).waters.TWW).not.toHaveProperty("calciumPpm");
    // The earlier brew was another recipe, so it's a weaker comparison.
    expect(input.previousBrews).toEqual([expect.objectContaining({ sameRecipe: false, recipeName: "Other V60" })]);
    expect(input.previousBrews).toEqual([expect.not.objectContaining({ rating: expect.anything() })]);
    expect(JSON.stringify(input)).not.toContain("null");
  });

  it("compacts nested values, keeping zero and false", () => {
    expect(compact({ a: null, b: [], c: {}, d: "", e: 0, f: false, g: [null, { h: null }], i: { j: 1 } })).toEqual({ e: 0, f: false, i: { j: 1 } });
  });

  it("only adds the prompt sections the brew needs", () => {
    expect(promptSections(toLlmInput(context()))).toEqual(["core", "output", "style", "altitude", "origin", "water", "end"]);
    const espresso = toLlmInput(
      context({
        brew: { methodKind: "espresso", recipeStyle: { name: "Standard", brewsLike: "standard" }, tdsPercent: 9, problems: ["Channeling / spurting"], prepTools: ["WDT"], grindRpm: 900, grinderRetentionGrams: 0.3 },
        bean: { batchNumber: "7", roastType: "espresso", decaf: true, flavorProfile: "Chocolate", originArea: null, country: null, altitudeMasl: null },
      }),
    );
    expect(promptSections(espresso)).toEqual(["core", "output", "style", "batch", "roastType", "decafBlend", "flavorProfile", "tds", "water", "prepTools", "problems", "rpm", "retention", "espresso", "end"]);
    const cold = toLlmInput(context({ brew: { recipeStyle: { name: "Cold brew", brewsLike: "cold_brew" }, drink: { name: "Iced latte", ingredientTypes: ["milk"] } } }));
    expect(promptSections(cold)).toEqual(expect.arrayContaining(["drink", "cold"]));
  });

  it("pins the prompt for a plain filter brew", () => {
    expect(buildSystemPrompt(toLlmInput(context()))).toMatchSnapshot();
  });

  it("sends the compact input with its prompt, under the strict schema", () => {
    const ctx = context();
    const req = buildCompletionRequest(ctx);
    expect(req.model).toBe("test-model"); // from OPENAI_MODEL
    expect(req.messages[0]).toEqual({ role: "system", content: buildSystemPrompt(toLlmInput(ctx)) });
    expect(JSON.parse(String(req.messages[1]?.content))).toEqual(toLlmInput(ctx));
    expect(req.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "brew_analysis", strict: true } });
    const schema = (req.response_format as { json_schema: { schema: Record<string, unknown> } }).json_schema.schema;
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ["reasoning", "nextStep", "confidence", "suggestedGrindDelta", "suggestedTempDelta", "suggestedRpmDelta"],
      properties: {
        suggestedGrindDelta: { enum: ["much_finer", "finer", "no_change", "coarser", "much_coarser"] },
        confidence: { enum: ["low", "medium", "high"] },
        suggestedRpmDelta: { type: ["integer", "null"] },
      },
    });
  });
});

describe("what the workspace keeps from the AI (Settings → AI)", () => {
  it("drops the water, or only its figures, and the prompt stops talking about it", () => {
    const noWater = toLlmInput(context(), without("water"));
    expect(noWater.brew).not.toHaveProperty("water");
    expect(noWater.equipment).not.toHaveProperty("waters");
    expect(promptSections(noWater)).not.toContain("water");
    const nameOnly = toLlmInput(context(), without("waterMinerals"));
    expect(nameOnly.brew).toMatchObject({ water: "TWW" });
    expect(nameOnly.equipment).not.toHaveProperty("waters"); // no figures left
    expect(promptSections(nameOnly)).not.toContain("water");
  });

  it("drops brew, bean, recipe and equipment details", () => {
    const ctx = context({ brew: { tdsPercent: 1.4, extractionYieldPercent: 20, problems: ["Fast drawdown"], grinderRetentionGrams: 0.2, beanWeightInGrams: 15.2 } });
    const input = toLlmInput(ctx, without("tds", "temp", "problems", "grinderWeights", "origin", "altitude", "process", "recipeSteps", "grindStartingPoints", "grinderDetails"));
    const brew = input.brew as Record<string, unknown>;
    for (const gone of ["tdsPercent", "extractionYieldPercent", "actualTempC", "problems", "grinderRetentionGrams", "beanWeightInGrams"]) expect(brew, gone).not.toHaveProperty(gone);
    for (const gone of ["originArea", "country", "altitudeMasl", "process"]) expect(input.bean, gone).not.toHaveProperty(gone);
    for (const gone of ["steps", "grindStartingPoints", "targetTempC"]) expect(input.recipe, gone).not.toHaveProperty(gone);
    expect(brew.grinder).toBe("C40"); // the name stays
    expect(input.equipment).not.toHaveProperty("grinders");
    expect(promptSections(input)).not.toEqual(expect.arrayContaining(["tds", "problems", "retention", "origin", "altitude"]));
  });

  it("can leave out unrated earlier brews and the drink", () => {
    const ctx = context({ brew: { drink: { name: "Latte", ingredientTypes: ["milk"] }, drinkRating: 4, drinkTastingNotes: "Sweet" }, previous: [{ rating: null }, { rating: 4, timestamp: "2026-10-17T08:00:00.000Z" }] });
    expect((toLlmInput(ctx).previousBrews as unknown[]).length).toBe(2);
    const input = toLlmInput(ctx, without("unratedHistory", "drink"));
    expect(input.previousBrews).toEqual([expect.objectContaining({ rating: 4 })]);
    for (const gone of ["drink", "drinkRating", "drinkTastingNotes"]) expect(input.brew, gone).not.toHaveProperty(gone);
    expect(promptSections(input)).not.toContain("drink");
  });
});

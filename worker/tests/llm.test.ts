import { describe, expect, it } from "vitest";
import type { AiDetail } from "@barista/shared/aiDetails";
import type { BrewContext, BrewSummary } from "../src/context.js";
import { buildCompletionRequest, buildSuggestRequest, onlySuggestionsThatApply, onlyWhatApplies, parseAnalysisMessage, parseSuggestionMessage } from "../src/llm.js";
import { INSTRUCTIONS_INTRO, NOTE_INTRO, PROMPT_SECTION_TEXTS, PROMPT_TEXT } from "@barista/shared/aiPrompt";
import { buildSystemPrompt, compact, PROMPT_SECTIONS, promptSections, SUGGEST_SECTIONS, toLlmInput, toSuggestInput } from "../src/prompt.js";
import type { SuggestBrew, SuggestContext } from "../src/suggestContext.js";

const reply = (body: unknown) => ({ content: JSON.stringify(body), refusal: null });
const valid = { reasoning: "Under-extracted.", nextStep: "Grind 2 clicks finer.", confidence: "medium", suggestedGrindDelta: "finer", suggestedTempDelta: 1, suggestedRpmDelta: null, suggestedDoseDelta: null, suggestedYieldDelta: null };

describe("parseAnalysisMessage", () => {
  it("accepts a valid reply", () => {
    expect(parseAnalysisMessage(reply(valid))).toEqual(valid);
  });

  it("rounds dose and shot weight changes to 0.1 g", () => {
    expect(parseAnalysisMessage(reply({ ...valid, suggestedDoseDelta: 0.54, suggestedYieldDelta: 3.96 }))).toMatchObject({ suggestedDoseDelta: 0.5, suggestedYieldDelta: 4 });
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
    ["a dose change over 5 g", reply({ ...valid, suggestedDoseDelta: 6 }), /suggestedDoseDelta/],
    ["a shot weight change over 30 g", reply({ ...valid, suggestedYieldDelta: -31 }), /suggestedYieldDelta/],
    ["a missing dose change", reply({ ...valid, suggestedDoseDelta: undefined }), /suggestedDoseDelta/],
    ["missing field", reply({ reasoning: "x", suggestedGrindDelta: "finer" }), /suggestedTempDelta/],
    ["refusal", { content: null, refusal: "I can't help" }, /refused/],
    ["empty reply", { content: "", refusal: null }, /empty/],
    ["no message at all", undefined, /empty/],
    ["invalid JSON", { content: "{not json", refusal: null }, /invalid JSON/],
  ])("rejects %s (so BullMQ retries)", (_label, message, error) => {
    expect(() => parseAnalysisMessage(message)).toThrow(error);
  });
});

// A filter brew on a C40 with Third Wave Water.
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
  actualIceGrams: null,
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
const context = (over: { brew?: Partial<BrewSummary>; bean?: Partial<BrewContext["bean"]> } = {}): BrewContext => ({
  bean: { roasterName: "Onyx", beanName: "Monarch", batchNumber: null, process: "Washed", roastLevel: "light", detailedRoastLevel: null, roastType: null, blendType: "single_origin", decaf: false, roastDate: "2026-10-10", flavorProfile: null, originArea: "africa", country: "Ethiopia", region: null, altitudeMasl: 2000, varieties: null, species: null, roastWeightLossPercent: null, ...over.bean },
  recipe: {
    name: "House V60",
    brewer: "V60",
    style: { name: "Pour over", brewsLike: "pour_over" },
    methodKind: "filter",
    targetDoseGrams: 15,
    targetWaterGrams: 250,
    targetIceGrams: null,
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
    stepTimeScaling: null,
    steps: [{ stepOrder: 1, stepType: "bloom", label: null, durationSec: 30, advance: "auto", targetWaterGrams: 45, targetTempC: 94, pressureBar: null, pressureEndBar: null, flowRate: null, flowEndRate: null }],
  },
  brew: summary(over.brew),
  drink: null,
  ratingScale: "0.5-5",
});
const without = (...keys: AiDetail[]) => new Set<AiDetail>(keys);

describe("onlyWhatApplies: changes that don't fit the brew are dropped", () => {
  const said = parseAnalysisMessage(reply({ ...valid, suggestedRpmDelta: 100, suggestedDoseDelta: 0.5, suggestedYieldDelta: 4 }));
  it("keeps dose and shot weight changes for espresso only", () => {
    const shot = onlyWhatApplies(said, context({ brew: { methodKind: "espresso", recipeStyle: { name: "Standard", brewsLike: "standard" } } }), new Set());
    expect(shot).toMatchObject({ suggestedDoseDelta: 0.5, suggestedYieldDelta: 4 });
    expect(onlyWhatApplies(said, context(), new Set())).toMatchObject({ suggestedDoseDelta: null, suggestedYieldDelta: null });
  });
  it("treats a change of 0 as none, and the RPM as before", () => {
    const zero = parseAnalysisMessage(reply({ ...valid, suggestedDoseDelta: 0, suggestedYieldDelta: 0.02 }));
    expect(onlyWhatApplies(zero, context({ brew: { methodKind: "espresso" } }), new Set())).toMatchObject({ suggestedDoseDelta: null, suggestedYieldDelta: null });
    expect(onlyWhatApplies(said, context(), new Set()).suggestedRpmDelta).toBeNull(); // the C40 isn't variable speed
  });
});

describe("what the AI is sent (docs/api/llm-contract.md §9)", () => {
  it("sends only this brew, leaves out what wasn't recorded, and describes its grinder and water in equipment", () => {
    const input = toLlmInput(context());
    expect(input).toMatchObject({
      ratingScale: "0.5-5",
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
    expect(Object.keys(input)).toEqual(["ratingScale", "bean", "recipe", "brew", "equipment"]);
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
    expect(promptSections(cold)).not.toContain("flashChilled");
    const iced = toLlmInput(context({ brew: { actualWaterGrams: 150, actualIceGrams: 100 } }));
    expect(promptSections(iced)).toContain("flashChilled");
    // A hot concentrate served diluted; a diluted cold brew is the cold section's.
    const concentrate = toLlmInput(context({ brew: { dilutionRatio: 0.7, dilutedWith: "ice", tdsPercent: 3.1 } }));
    expect(promptSections(concentrate)).toEqual(expect.arrayContaining(["tds", "concentrate"]));
    expect(promptSections(concentrate)).not.toContain("cold");
    const dilutedCold = toLlmInput(context({ brew: { recipeStyle: { name: "Cold brew", brewsLike: "cold_brew" }, dilutionRatio: 1, dilutedWith: "water" } }));
    expect(promptSections(dilutedCold)).not.toContain("concentrate");
  });

  it("every section's text comes from @barista/shared/aiPrompt, each prompt's in it (docs/api/auth.md §1c)", () => {
    const keys = (kind: "analysis" | "suggest") => PROMPT_SECTION_TEXTS.filter((t) => t.prompts.includes(kind)).map((t) => t.key).sort();
    expect(PROMPT_SECTIONS.map((x) => x.key).sort()).toEqual(keys("analysis"));
    expect(SUGGEST_SECTIONS.map((x) => x.key).sort()).toEqual(keys("suggest"));
    for (const x of [...PROMPT_SECTIONS, ...SUGGEST_SECTIONS]) expect(x.text, x.key).toBe(PROMPT_TEXT[x.key]);
  });

  it("a barista's own prompt: their section texts, but never a locked one, then their instructions and a note before end", () => {
    const input = toLlmInput(context());
    const custom = { prompt: { instructions: "I like it light.", overrides: { core: "Be brief.", output: "Answer in prose.", origin: "Ignore origin." } }, note: "Tasted cold." };
    expect(promptSections(input, PROMPT_SECTIONS, custom)).toEqual(["core", "output", "style", "altitude", "origin", "water", "instructions", "note", "end"]);
    const system = buildSystemPrompt(input, PROMPT_SECTIONS, custom);
    expect(system.startsWith("Be brief. " + PROMPT_TEXT.output)).toBe(true); // output is locked
    expect(system).toContain("Ignore origin.");
    expect(system).not.toContain("Answer in prose.");
    expect(system.endsWith(`${INSTRUCTIONS_INTRO} I like it light. ${NOTE_INTRO} Tasted cold. ${PROMPT_TEXT.end}`)).toBe(true);
    // A section that isn't needed stays out, overridden or not.
    expect(promptSections(input, PROMPT_SECTIONS, { prompt: { instructions: null, overrides: { espresso: "Pull it short." } }, note: null })).not.toContain("espresso");
    // Nothing added: the default prompt.
    expect(buildSystemPrompt(input, PROMPT_SECTIONS, { prompt: { instructions: null, overrides: {} }, note: null })).toBe(buildSystemPrompt(input));
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
      required: ["reasoning", "nextStep", "confidence", "suggestedGrindDelta", "suggestedTempDelta", "suggestedRpmDelta", "suggestedDoseDelta", "suggestedYieldDelta"],
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

  it("sends the varieties and species with their section, unless kept from the AI", () => {
    const ctx = context({ bean: { varieties: ["SL28"], species: ["arabica", "robusta"] } });
    expect(toLlmInput(ctx).bean).toMatchObject({ varieties: ["SL28"], species: ["arabica", "robusta"] });
    expect(promptSections(toLlmInput(ctx))).toContain("variety");
    expect(promptSections(toLlmInput(context()))).not.toContain("variety");
    const hidden = toLlmInput(ctx, without("variety"));
    expect(hidden.bean).not.toHaveProperty("varieties");
    expect(hidden.bean).not.toHaveProperty("species");
    expect(promptSections(hidden)).not.toContain("variety");
  });

  it("sends the roast weight loss with its section, unless kept from the AI", () => {
    const ctx = context({ bean: { roastWeightLossPercent: 15.5 } });
    expect(toLlmInput(ctx).bean).toMatchObject({ roastWeightLossPercent: 15.5 });
    expect(promptSections(toLlmInput(ctx))).toContain("weightLoss");
    const hidden = toLlmInput(ctx, without("weightLoss"));
    expect(hidden.bean).not.toHaveProperty("roastWeightLossPercent");
    expect(promptSections(hidden)).not.toContain("weightLoss");
  });

  it("says when step times scale with the batch, with the steps", () => {
    const base = context();
    const ctx = { ...base, recipe: base.recipe && { ...base.recipe, stepTimeScaling: 0.5 } };
    expect(toLlmInput(ctx).recipe).toMatchObject({ stepTimeScaling: 0.5 });
    expect(promptSections(toLlmInput(ctx))).toContain("stepTimes");
    expect(promptSections(toLlmInput(context()))).not.toContain("stepTimes");
    const hidden = toLlmInput(ctx, without("recipeSteps"));
    expect(hidden.recipe).not.toHaveProperty("stepTimeScaling");
    expect(promptSections(hidden)).not.toContain("stepTimes");
  });

  it("explains held steps when a brew has a hold, with the marks", () => {
    const ctx = context({ brew: { marks: [{ kind: "step_hold", stepOrder: 2, atSec: 60 }, { kind: "step_resume", stepOrder: 2, atSec: 72 }] } });
    expect(promptSections(toLlmInput(ctx))).toContain("heldSteps");
    expect(promptSections(toLlmInput(context({ brew: { marks: [{ kind: "step_end", stepOrder: 1, atSec: 52 }] } })))).not.toContain("heldSteps");
    const hidden = toLlmInput(ctx, without("marks"));
    expect(hidden.brew).not.toHaveProperty("marks");
    expect(promptSections(hidden)).not.toContain("heldSteps");
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

  it("can leave out the drink", () => {
    const ctx = context({ brew: { drink: { name: "Latte", ingredientTypes: ["milk"] }, drinkRating: 4, drinkTastingNotes: "Sweet" } });
    const input = toLlmInput(ctx, without("drink"));
    for (const gone of ["drink", "drinkRating", "drinkTastingNotes"]) expect(input.brew, gone).not.toHaveProperty(gone);
    expect(promptSections(input)).not.toContain("drink");
  });
});

// "Suggest parameters" (docs/api/llm-contract.md §9b): the House V60 on the
// C40, with an earlier brew of this bean (analyzed) and one of another bean.
const earlier = (over: Partial<SuggestBrew> = {}): SuggestBrew => ({ ...summary(), sameBag: true, sameBean: true, sameRecipe: true, sameGrinder: true, bean: null, analysis: null, ...over });
const suggestContext = (over: Partial<SuggestContext> = {}): SuggestContext => {
  const base = context();
  return {
    source: "recipe",
    batch: { doseGrams: 22.5, waterGrams: 375, iceGrams: null, yieldGrams: null, ratio: 16.67 }, // scaled up from 15 g → 250 g
    bean: base.bean,
    roastAgeDays: 14,
    daysFrozen: 0,
    recipe: base.recipe,
    brewer: { name: "V60", kind: "filter", preinfusion: "none", flowControl: "none", pressureControl: "none" },
    grinder,
    brews: [
      earlier({ analysis: { reasoning: "Sour.", nextStep: "Grind finer.", confidence: "medium", suggestedGrindDelta: "finer", suggestedTempDelta: 0, suggestedRpmDelta: null, suggestedDoseDelta: null, suggestedYieldDelta: null, helpful: null } }),
      earlier({ timestamp: "2026-10-18T08:00:00.000Z", sameBag: false, sameBean: false, bean: { ...base.bean, beanName: "Kenya", country: "Kenya" }, tastingNotes: "Bright", water: null }),
    ],
    options: {},
    ratingScale: "0.5-5",
    ...over,
  };
};
const said = { reasoning: "Your last cup was sour.", nextStep: "Watch the drawdown.", confidence: "medium", grindSetting: 19, grindRpm: 900, tempC: 94, ratio: 16, alternatives: [] };
// Something else to try: one of each kind.
const options: SuggestContext["options"] = {
  recipes: [
    { ref: "r1", id: "recipe-2", name: "Tetsu 4:6", brewer: "V60", methodKind: "filter", style: null, targetDoseGrams: 20, targetWaterGrams: 300, targetIceGrams: null, expectedYieldGrams: 260, targetTempC: 92 },
  ],
  brewers: [{ ref: "b1", id: "brewer-2", name: "Origami", kind: "filter" }],
  beans: [{ ref: "n1", id: "bean-2", bean: { ...context().bean, beanName: "Kenya", country: "Kenya" }, roastAgeDays: 9, gramsLeft: 120 }],
};

describe("what Suggest parameters sends (docs/api/llm-contract.md §9b)", () => {
  it("the brew to make, and each earlier brew marked like it or not, with its analysis", () => {
    const input = toSuggestInput(suggestContext());
    expect(Object.keys(input)).toEqual(["ratingScale", "source", "batch", "bean", "roastAgeDays", "daysFrozen", "recipe", "brewer", "grinder", "brews", "equipment"]);
    expect(input).toMatchObject({ source: "recipe", batch: { doseGrams: 22.5, waterGrams: 375, ratio: 16.67 }, roastAgeDays: 14, daysFrozen: 0, grinder: "C40", brewer: { name: "V60", kind: "filter" }, recipe: { name: "House V60" } });
    expect(input.brewer).not.toHaveProperty("preinfusion"); // only an espresso machine's controls
    const [mine, other] = input.brews as Array<Record<string, unknown>>;
    expect(mine).toMatchObject({ sameBag: true, sameBean: true, sameRecipe: true, sameGrinder: true, analysis: { reasoning: "Sour.", suggestedGrindDelta: "finer" } });
    expect(mine).not.toHaveProperty("bean");
    expect(other).toMatchObject({ sameBag: false, sameBean: false, bean: { beanName: "Kenya", country: "Kenya" }, tastingNotes: "Bright" });
    expect(input.equipment).toEqual({ grinders: { C40: expect.any(Object) }, waters: { TWW: expect.any(Object) } });
  });

  it("keeps the same details from the AI as an analysis, other beans' too", () => {
    const input = toSuggestInput(suggestContext(), without("origin", "water", "temp"));
    const [, other] = input.brews as Array<Record<string, unknown>>;
    expect(input.bean).not.toHaveProperty("country");
    expect(other?.bean).not.toHaveProperty("country");
    expect(input.recipe).not.toHaveProperty("targetTempC");
    expect(input.equipment).not.toHaveProperty("waters");
  });

  it("an espresso machine's controls, unless hidden", () => {
    const machine = { name: "Linea", kind: "espresso", preinfusion: "manual", flowControl: "none", pressureControl: "none" } as const;
    expect(toSuggestInput(suggestContext({ brewer: machine })).brewer).toMatchObject({ preinfusion: "manual" });
    expect(toSuggestInput(suggestContext({ brewer: machine }), without("machine")).brewer).toEqual({ name: "Linea", kind: "espresso" });
  });

  it("its own opening, output and espresso sections; the topic sections as an analysis has them", () => {
    const input = toSuggestInput(suggestContext());
    expect(promptSections(input, SUGGEST_SECTIONS)).toEqual(["suggestCore", "suggestOutput", "style", "altitude", "origin", "water", "end"]);
    const shot = toSuggestInput(suggestContext({ recipe: { ...context().recipe!, methodKind: "espresso" }, brews: [] }));
    expect(promptSections(shot, SUGGEST_SECTIONS)).toContain("suggestEspresso"); // from the recipe, with no brews
    expect(promptSections(shot, SUGGEST_SECTIONS)).not.toContain("espresso");
  });

  it("what else it may suggest, by ref, only when asked for", () => {
    expect(toSuggestInput(suggestContext())).not.toHaveProperty("options");
    const input = toSuggestInput(suggestContext({ options }), without("origin", "temp"));
    expect(input.options).toMatchObject({ recipes: [{ ref: "r1", name: "Tetsu 4:6", brewer: "V60" }], brewers: [{ ref: "b1", name: "Origami" }], beans: [{ ref: "n1", gramsLeft: 120, bean: { beanName: "Kenya" } }] });
    expect(JSON.stringify(input.options)).not.toMatch(/recipe-2|brewer-2|bean-2/); // ids stay here
    expect((input.options as { recipes: object[] }).recipes[0]).not.toHaveProperty("targetTempC");
    expect((input.options as { beans: Array<{ bean: object }> }).beans[0]?.bean).not.toHaveProperty("country");
    expect(promptSections(input, SUGGEST_SECTIONS).slice(-2)).toEqual(["suggestAlternatives", "end"]);
    expect(promptSections(toSuggestInput(suggestContext()), SUGGEST_SECTIONS)).not.toContain("suggestAlternatives");
  });

  it("pins the prompt for a filter recipe", () => {
    expect(buildSystemPrompt(toSuggestInput(suggestContext()), SUGGEST_SECTIONS)).toMatchSnapshot();
  });

  it("sends it under its own strict schema", () => {
    const ctx = suggestContext();
    const req = buildSuggestRequest(ctx);
    expect(req.messages[0]).toEqual({ role: "system", content: buildSystemPrompt(toSuggestInput(ctx), SUGGEST_SECTIONS) });
    expect(JSON.parse(String(req.messages[1]?.content))).toEqual(toSuggestInput(ctx));
    expect(req.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "parameter_suggestion", strict: true, schema: { additionalProperties: false, required: ["reasoning", "nextStep", "confidence", "grindSetting", "grindRpm", "tempC", "ratio", "alternatives"] } },
    });
  });
});

describe("parseSuggestionMessage and onlySuggestionsThatApply", () => {
  it("rounds to the columns", () => {
    expect(parseSuggestionMessage(reply({ ...said, grindSetting: 19.256, tempC: 93.44, ratio: 16.666 }))).toMatchObject({ grindSetting: 19.26, tempC: 93.4, ratio: 16.67 });
  });

  it.each([
    ["a temperature over 100 °C", { ...said, tempC: 120 }, /tempC/],
    ["a ratio of 0", { ...said, ratio: 0 }, /ratio/],
    ["a fractional RPM", { ...said, grindRpm: 900.5 }, /grindRpm/],
    ["a missing field", { ...said, ratio: undefined }, /ratio/],
  ])("rejects %s (so BullMQ retries)", (_label, body, error) => {
    expect(() => parseSuggestionMessage(reply(body))).toThrow(error);
  });

  it("only a ratio the method brews at, and not the batch's own (kept either way)", () => {
    const parsed = parseSuggestionMessage(reply(said));
    expect(onlySuggestionsThatApply(parsed, suggestContext(), new Set()).ratio).toBe(16);
    expect(onlySuggestionsThatApply({ ...parsed, ratio: 2.2 }, suggestContext(), new Set()).ratio).toBe(2.2); // a concentrate
    expect(onlySuggestionsThatApply({ ...parsed, ratio: 1.5 }, suggestContext(), new Set()).ratio).toBeNull();
    expect(onlySuggestionsThatApply({ ...parsed, ratio: 16.67 }, suggestContext(), new Set()).ratio).toBeNull();
    const shot = suggestContext({ recipe: { ...context().recipe!, methodKind: "espresso" } });
    expect(onlySuggestionsThatApply({ ...parsed, ratio: 2.2 }, shot, new Set()).ratio).toBe(2.2);
    expect(onlySuggestionsThatApply(parsed, shot, new Set()).ratio).toBeNull(); // 1:16 isn't a shot
  });

  it("only a setting on the grinder's dial, a speed on a variable-speed one, a temperature the AI may see", () => {
    const parsed = parseSuggestionMessage(reply(said));
    expect(onlySuggestionsThatApply(parsed, suggestContext(), new Set())).toMatchObject({ grindSetting: 19, grindRpm: null, tempC: 94 }); // the C40 is fixed speed
    expect(onlySuggestionsThatApply({ ...parsed, grindSetting: 55 }, suggestContext(), new Set()).grindSetting).toBeNull(); // the C40 goes to 40
    expect(onlySuggestionsThatApply(parsed, suggestContext({ grinder: null }), new Set()).grindSetting).toBeNull();
    const ek = suggestContext({ grinder: { ...grinder!, variableSpeed: true, rpmMin: 300, rpmMax: 1500 } });
    expect(onlySuggestionsThatApply(parsed, ek, new Set()).grindRpm).toBe(900);
    expect(onlySuggestionsThatApply(parsed, ek, without("rpm", "temp"))).toMatchObject({ grindRpm: null, tempC: null });
  });

  it("alternatives: the option named, of its kind, one of each kind, as the row", () => {
    const parsed = parseSuggestionMessage(
      reply({
        ...said,
        alternatives: [
          { kind: "recipe", option: "r1", why: "A lighter, more even extraction." },
          { kind: "recipe", option: "r1", why: "Twice." },
          { kind: "brewer", option: "n1", why: "Wrong kind." },
          { kind: "bean", option: "n9", why: "Not an option." },
          { kind: "bean", option: "n1", why: "Brighter, suits this recipe." },
        ],
      }),
    );
    expect(onlySuggestionsThatApply(parsed, suggestContext({ options }), new Set()).alternatives).toEqual([
      { kind: "recipe", id: "recipe-2", name: "Tetsu 4:6 (V60)", why: "A lighter, more even extraction." },
      { kind: "bean", id: "bean-2", name: "Onyx Kenya", why: "Brighter, suits this recipe." },
    ]);
    expect(onlySuggestionsThatApply(parsed, suggestContext(), new Set()).alternatives).toEqual([]); // none asked for
  });
});

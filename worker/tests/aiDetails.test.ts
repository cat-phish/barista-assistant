import { describe, expect, it } from "vitest";
import { AI_DETAILS, type AiDetail } from "@barista/shared/aiDetails";
import type { BrewContext, BrewSummary, DrinkInfo, GrinderInfo, WaterInfo } from "../src/context.js";
import { toLlmInput, toSuggestInput } from "../src/prompt.js";
import type { BeanOption, BrewerInfo, BrewerOption, PastAnalysis, RecipeOption, SuggestBatch, SuggestBrew, SuggestContext } from "../src/suggestContext.js";

// Parity between what the AI is sent and what Settings → AI can switch off
// (docs/api/llm-contract.md §9, "What the AI sees"). Every field of the
// analysis context is either always sent or belongs to an AI_DETAILS key.
// A field added to (or removed from) the context fails the type check here
// until it's classified; then the tests below check the switch really drops
// it. A new key also needs its label in frontend/src/lib/aiDetails.ts and a
// line in §9.
type Sees = AiDetail | "always";
type Recipe = NonNullable<BrewContext["recipe"]>;
type Step = Recipe["steps"][number];

const CONTEXT: Record<keyof BrewContext, Sees> = {
  bean: "always", // field by field below
  recipe: "always",
  brew: "always",
  drink: "drink",
  ratingScale: "always",
};

const BREW: Record<keyof BrewSummary, Sees> = {
  timestamp: "always",
  roastAgeDays: "always",
  daysFrozenBeforeBrew: "always",
  recipeName: "always",
  recipeStyle: "always",
  methodKind: "always",
  grinder: "always", // its name; details in GRINDER
  water: "water", // its name; figures in WATER
  machine: "machine",
  marks: "marks",
  prepTools: "prepTools",
  problems: "problems",
  actualDoseGrams: "always",
  actualWaterGrams: "always",
  actualIceGrams: "always",
  actualYieldGrams: "always",
  brewRatio: "always",
  tdsPercent: "tds",
  extractionYieldPercent: "tds",
  actualTempC: "temp",
  actualGrindSetting: "always",
  grindRpm: "rpm",
  steeping: "always",
  beanWeightInGrams: "grinderWeights",
  groundWeightOutGrams: "grinderWeights",
  grinderRetentionGrams: "grinderWeights",
  actualTimeSec: "always",
  drink: "drink",
  rating: "always",
  tastingNotes: "always",
  drinkRating: "drink",
  drinkTastingNotes: "drink",
  steepTemp: "always",
  dilutionRatio: "always",
  dilutedWith: "always",
  steepMinHours: "always",
  steepMaxHours: "always",
  expectedFinishMinSec: "always",
  expectedFinishMaxSec: "always",
};

const BEAN: Record<keyof BrewContext["bean"], Sees> = {
  roasterName: "always",
  beanName: "always",
  batchNumber: "batchNumber",
  process: "process",
  roastLevel: "roastLevel",
  detailedRoastLevel: "roastLevel",
  roastType: "roastType",
  blendType: "decafBlend",
  decaf: "decafBlend",
  roastDate: "always",
  flavorProfile: "flavorProfile",
  originArea: "origin",
  country: "origin",
  region: "origin",
  altitudeMasl: "altitude",
  roastWeightLossPercent: "weightLoss",
};

const RECIPE: Record<keyof Recipe, Sees> = {
  name: "always",
  brewer: "always",
  style: "always",
  methodKind: "always",
  targetDoseGrams: "always",
  targetWaterGrams: "always",
  targetIceGrams: "always",
  expectedYieldGrams: "always",
  expectedFinishMinSec: "always",
  expectedFinishMaxSec: "always",
  firstDropMinSec: "always",
  firstDropMaxSec: "always",
  targetTempC: "temp",
  steepMinHours: "always",
  steepMaxHours: "always",
  steepTemp: "always",
  dilutionRatio: "always",
  dilutionWith: "always",
  grindStartingPoints: "grindStartingPoints",
  flowUnit: "always",
  stepTimeScaling: "recipeSteps", // says the step times were scaled
  steps: "recipeSteps", // field by field in STEP
};

// Each step goes with recipeSteps; these are switched off on their own too.
const STEP: Record<keyof Step, Sees> = {
  stepOrder: "always",
  stepType: "always",
  label: "always",
  durationSec: "always",
  advance: "always",
  targetWaterGrams: "always",
  targetTempC: "temp",
  pressureBar: "always",
  pressureEndBar: "always",
  flowRate: "always",
  flowEndRate: "always",
};

// All but the name also go with grinderDetails.
const GRINDER: Record<keyof GrinderInfo, Sees> = {
  name: "always",
  adjustment: "grinderDetails",
  settingMin: "grinderDetails",
  settingMax: "grinderDetails",
  stepSize: "grinderDetails",
  burrType: "grinderDetails",
  burrSizeMm: "grinderDetails",
  power: "grinderDetails",
  variableSpeed: "rpm",
  rpmMin: "rpm",
  rpmMax: "rpm",
};

// All of it also goes with water.
const WATER: Record<keyof WaterInfo, Sees> = {
  name: "water",
  tdsPpm: "waterMinerals",
  generalHardnessPpm: "waterMinerals",
  alkalinityPpm: "waterMinerals",
  calciumPpm: "waterMinerals",
  magnesiumPpm: "waterMinerals",
  sodiumPpm: "waterMinerals",
  potassiumPpm: "waterMinerals",
  bicarbonatePpm: "waterMinerals",
  chloridePpm: "waterMinerals",
  sulfatePpm: "waterMinerals",
  ph: "waterMinerals",
};

const DRINK: Record<keyof DrinkInfo, Sees> = { name: "drink", servingSize: "drink", ingredients: "drink" };

// Not fields: they decide which brews are analyzed (processor.test.ts) or,
// for "Suggest parameters", sent as history.
const NOT_FIELDS: AiDetail[] = ["unratedHistory", "analyzeUnrated"];

// Every field recorded, so nothing is dropped as empty.
const grinder: GrinderInfo = { name: "EK43", adjustment: "stepless", settingMin: 0, settingMax: 16, stepSize: 0.5, burrType: "flat", burrSizeMm: 98, power: "electric", variableSpeed: true, rpmMin: 300, rpmMax: 1500 } as GrinderInfo;
const water: WaterInfo = { name: "TWW", tdsPpm: 120, generalHardnessPpm: 80, alkalinityPpm: 40, calciumPpm: 30, magnesiumPpm: 10, sodiumPpm: 5, potassiumPpm: 2, bicarbonatePpm: 48, chloridePpm: 7, sulfatePpm: 9, ph: 7.2 };
const brew: BrewSummary = {
  timestamp: "2026-10-20T08:00:00.000Z", roastAgeDays: 10, daysFrozenBeforeBrew: 2, recipeName: "House", recipeStyle: { name: "Cold brew", brewsLike: "cold_brew" }, methodKind: "filter",
  grinder, water, machine: { name: "Linea", preinfusion: "manual", flowControl: "manual", pressureControl: "none" }, marks: [{ kind: "first_drop", stepOrder: null, atSec: 7 }],
  prepTools: ["WDT"], problems: ["Channeling"], actualDoseGrams: 60, actualWaterGrams: 500, actualIceGrams: 100, actualYieldGrams: 420, brewRatio: 8.33, tdsPercent: 4.2, extractionYieldPercent: 19.5,
  actualTempC: 20, actualGrindSetting: 12, grindRpm: 900, steeping: true, beanWeightInGrams: 60.3, groundWeightOutGrams: 60, grinderRetentionGrams: 0.3, actualTimeSec: 57600,
  drink: { name: "Iced latte", ingredientTypes: ["milk"] }, rating: 4, tastingNotes: "Chocolate", drinkRating: 5, drinkTastingNotes: "Sweet", steepTemp: "fridge", dilutionRatio: 1,
  dilutedWith: "milk", steepMinHours: 14, steepMaxHours: 20, expectedFinishMinSec: 100, expectedFinishMaxSec: 200,
} as BrewSummary;
const full: BrewContext = {
  bean: { roasterName: "Onyx", beanName: "Monarch", batchNumber: "7", process: "Washed", roastLevel: "light", detailedRoastLevel: "city", roastType: "filter", blendType: "blend", decaf: true, roastDate: "2026-10-10", flavorProfile: "Peach", originArea: "africa", country: "Ethiopia", region: "Guji", altitudeMasl: 2000, roastWeightLossPercent: 15 },
  recipe: {
    name: "House", brewer: "Toddy", style: { name: "Cold brew", brewsLike: "cold_brew" }, methodKind: "filter", targetDoseGrams: 60, targetWaterGrams: 500, targetIceGrams: 100, expectedYieldGrams: 420, expectedFinishMinSec: 100,
    expectedFinishMaxSec: 200, firstDropMinSec: 5, firstDropMaxSec: 9, targetTempC: 20, steepMinHours: 14, steepMaxHours: 20, steepTemp: "fridge", dilutionRatio: 1, dilutionWith: "milk",
    grindStartingPoints: [{ grinderName: "EK43", setting: 12 }], flowUnit: "ml_s", stepTimeScaling: 0.5,
    steps: [{ stepOrder: 1, stepType: "pour", label: "Fill", durationSec: 30, advance: "tap", targetWaterGrams: 500, targetTempC: 20, pressureBar: 9, pressureEndBar: 6, flowRate: 2, flowEndRate: 1 }],
  },
  brew,
  drink: { name: "Iced latte", servingSize: "12 fl oz", ingredients: [{ name: "Milk", ingredientType: "milk", amount: "200 g", note: null }] },
  ratingScale: "1-5",
} as BrewContext;

type Obj = Record<string, unknown>;
// Where each map's fields land in the input: [map, its object in the input].
const PLACES: Array<[string, Record<string, Sees>, (input: Obj) => Obj | undefined]> = [
  ["context", CONTEXT, (i) => i],
  ["brew", BREW, (i) => i.brew as Obj | undefined],
  ["bean", BEAN, (i) => i.bean as Obj | undefined],
  ["recipe", RECIPE, (i) => i.recipe as Obj | undefined],
  ["step", STEP, (i) => ((i.recipe as Obj | undefined)?.steps as Obj[] | undefined)?.[0]],
  ["grinder", GRINDER, (i) => ((i.equipment as Obj | undefined)?.grinders as Obj | undefined)?.EK43 as Obj | undefined],
  ["water", WATER, (i) => ((i.equipment as Obj | undefined)?.waters as Obj | undefined)?.TWW as Obj | undefined],
  ["drink", DRINK, (i) => i.drink as Obj | undefined],
];
// The grinder's and water's names are sent on the brew, as the key to their details.
const sent = (input: Obj, place: string, key: string): boolean => {
  if (place === "grinder" && key === "name") return (input.brew as Obj).grinder === "EK43";
  if (place === "water" && key === "name") return (input.brew as Obj | undefined)?.water === "TWW";
  return PLACES.find(([p]) => p === place)![2](input)?.[key] !== undefined;
};

describe("what the AI sees: every field always sent or switchable (llm-contract.md §9)", () => {
  const cases = PLACES.flatMap(([place, map]) => Object.entries(map).map(([key, sees]) => [place, key, sees] as const));

  it.each(cases.filter(([, , sees]) => sees === "always"))("%s.%s is always sent", (place, key) => {
    const everythingOff = new Set<AiDetail>(AI_DETAILS.filter((d) => !NOT_FIELDS.includes(d)));
    expect(sent(toLlmInput(full) as Obj, place, key)).toBe(true);
    // Except what a switch drops as a whole (the recipe's steps).
    if (place !== "step") expect(sent(toLlmInput(full, everythingOff) as Obj, place, key)).toBe(true);
  });

  it.each(cases.filter(([, , sees]) => sees !== "always"))("%s.%s goes with %s", (place, key, sees) => {
    expect(sent(toLlmInput(full) as Obj, place, key)).toBe(true);
    expect(sent(toLlmInput(full, new Set([sees as AiDetail])) as Obj, place, key)).toBe(false);
  });

  it("every AI_DETAILS key switches something off", () => {
    const used = new Set(cases.map(([, , sees]) => sees));
    expect(AI_DETAILS.filter((d) => !used.has(d) && !NOT_FIELDS.includes(d))).toEqual([]);
  });
});

// "Suggest parameters" (§9b) sends the brew about to be made and earlier
// brews: these fields on top of the maps above (each earlier brew is a BREW,
// another bean's a BEAN, the recipe a RECIPE).
const SUGGEST: Record<keyof SuggestContext, Sees> = {
  source: "always",
  batch: "always", // field by field in BATCH
  bean: "always",
  roastAgeDays: "always",
  daysFrozen: "always",
  recipe: "always",
  brewer: "always", // field by field in BREWER
  grinder: "always", // its name; details in GRINDER
  brews: "always", // each like brew; unrated ones: unratedHistory
  options: "always", // only the kinds asked; field by field below
  ratingScale: "always",
};
// What else it may suggest. The ids are matched back from ref, not sent.
const RECIPE_OPTION: Record<Exclude<keyof RecipeOption, "id">, Sees> = {
  ref: "always",
  name: "always",
  brewer: "always",
  methodKind: "always",
  style: "always",
  targetDoseGrams: "always",
  targetWaterGrams: "always",
  targetIceGrams: "always",
  expectedYieldGrams: "always",
  targetTempC: "temp",
};
const BREWER_OPTION: Record<Exclude<keyof BrewerOption, "id">, Sees> = { ref: "always", name: "always", kind: "always" };
const BEAN_OPTION: Record<Exclude<keyof BeanOption, "id">, Sees> = {
  ref: "always",
  bean: "always", // field by field in BEAN
  roastAgeDays: "always",
  gramsLeft: "always", // whether there's enough for the batch
};
const EARLIER: Record<Exclude<keyof SuggestBrew, keyof BrewSummary>, Sees> = {
  sameBag: "always",
  sameBean: "always",
  sameRecipe: "always",
  sameGrinder: "always",
  bean: "always", // another bean's, field by field in BEAN
  analysis: "always", // field by field in ANALYSIS
};
const ANALYSIS: Record<keyof PastAnalysis, Sees> = {
  reasoning: "always",
  nextStep: "always",
  confidence: "always",
  suggestedGrindDelta: "always",
  suggestedTempDelta: "always",
  suggestedRpmDelta: "always",
  suggestedDoseDelta: "always",
  suggestedYieldDelta: "always",
  helpful: "always",
};
// The batch about to be brewed, which the AI keeps: it suggests the ratio.
const BATCH: Record<keyof SuggestBatch, Sees> = { doseGrams: "always", waterGrams: "always", iceGrams: "always", yieldGrams: "always", ratio: "always" };
// An espresso machine's controls go with machine.
const BREWER: Record<keyof BrewerInfo, Sees> = { name: "always", kind: "always", preinfusion: "machine", flowControl: "machine", pressureControl: "machine" };

const pastAnalysis: PastAnalysis = { reasoning: "Sour.", nextStep: "Finer.", confidence: "low", suggestedGrindDelta: "finer", suggestedTempDelta: 1, suggestedRpmDelta: 50, suggestedDoseDelta: 0.5, suggestedYieldDelta: 2, helpful: true };
const suggest: SuggestContext = {
  source: "recipe",
  batch: { doseGrams: 20, waterGrams: 200, iceGrams: 100, yieldGrams: 36, ratio: 15 }, // every field, though no batch has them all
  bean: full.bean,
  roastAgeDays: 12,
  daysFrozen: 2,
  recipe: full.recipe,
  brewer: { name: "Linea", kind: "espresso", preinfusion: "manual", flowControl: "manual", pressureControl: "manual" },
  grinder,
  brews: [{ ...brew, sameBag: false, sameBean: false, sameRecipe: true, sameGrinder: true, bean: full.bean, analysis: pastAnalysis } as SuggestBrew],
  options: {
    recipes: [
      {
        ref: "r1",
        id: "recipe-2",
        name: "Kalita",
        brewer: "Wave",
        methodKind: "filter",
        style: { name: "Pour over", brewsLike: "pour_over" },
        targetDoseGrams: 20,
        targetWaterGrams: 320,
        targetIceGrams: 10,
        expectedYieldGrams: 280,
        targetTempC: 93,
      },
    ],
    brewers: [{ ref: "b1", id: "brewer-2", name: "Origami", kind: "filter" }],
    beans: [{ ref: "n1", id: "bean-2", bean: full.bean, roastAgeDays: 9, gramsLeft: 120 }],
  },
  ratingScale: "1-5",
};
const SUGGEST_PLACES: Array<[string, Record<string, Sees>, (input: Obj) => Obj | undefined]> = [
  ["suggest", SUGGEST, (i) => i],
  ["earlier", { ...BREW, ...EARLIER }, (i) => (i.brews as Obj[] | undefined)?.[0]],
  ["earlier bean", BEAN, (i) => (i.brews as Obj[] | undefined)?.[0]?.bean as Obj | undefined],
  ["analysis", ANALYSIS, (i) => (i.brews as Obj[] | undefined)?.[0]?.analysis as Obj | undefined],
  ["brewer", BREWER, (i) => i.brewer as Obj | undefined],
  ["batch", BATCH, (i) => i.batch as Obj | undefined],
  ["recipe option", RECIPE_OPTION, (i) => ((i.options as Obj | undefined)?.recipes as Obj[] | undefined)?.[0]],
  ["brewer option", BREWER_OPTION, (i) => ((i.options as Obj | undefined)?.brewers as Obj[] | undefined)?.[0]],
  ["bean option", BEAN_OPTION, (i) => ((i.options as Obj | undefined)?.beans as Obj[] | undefined)?.[0]],
  ["option bean", BEAN, (i) => ((i.options as Obj | undefined)?.beans as Obj[] | undefined)?.[0]?.bean as Obj | undefined],
];
const suggestSent = (input: Obj, place: string, key: string): boolean => {
  const at = SUGGEST_PLACES.find(([p]) => p === place)![2](input);
  if (place === "earlier" && key === "grinder") return at?.grinder === "EK43"; // by name
  if (place === "earlier" && key === "water") return at?.water === "TWW";
  return at?.[key] !== undefined;
};

describe("what Suggest parameters sends: every field always sent or switchable (llm-contract.md §9b)", () => {
  const cases = SUGGEST_PLACES.flatMap(([place, map]) => Object.entries(map).map(([key, sees]) => [place, key, sees] as const));

  it.each(cases.filter(([, , sees]) => sees === "always"))("%s.%s is always sent", (place, key) => {
    const everythingOff = new Set<AiDetail>(AI_DETAILS.filter((d) => !NOT_FIELDS.includes(d)));
    expect(suggestSent(toSuggestInput(suggest) as Obj, place, key)).toBe(true);
    expect(suggestSent(toSuggestInput(suggest, everythingOff) as Obj, place, key)).toBe(true);
  });

  it.each(cases.filter(([, , sees]) => sees !== "always"))("%s.%s goes with %s", (place, key, sees) => {
    expect(suggestSent(toSuggestInput(suggest) as Obj, place, key)).toBe(true);
    expect(suggestSent(toSuggestInput(suggest, new Set([sees as AiDetail])) as Obj, place, key)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { AI_DETAILS, type AiDetail } from "@barista/shared/aiDetails";
import type { BrewContext, BrewSummary, DrinkInfo, GrinderInfo, WaterInfo } from "../src/context.js";
import { toLlmInput } from "../src/prompt.js";

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
  previousBrews: "always", // each like brew; unrated ones: unratedHistory
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

// Not fields: they decide which brews are sent or analyzed (tested in
// llm.test.ts and processor.test.ts).
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
  bean: { roasterName: "Onyx", beanName: "Monarch", batchNumber: "7", process: "Washed", roastLevel: "light", detailedRoastLevel: "city", roastType: "filter", blendType: "blend", decaf: true, roastDate: "2026-10-10", flavorProfile: "Peach", originArea: "africa", country: "Ethiopia", region: "Guji", altitudeMasl: 2000 },
  recipe: {
    name: "House", brewer: "Toddy", style: { name: "Cold brew", brewsLike: "cold_brew" }, methodKind: "filter", targetDoseGrams: 60, targetWaterGrams: 500, targetIceGrams: 100, expectedYieldGrams: 420, expectedFinishMinSec: 100,
    expectedFinishMaxSec: 200, firstDropMinSec: 5, firstDropMaxSec: 9, targetTempC: 20, steepMinHours: 14, steepMaxHours: 20, steepTemp: "fridge", dilutionRatio: 1, dilutionWith: "milk",
    grindStartingPoints: [{ grinderName: "EK43", setting: 12 }], flowUnit: "ml_s",
    steps: [{ stepOrder: 1, stepType: "pour", label: "Fill", durationSec: 30, advance: "tap", targetWaterGrams: 500, targetTempC: 20, pressureBar: 9, pressureEndBar: 6, flowRate: 2, flowEndRate: 1 }],
  },
  brew,
  drink: { name: "Iced latte", servingSize: "12 fl oz", ingredients: [{ name: "Milk", ingredientType: "milk", amount: "200 g", note: null }] },
  previousBrews: [{ ...brew, timestamp: "2026-10-18T08:00:00.000Z" }],
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

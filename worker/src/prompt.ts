// What the AI is sent for an analysis (docs/api/llm-contract.md §9): the
// brew's context made compact (no empty values, its grinder and water
// described once, what the workspace keeps from the AI left out), and a
// system prompt built from sections that only appear when the input has what
// they talk about.
import type { AiDetail } from "@barista/shared/aiDetails";
import type { BrewContext, BrewSummary, GrinderInfo, WaterInfo } from "./context.js";

// Stored with each analysis (llm_analyses.prompt_version), so results can be
// compared across changes (npm run eval). Bump it whenever the input, the
// prompt or the schema changes.
export const PROMPT_VERSION = "2026-10-f";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type LlmInput = { [key: string]: Json };

// Drops null, undefined, empty strings, arrays and objects, so a missing key
// always means "not recorded" (the prompt says so).
export function compact(value: unknown): Json | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((v): v is Json => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, compact(v)] as const)
      .filter((e): e is readonly [string, Json] => e[1] !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value as Json;
}

const WATER_FIGURES: Array<keyof WaterInfo> = ["tdsPpm", "generalHardnessPpm", "alkalinityPpm", "calciumPpm", "magnesiumPpm", "sodiumPpm", "potassiumPpm", "bicarbonatePpm", "chloridePpm", "sulfatePpm", "ph"];

// One brew as the AI sees it: the grinder and water by name (their details
// are in `equipment`), without what the workspace keeps from the AI.
function brewInput(b: BrewSummary, hidden: ReadonlySet<AiDetail>): Record<string, unknown> {
  const { grinder, water, machine, marks, prepTools, problems, drink, steeping, ...rest } = b;
  const out: Record<string, unknown> = { ...rest, grinder: grinder?.name, water: hidden.has("water") ? undefined : water?.name };
  if (steeping) out.steeping = true;
  if (!hidden.has("machine")) out.machine = machine;
  if (!hidden.has("marks")) out.marks = marks;
  if (!hidden.has("prepTools")) out.prepTools = prepTools;
  if (!hidden.has("problems")) out.problems = problems;
  if (hidden.has("tds")) {
    delete out.tdsPercent;
    delete out.extractionYieldPercent;
  }
  if (hidden.has("temp")) delete out.actualTempC;
  if (hidden.has("rpm")) delete out.grindRpm;
  if (hidden.has("grinderWeights")) {
    delete out.beanWeightInGrams;
    delete out.groundWeightOutGrams;
    delete out.grinderRetentionGrams;
  }
  if (hidden.has("drink")) {
    delete out.drinkRating;
    delete out.drinkTastingNotes;
  } else out.drink = drink;
  return out;
}

export function toLlmInput(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set()): LlmInput {
  const b = context.brew;

  // The grinder and water by name, described here.
  const grinders: Record<string, unknown> = {};
  const waters: Record<string, unknown> = {};
  if (b.grinder) {
    const { name, ...details } = b.grinder;
    const shown: Partial<GrinderInfo> = hidden.has("grinderDetails") ? {} : details;
    if (hidden.has("rpm")) {
      delete shown.variableSpeed;
      delete shown.rpmMin;
      delete shown.rpmMax;
    }
    grinders[name] = shown;
  }
  if (b.water && !hidden.has("water")) {
    const water = b.water;
    waters[water.name] = hidden.has("waterMinerals") ? {} : Object.fromEntries(WATER_FIGURES.map((k) => [k, water[k]]));
  }

  const bean: Record<string, unknown> = { ...context.bean };
  const drop = (keys: string[]) => keys.forEach((k) => delete bean[k]);
  if (hidden.has("origin")) drop(["originArea", "country", "region"]);
  if (hidden.has("altitude")) drop(["altitudeMasl"]);
  if (hidden.has("process")) drop(["process"]);
  if (hidden.has("flavorProfile")) drop(["flavorProfile"]);
  if (hidden.has("roastType")) drop(["roastType"]);
  if (hidden.has("roastLevel")) drop(["roastLevel", "detailedRoastLevel"]);
  if (hidden.has("decafBlend")) drop(["decaf", "blendType"]);
  if (hidden.has("batchNumber")) drop(["batchNumber"]);
  if (bean.decaf === false) delete bean.decaf; // only worth saying when it is

  let recipe: Record<string, unknown> | null = null;
  if (context.recipe) {
    const { steps, grindStartingPoints, targetTempC, flowUnit, ...rest } = context.recipe;
    recipe = { ...rest };
    if (!hidden.has("temp")) recipe.targetTempC = targetTempC;
    if (!hidden.has("grindStartingPoints")) recipe.grindStartingPoints = grindStartingPoints;
    if (!hidden.has("recipeSteps")) recipe.steps = hidden.has("temp") ? steps.map(({ targetTempC: _t, ...s }) => s) : steps;
    if (flowUnit !== "g_s") recipe.flowUnit = flowUnit; // g/s is the default; only flow steps use it
  }

  const input = {
    ratingScale: context.ratingScale,
    bean,
    recipe,
    brew: brewInput(b, hidden),
    drink: hidden.has("drink") ? null : context.drink,
    equipment: { grinders, waters },
  };
  return (compact(input) ?? {}) as LlmInput;
}

// ---- The prompt, in sections ----------------------------------------------------

const brews = (input: LlmInput): Array<Record<string, Json>> => [input.brew].filter((b): b is Record<string, Json> => !!b && typeof b === "object" && !Array.isArray(b));
const anyBrew = (input: LlmInput, key: string) => brews(input).some((b) => b[key] !== undefined);
const bean = (input: LlmInput) => (input.bean ?? {}) as Record<string, Json>;
const recipe = (input: LlmInput) => (input.recipe ?? {}) as Record<string, Json>;
const brewsLike = (input: LlmInput) =>
  brews(input)
    .map((b) => (b.recipeStyle as Record<string, Json> | undefined)?.brewsLike)
    .concat((recipe(input).style as Record<string, Json> | undefined)?.brewsLike);
const methodKinds = (input: LlmInput) => brews(input).map((b) => b.methodKind);
const isCold = (style: Json | undefined) => style === "cold_brew" || style === "kyoto_drip" || style === "rapid_cold";

export interface PromptSection {
  key: string;
  when: (input: LlmInput) => boolean;
  text: string;
}

export const PROMPT_SECTIONS: PromptSection[] = [
  {
    key: "core",
    when: () => true,
    text:
      "You are an expert specialty coffee roaster and barista. Analyze this one brew (brew) against its recipe and the " +
      "bean, and suggest concrete changes for the next brew. A missing field means it wasn't recorded, not that it was " +
      "zero or absent. The brew's grinder and water are named in it and described in equipment. Ratings are 1-5; " +
      "rating and tastingNotes describe the coffee tasted on its own. Judge mainly from the tasting and how the brew " +
      "went against the recipe's targets, and change as little as needed: one or two levers at a time.",
  },
  {
    key: "output",
    when: () => true,
    text:
      "reasoning is a concise 1-2 sentence diagnosis. nextStep is the one concrete thing to do on the next brew, in " +
      "plain words a barista can act on (e.g. 'Grind 2 clicks coarser and keep 93 °C'). confidence is low when the " +
      "notes are vague, the brew has no recipe to judge it against, or the measurements look wrong; high only when " +
      "the taste and the numbers agree. suggestedRpmDelta is a change in grinder speed for a variable-speed grinder, " +
      "null otherwise or when the speed should stay. suggestedDoseDelta and suggestedYieldDelta are null except for " +
      "espresso.",
  },
  {
    key: "drink",
    when: (i) => i.drink !== undefined || anyBrew(i, "drink") || anyBrew(i, "drinkTastingNotes"),
    text:
      "drinkRating and drinkTastingNotes describe the finished drink (the brew's drink says how it was served). Milk " +
      "and syrup mask acidity and bitterness and add sweetness, so treat drink notes as weaker evidence of extraction " +
      "than straight notes.",
  },
  {
    key: "style",
    when: (i) => brewsLike(i).some((s) => s !== undefined),
    text:
      "Judge a brew against its recipe's style (its name is the bar's own; brewsLike says how it brews, so a custom " +
      "'Inverted' style that brews like immersion is an immersion brew): a soup shot is a long, high-ratio espresso " +
      "on purpose, and an immersion brew isn't a pour over.",
  },
  {
    key: "stovetop",
    when: (i) => methodKinds(i).some((k) => k === "stovetop" || k === "other"),
    text:
      "A stovetop brew (moka pot, ibrik) is a strong, short brew judged on its own terms, not as espresso; an " +
      "'other' method is described by its style and the notes.",
  },
  {
    key: "batch",
    when: (i) => bean(i).batchNumber !== undefined,
    text: "A batchNumber marks one home-roast batch: another batch of the same coffee is a different roast.",
  },
  {
    key: "roastType",
    when: (i) => bean(i).roastType !== undefined,
    text:
      "The bean's roastType says what the roaster roasted it for: an espresso roast brewed as filter (or the " +
      "reverse) may need a different approach rather than small corrections.",
  },
  {
    key: "decafBlend",
    when: (i) => bean(i).decaf === true || bean(i).blendType === "blend",
    text: "Decaf and blends often extract differently from single origins.",
  },
  {
    key: "flavorProfile",
    when: (i) => bean(i).flavorProfile !== undefined,
    text: "The flavorProfile is the roaster's description of the cup to aim for.",
  },
  {
    key: "altitude",
    when: (i) => bean(i).altitudeMasl !== undefined,
    text: "A higher altitudeMasl usually means denser beans that take a finer grind or hotter water.",
  },
  {
    key: "origin",
    when: (i) => ["originArea", "country", "region"].some((k) => bean(i)[k] !== undefined),
    text:
      "The origin (originArea, country, region) hints at the bean's typical character, e.g. many East African " +
      "coffees are dense and bright while Brazilian ones are often lower grown and softer; treat it as context, " +
      "not a rule.",
  },
  {
    key: "tds",
    when: (i) => anyBrew(i, "tdsPercent"),
    text:
      "When tdsPercent is given, use it and extractionYieldPercent to judge strength and extraction rather than " +
      "guessing from taste alone: filter usually lands around 1.15-1.45% TDS and espresso 8-12%, both often 18-22% " +
      "extraction, but the taste and the roaster's intent come first.",
  },
  {
    key: "water",
    when: (i) => Object.values(((i.equipment as Record<string, Json> | undefined)?.waters ?? {}) as Record<string, Json>).some((w) => w && typeof w === "object" && Object.keys(w).length > 0),
    text:
      "A water's figures (mg/L; GH and KH as CaCO3) matter: harder water with more magnesium and calcium tends to " +
      "extract more, while high alkalinity (KH) buffers acidity and can flatten the cup; only the figures given are " +
      "known.",
  },
  {
    key: "prepTools",
    when: (i) => anyBrew(i, "prepTools"),
    text:
      "prepTools lists the prep used (WDT, puck screen, filter type…), as recorded; a tool not listed may still " +
      "have been used.",
  },
  {
    key: "problems",
    when: (i) => anyBrew(i, "problems"),
    text:
      "problems lists what went wrong while brewing (stalled drawdown, channeling, a gushing shot…): these are the " +
      "clearest clues for the next brew, so explain the change from them first (e.g. a stalled bed or a choked shot " +
      "points coarser, channeling to prep and distribution, a mistake like an untared scale to repeating rather than " +
      "adjusting).",
  },
  {
    key: "rpm",
    when: (i) => anyBrew(i, "grindRpm"),
    text:
      "On a variable-speed grinder, grindRpm is part of the grind: a higher speed usually grinds a little finer with " +
      "more fines, a lower one gives a clearer, more even cup; compare grind settings only at similar speeds.",
  },
  {
    key: "retention",
    when: (i) => anyBrew(i, "grinderRetentionGrams"),
    text:
      "grinderRetentionGrams is coffee left in the grinder (beans weighed in minus grounds out); actualDoseGrams is " +
      "what went into the brew. High or changing retention can explain inconsistent brews and stale grounds mixing in.",
  },
  {
    key: "espresso",
    when: (i) => methodKinds(i).includes("espresso"),
    text:
      "For espresso, judge flow from the first drop time, shot time and ratio against the recipe's windows, and " +
      "consider the machine's capabilities (pre-infusion, flow and pressure control) and the grinder's step size when " +
      "explaining the change. Dose and shot weight are levers too: suggestedDoseDelta changes the dose in grams " +
      "(usually 0.5-1 g, within what the basket holds) and suggestedYieldDelta the shot weight in grams. A longer " +
      "shot (more yield) extracts more and tastes lighter, a shorter one is stronger and heavier; a bigger dose " +
      "slows the shot like a finer grind. Prefer one lever: when the grind is right but the cup is too strong, " +
      "weak, sour or bitter, change the ratio rather than the grind, and keep the others null or 0. A pre-infusion " +
      "or profile change, if the machine allows it, goes in nextStep.",
  },
  {
    key: "cold",
    when: (i) => brewsLike(i).some(isCold),
    text:
      "Cold styles (by brewsLike): cold_brew steeps for hours (the brew's steepMinHours-steepMaxHours, the window it " +
      "aimed for, which may differ from the recipe's; in the fridge or at room temperature per steepTemp; " +
      "actualTimeSec is the whole steep); kyoto_drip drips slowly over hours; rapid_cold (e.g. an OXO Rapid Brewer) " +
      "brews cold in minutes, aiming for the brew's expectedFinishMinSec-expectedFinishMaxSec (steepTemp, when set, " +
      "says if the water was fridge-cold or room temperature). Fridge steeps extract more slowly than " +
      "room-temperature ones. These are often concentrates served diluted 1 : dilutionRatio with dilutedWith (the " +
      "recipe's dilutionRatio is the intent): judge strength as served, after dilution. A concentrate's TDS is usually " +
      "around 2.5-5% and the diluted cup around 1.2-1.6%, so a high TDS isn't over-extraction by itself. For long cold " +
      "brews, steep time and grind are the main levers; temperature advice applies to rapid_cold only.",
  },
  {
    key: "concentrate",
    when: (i) =>
      brews(i).some((b) => b.dilutionRatio !== undefined && !isCold((b.recipeStyle as Record<string, Json> | undefined)?.brewsLike)) ||
      (recipe(i).dilutionRatio !== undefined && !isCold((recipe(i).style as Record<string, Json> | undefined)?.brewsLike)),
    text:
      "Hot concentrates (a brew that isn't a cold style, with dilutionRatio; the recipe's is the intent) are brewed " +
      "strong and then served diluted 1 : dilutionRatio with dilutedWith, e.g. poured over ice. tdsPercent and " +
      "extractionYieldPercent are the concentrate's, measured before diluting, so a TDS of 2-5% isn't " +
      "over-extraction by itself; judge extraction from them and strength as served, after the dilution. Over ice " +
      "the cup is also chilled, so judge it as an iced drink. A cup that's too strong or weak as served but well " +
      "extracted needs a different dilution or brew ratio, not a grind change.",
  },
  {
    key: "flashChilled",
    when: (i) => anyBrew(i, "actualIceGrams") || recipe(i).targetIceGrams !== undefined,
    text:
      "Flash chilled brews (with actualIceGrams; the recipe's targetIceGrams is the intent) were brewed hot onto that " +
      "much ice in the server, e.g. Japanese iced pour over. actualWaterGrams is the hot water, which does the " +
      "extracting and which pour targets count; brewRatio counts the ice too, (water + ice) / dose, and " +
      "actualYieldGrams is weighed with the ice in. They take no TDS reading. Judge the cup as served over ice: it " +
      "should be brighter and more aromatic than cold brew, and a thin or watery cup can mean too much ice for the " +
      "hot water as well as under-extraction.",
  },
  {
    key: "end",
    when: () => true,
    text: "Respond strictly matching the provided JSON schema.",
  },
];

// The sections this input needs, in order.
export function promptSections(input: LlmInput): string[] {
  return PROMPT_SECTIONS.filter((s) => s.when(input)).map((s) => s.key);
}
export function buildSystemPrompt(input: LlmInput): string {
  return PROMPT_SECTIONS.filter((s) => s.when(input))
    .map((s) => s.text)
    .join(" ");
}

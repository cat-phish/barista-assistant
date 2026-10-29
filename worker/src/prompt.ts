// What the AI is sent (docs/api/llm-contract.md §9): for an analysis, the
// brew's context; for "Suggest parameters" (§9b), the brew about to be made
// and the earlier brews chosen. Both made compact (no empty values, each
// grinder and water described once, what the workspace keeps from the AI left
// out), with a system prompt built from sections that only appear when the
// input has what they talk about.
import type { AiDetail } from "@barista/shared/aiDetails";
import { INSTRUCTIONS_INTRO, LOCKED_SECTIONS, NOTE_INTRO, PROMPT_TEXT, type AiPrompt } from "@barista/shared/aiPrompt";
import type { BrewContext, BrewSummary, GrinderInfo, WaterInfo } from "./context.js";
import type { BrewerInfo, SuggestContext } from "./suggestContext.js";

// Stored with each analysis (llm_analyses.prompt_version), so results can be
// compared across changes (npm run eval). Bump it whenever the input, the
// prompt or the schema changes.
export const PROMPT_VERSION = "2026-10-k";

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

// Each grinder and water once, by name.
function equipment(used: Array<{ grinder: GrinderInfo | null; water: WaterInfo | null }>, hidden: ReadonlySet<AiDetail>): Record<string, unknown> {
  const grinders: Record<string, unknown> = {};
  const waters: Record<string, unknown> = {};
  for (const { grinder, water } of used) {
    if (grinder && !(grinder.name in grinders)) {
      const { name, ...details } = grinder;
      const shown: Partial<GrinderInfo> = hidden.has("grinderDetails") ? {} : details;
      if (hidden.has("rpm")) {
        delete shown.variableSpeed;
        delete shown.rpmMin;
        delete shown.rpmMax;
      }
      grinders[name] = shown;
    }
    if (water && !hidden.has("water") && !(water.name in waters)) {
      waters[water.name] = hidden.has("waterMinerals") ? {} : Object.fromEntries(WATER_FIGURES.map((k) => [k, water[k]]));
    }
  }
  return { grinders, waters };
}

function beanInput(info: BrewContext["bean"], hidden: ReadonlySet<AiDetail>): Record<string, unknown> {
  const bean: Record<string, unknown> = { ...info };
  const drop = (keys: string[]) => keys.forEach((k) => delete bean[k]);
  if (hidden.has("origin")) drop(["originArea", "country", "region"]);
  if (hidden.has("altitude")) drop(["altitudeMasl"]);
  if (hidden.has("variety")) drop(["varieties", "species"]);
  if (hidden.has("process")) drop(["process"]);
  if (hidden.has("flavorProfile")) drop(["flavorProfile"]);
  if (hidden.has("roastType")) drop(["roastType"]);
  if (hidden.has("roastLevel")) drop(["roastLevel", "detailedRoastLevel"]);
  if (hidden.has("weightLoss")) drop(["roastWeightLossPercent"]);
  if (hidden.has("decafBlend")) drop(["decaf", "blendType"]);
  if (hidden.has("batchNumber")) drop(["batchNumber"]);
  if (bean.decaf === false) delete bean.decaf; // only worth saying when it is
  return bean;
}

function recipeInput(r: BrewContext["recipe"], hidden: ReadonlySet<AiDetail>): Record<string, unknown> | null {
  if (!r) return null;
  const { steps, grindStartingPoints, targetTempC, flowUnit, stepTimeScaling, ...rest } = r;
  const recipe: Record<string, unknown> = { ...rest };
  if (!hidden.has("temp")) recipe.targetTempC = targetTempC;
  if (!hidden.has("grindStartingPoints")) recipe.grindStartingPoints = grindStartingPoints;
  if (!hidden.has("recipeSteps")) {
    recipe.steps = hidden.has("temp") ? steps.map(({ targetTempC: _t, ...s }) => s) : steps;
    recipe.stepTimeScaling = stepTimeScaling;
  }
  if (flowUnit !== "g_s") recipe.flowUnit = flowUnit; // g/s is the default; only flow steps use it
  return recipe;
}

export function toLlmInput(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set()): LlmInput {
  const input = {
    ratingScale: context.ratingScale,
    bean: beanInput(context.bean, hidden),
    recipe: recipeInput(context.recipe, hidden),
    brew: brewInput(context.brew, hidden),
    drink: hidden.has("drink") ? null : context.drink,
    equipment: equipment([context.brew], hidden),
  };
  return (compact(input) ?? {}) as LlmInput;
}

// The brewer chosen: its controls only for an espresso machine the AI may see.
function brewerInput(b: BrewerInfo | null, hidden: ReadonlySet<AiDetail>): Record<string, unknown> | null {
  if (!b) return null;
  const { name, kind, ...controls } = b;
  return kind === "espresso" && !hidden.has("machine") ? { name, kind, ...controls } : { name, kind };
}

// "Suggest parameters" (§9b): the brew about to be made, and the earlier
// brews (each marked like it or not, with the analysis given after it).
export function toSuggestInput(context: SuggestContext, hidden: ReadonlySet<AiDetail> = new Set()): LlmInput {
  const input = {
    ratingScale: context.ratingScale,
    source: context.source,
    batch: context.batch,
    bean: beanInput(context.bean, hidden),
    roastAgeDays: context.roastAgeDays,
    daysFrozen: context.daysFrozen,
    recipe: recipeInput(context.recipe, hidden),
    brewer: brewerInput(context.brewer, hidden),
    grinder: context.grinder?.name,
    brews: context.brews.map(({ sameBag, sameBean, sameRecipe, sameGrinder, bean, analysis, ...b }) => ({
      ...brewInput(b, hidden),
      sameBag,
      sameBean,
      sameRecipe,
      sameGrinder,
      bean: bean ? beanInput(bean, hidden) : null,
      analysis,
    })),
    equipment: equipment([{ grinder: context.grinder, water: null }, ...context.brews], hidden),
    options: optionsInput(context.options, hidden),
  };
  return (compact(input) ?? {}) as LlmInput;
}

// What else it may suggest, by ref (the ids stay here): undefined when
// nothing was asked for, so the prompt section drops out.
function optionsInput(o: SuggestContext["options"], hidden: ReadonlySet<AiDetail>): Record<string, unknown> | undefined {
  if (!o.recipes && !o.brewers && !o.beans) return undefined;
  return {
    recipes: o.recipes?.map(({ id: _id, targetTempC, ...r }) => (hidden.has("temp") ? r : { ...r, targetTempC })),
    brewers: o.brewers?.map(({ id: _id, ...b }) => b),
    beans: o.beans?.map(({ id: _id, bean, ...b }) => ({ ...b, bean: beanInput(bean, hidden) })),
  };
}

// ---- The prompt, in sections ----------------------------------------------------

// The analyzed brew, or the earlier brews sent with a suggestion.
const brews = (input: LlmInput): Array<Record<string, Json>> =>
  [input.brew, ...((input.brews as Json[] | undefined) ?? [])].filter((b): b is Record<string, Json> => !!b && typeof b === "object" && !Array.isArray(b));
const anyBrew = (input: LlmInput, key: string) => brews(input).some((b) => b[key] !== undefined);
const bean = (input: LlmInput) => (input.bean ?? {}) as Record<string, Json>;
const recipe = (input: LlmInput) => (input.recipe ?? {}) as Record<string, Json>;
const brewsLike = (input: LlmInput) =>
  brews(input)
    .map((b) => (b.recipeStyle as Record<string, Json> | undefined)?.brewsLike)
    .concat((recipe(input).style as Record<string, Json> | undefined)?.brewsLike);
const methodKinds = (input: LlmInput) => brews(input).map((b) => b.methodKind).concat(recipe(input).methodKind);
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
    text: PROMPT_TEXT.core,
  },
  {
    key: "output",
    when: () => true,
    text: PROMPT_TEXT.output,
  },
  {
    key: "drink",
    when: (i) => i.drink !== undefined || anyBrew(i, "drink") || anyBrew(i, "drinkTastingNotes"),
    text: PROMPT_TEXT.drink,
  },
  {
    key: "style",
    when: (i) => brewsLike(i).some((s) => s !== undefined),
    text: PROMPT_TEXT.style,
  },
  {
    key: "stovetop",
    when: (i) => methodKinds(i).some((k) => k === "stovetop" || k === "other"),
    text: PROMPT_TEXT.stovetop,
  },
  {
    key: "batch",
    when: (i) => bean(i).batchNumber !== undefined,
    text: PROMPT_TEXT.batch,
  },
  {
    key: "roastType",
    when: (i) => bean(i).roastType !== undefined,
    text: PROMPT_TEXT.roastType,
  },
  {
    key: "decafBlend",
    when: (i) => bean(i).decaf === true || bean(i).blendType === "blend",
    text: PROMPT_TEXT.decafBlend,
  },
  {
    key: "flavorProfile",
    when: (i) => bean(i).flavorProfile !== undefined,
    text: PROMPT_TEXT.flavorProfile,
  },
  {
    key: "weightLoss",
    when: (i) => bean(i).roastWeightLossPercent !== undefined,
    text: PROMPT_TEXT.weightLoss,
  },
  {
    key: "stepTimes",
    when: (i) => recipe(i).stepTimeScaling !== undefined,
    text: PROMPT_TEXT.stepTimes,
  },
  {
    key: "altitude",
    when: (i) => bean(i).altitudeMasl !== undefined,
    text: PROMPT_TEXT.altitude,
  },
  {
    key: "variety",
    when: (i) => bean(i).varieties !== undefined || bean(i).species !== undefined,
    text: PROMPT_TEXT.variety,
  },
  {
    key: "origin",
    when: (i) => ["originArea", "country", "region"].some((k) => bean(i)[k] !== undefined),
    text: PROMPT_TEXT.origin,
  },
  {
    key: "tds",
    when: (i) => anyBrew(i, "tdsPercent"),
    text: PROMPT_TEXT.tds,
  },
  {
    key: "water",
    when: (i) => Object.values(((i.equipment as Record<string, Json> | undefined)?.waters ?? {}) as Record<string, Json>).some((w) => w && typeof w === "object" && Object.keys(w).length > 0),
    text: PROMPT_TEXT.water,
  },
  {
    key: "prepTools",
    when: (i) => anyBrew(i, "prepTools"),
    text: PROMPT_TEXT.prepTools,
  },
  {
    key: "problems",
    when: (i) => anyBrew(i, "problems"),
    text: PROMPT_TEXT.problems,
  },
  {
    key: "rpm",
    when: (i) => anyBrew(i, "grindRpm"),
    text: PROMPT_TEXT.rpm,
  },
  {
    key: "retention",
    when: (i) => anyBrew(i, "grinderRetentionGrams"),
    text: PROMPT_TEXT.retention,
  },
  {
    key: "espresso",
    when: (i) => methodKinds(i).includes("espresso"),
    text: PROMPT_TEXT.espresso,
  },
  {
    key: "cold",
    when: (i) => brewsLike(i).some(isCold),
    text: PROMPT_TEXT.cold,
  },
  {
    key: "concentrate",
    when: (i) =>
      brews(i).some((b) => b.dilutionRatio !== undefined && !isCold((b.recipeStyle as Record<string, Json> | undefined)?.brewsLike)) ||
      (recipe(i).dilutionRatio !== undefined && !isCold((recipe(i).style as Record<string, Json> | undefined)?.brewsLike)),
    text: PROMPT_TEXT.concentrate,
  },
  {
    key: "flashChilled",
    when: (i) => anyBrew(i, "actualIceGrams") || recipe(i).targetIceGrams !== undefined,
    text: PROMPT_TEXT.flashChilled,
  },
  {
    key: "end",
    when: () => true,
    text: PROMPT_TEXT.end,
  },
];

// "Suggest parameters" (§9b): its own opening, output and espresso
// sections; the topic sections (drink, style, cold, water…) as the analysis has them.
const SUGGEST_OWN: PromptSection[] = [
  {
    key: "suggestCore",
    when: () => true,
    text: PROMPT_TEXT.suggestCore,
  },
  {
    key: "suggestOutput",
    when: () => true,
    text: PROMPT_TEXT.suggestOutput,
  },
  {
    key: "suggestEspresso",
    when: (i) => methodKinds(i).includes("espresso"),
    text: PROMPT_TEXT.suggestEspresso,
  },
  {
    key: "suggestAlternatives",
    when: (i) => i.options !== undefined,
    text: PROMPT_TEXT.suggestAlternatives,
  },
];
const ownSection = (key: string) => SUGGEST_OWN.find((s) => s.key === key)!;
export const SUGGEST_SECTIONS: PromptSection[] = [
  ownSection("suggestCore"),
  ownSection("suggestOutput"),
  ...PROMPT_SECTIONS.filter((s) => s.key !== "core" && s.key !== "output" && s.key !== "end").map((s) => (s.key === "espresso" ? ownSection("suggestEspresso") : s)),
  ownSection("suggestAlternatives"),
  PROMPT_SECTIONS.find((s) => s.key === "end")!,
];

// What the barista adds (docs/api/auth.md §1c): their own text for unlocked
// sections, their instructions, and a one-off note with this request. The
// instructions and the note go just before `end`; whether a section is
// included stays the worker's to decide.
export interface PromptCustom {
  prompt: AiPrompt;
  note: string | null;
}
function customized(sections: PromptSection[], custom: PromptCustom | undefined): PromptSection[] {
  if (!custom) return sections;
  const { overrides, instructions } = custom.prompt;
  const own = sections.map((s) => (overrides[s.key] && !LOCKED_SECTIONS.includes(s.key) ? { ...s, text: overrides[s.key]! } : s));
  const added: PromptSection[] = [];
  if (instructions) added.push({ key: "instructions", when: () => true, text: `${INSTRUCTIONS_INTRO} ${instructions}` });
  if (custom.note) added.push({ key: "note", when: () => true, text: `${NOTE_INTRO} ${custom.note}` });
  const end = own.findIndex((s) => s.key === "end");
  return [...own.slice(0, end), ...added, ...own.slice(end)];
}

// The sections this input needs, in order.
export function promptSections(input: LlmInput, sections: PromptSection[] = PROMPT_SECTIONS, custom?: PromptCustom): string[] {
  return customized(sections, custom)
    .filter((s) => s.when(input))
    .map((s) => s.key);
}
export function buildSystemPrompt(input: LlmInput, sections: PromptSection[] = PROMPT_SECTIONS, custom?: PromptCustom): string {
  return customized(sections, custom)
    .filter((s) => s.when(input))
    .map((s) => s.text)
    .join(" ");
}

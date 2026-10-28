import { ratioWater, extractionYield as sharedExtractionYield } from "@barista/shared/brew";
import {
  beanProcesses,
  beanFreezes,
  beans,
  brewLogMarks,
  ingredients,
  drinkIngredients,
  drinks,
  brewLogs,
  brewers,
  grinders,
  recipeGrindSettings,
  recipes,
  recipeStyles,
  recipeSteps,
  waterProfiles,
  prepTools,
  brewLogTools,
  brewProblems,
  brewLogProblems,
  type Bean,
  type BlendType,
  type DetailedRoastLevel,
  type OriginArea,
  type RoastType,
  type BrewLog,
  type Grinder,
  type Brewer,
  type FlowUnit,
  type MarkKind,
  type RecipeStyle,
  type MethodKind,
  type ServingUnit,
  type StepAdvance,
  type WaterProfile,
  type SteepTemp,
  type DilutionWith,
} from "@barista/shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "./db.js";
import { config } from "./config.js";
import { localBrewDate } from "./localDate.js";
import { effectiveRoastAge, type FreezePeriodLike } from "./roastAge.js";

// The grinder a grind setting refers to, with whatever details are recorded
// (range and step size let the LLM talk in clicks; speed is for variable-speed
// grinders). docs/api/llm-contract.md §9.
export type GrinderInfo = Pick<
  Grinder,
  "name" | "adjustment" | "settingMin" | "settingMax" | "stepSize" | "burrType" | "burrSizeMm" | "power" | "variableSpeed" | "rpmMin" | "rpmMax"
>;
// The water a brew was made with: its name and whatever figures are recorded
// (mg/L; GH and KH as CaCO3). docs/api/water-profiles.md §3c.
export type WaterInfo = Pick<
  WaterProfile,
  | "name" | "tdsPpm" | "generalHardnessPpm" | "alkalinityPpm" | "calciumPpm" | "magnesiumPpm"
  | "sodiumPpm" | "potassiumPpm" | "bicarbonatePpm" | "chloridePpm" | "sulfatePpm" | "ph"
>;
// Espresso brews: what the machine (the log's brewer) lets the barista control.
export type MachineInfo = Pick<Brewer, "name" | "preinfusion" | "flowControl" | "pressureControl">;

// What the LLM sees about one brew (docs/api/llm-contract.md §9).
export interface BrewSummary {
  timestamp: string;
  // Effective age on the brew's date: days since roasting minus days frozen.
  roastAgeDays: number | null;
  daysFrozenBeforeBrew: number | null;
  recipeName: string | null;
  // How the recipe brews (StyleInfo). Compare brews of the same style.
  recipeStyle: StyleInfo | null;
  // The recipe's brew method (filter / espresso), null without a recipe.
  methodKind: MethodKind | null;
  // The grind setting only means something for this grinder (docs/api/llm-contract.md §9).
  grinder: GrinderInfo | null;
  water: WaterInfo | null; // the water profile used, if recorded
  machine: MachineInfo | null; // espresso only
  // Shot timer taps, earliest first (espresso): first drop, end of manual pre-infusion.
  marks: Array<{ kind: MarkKind; stepOrder: number | null; atSec: number }>;
  // Prep tools used, in checklist order (docs/api/prep-tools.md §3d). Empty
  // means none were recorded, not that none were used.
  prepTools: string[];
  // What went wrong while brewing, in list order (docs/api/brew-problems.md
  // §6b). Empty means none were recorded, not that nothing went wrong.
  problems: string[];
  actualDoseGrams: number;
  actualWaterGrams: number | null; // null for espresso
  actualIceGrams: number | null; // flash chilled: ice in the server the hot water was brewed onto
  actualYieldGrams: number | null; // measured beverage weight (shot weight for espresso; with the ice for flash chilled)
  brewRatio: number | null; // (water + ice) / dose; for espresso yield / dose
  tdsPercent: number | null; // refractometer reading
  extractionYieldPercent: number | null; // from TDS (docs/api/brew-logs.md §6)
  actualTempC: number | null;
  actualGrindSetting: number | null; // the number on the grinder's dial
  grindRpm: number | null; // grinder speed, variable-speed grinders only
  steeping: boolean; // a long cold brew started and not finished: no result yet
  // Beans weighed before grinding and grounds out; retention = in − out
  // (docs/api/brew-logs.md §6). actualDoseGrams is what went into the brew.
  beanWeightInGrams: number | null;
  groundWeightOutGrams: number | null;
  grinderRetentionGrams: number | null;
  actualTimeSec: number;
  // How it was served: a drink and its ingredient types (milk, syrup…), or
  // null for the coffee on its own.
  drink: { name: string; ingredientTypes: string[] } | null;
  // The coffee tasted on its own (for a milk drink, only if tasted straight).
  rating: number | null;
  tastingNotes: string | null;
  // The finished drink (milk and syrup mask acidity and bitterness).
  drinkRating: number | null;
  drinkTastingNotes: string | null;
  // Cold styles: where a long brew steeped (fridge / room), and the dilution
  // it was served with (1 : dilutionRatio, with dilutedWith); null if neat.
  steepTemp: SteepTemp | null;
  dilutionRatio: number | null;
  dilutedWith: DilutionWith | null;
  // The window this brew aimed for (the recipe's, or changed for this brew;
  // docs/api/brew-logs.md §6): a long style's steep in hours, rapid cold's
  // finish in seconds. Each pair is both or neither.
  steepMinHours: number | null;
  steepMaxHours: number | null;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
}

// The drink a brew was made for: tasting notes may describe the whole drink.
// servingSize is the size made ("12 fl oz"), and amounts are scaled to it.
export interface DrinkInfo {
  name: string;
  servingSize: string | null;
  ingredients: Array<{ name: string; ingredientType: string; amount: string | null; note: string | null }>;
}

type Size = { size: number | null; unit: ServingUnit | null };
const ML_PER_FL_OZ = 29.5735;
const toMl = (s: Size) => (s.size === null || s.unit === null ? null : s.unit === "fl_oz" ? s.size * ML_PER_FL_OZ : s.size);
const sizeLabel = (s: Size) => (s.size === null || s.unit === null ? null : `${s.size} ${s.unit === "fl_oz" ? "fl oz" : "ml"}`);

// Scale an ingredient amount from the drink's default size to the size made.
export function scaledAmount(value: number | null, unit: string | null, factor: number): string | null {
  if (value === null) return unit;
  const n = Math.round(value * factor * 100) / 100;
  return unit ? `${n} ${unit}` : String(n);
}

export interface BrewContext {
  // roastLevel: one of ROAST_LEVELS (light … dark), or null if unknown.
  // detailedRoastLevel (cinnamon … french), roastType (filter, espresso,
  // omni) and blendType (single_origin, blend, other): null if unknown.
  bean: {
    roasterName: string;
    beanName: string;
    batchNumber: string | null; // a home-roast batch: one roast of this bean
    process: string | null; // the workspace's name for it (docs/api/bean-processes.md §4b)
    roastLevel: string | null;
    detailedRoastLevel: DetailedRoastLevel | null;
    roastType: RoastType | null;
    blendType: BlendType | null;
    decaf: boolean;
    roastDate: string | null;
    flavorProfile: string | null; // the roaster's tasting notes: the cup to aim for
    originArea: OriginArea | null;
    country: string | null;
    region: string | null;
    altitudeMasl: number | null;
    roastWeightLossPercent: number | null; // % of the green weight lost in roasting
  };
  recipe: {
    name: string;
    brewer: string; // e.g. "V60", "Linea Mini"
    style: StyleInfo | null; // how it brews
    methodKind: MethodKind;
    targetDoseGrams: number;
    targetWaterGrams: number | null; // null for espresso
    targetIceGrams: number | null; // flash chilled: ice in the server
    expectedYieldGrams: number | null; // estimate; for espresso the target shot weight
    // Target window for total brew (or shot) time, seconds (both or neither).
    expectedFinishMinSec: number | null;
    expectedFinishMaxSec: number | null;
    // Espresso: target window for the first drop, seconds (both or neither).
    firstDropMinSec: number | null;
    firstDropMaxSec: number | null;
    targetTempC: number | null;
    // Cold styles (docs/api/recipes.md §5): the steep window in hours, fridge
    // or room, and the serving dilution the recipe intends.
    steepMinHours: number | null;
    steepMaxHours: number | null;
    steepTemp: SteepTemp | null;
    dilutionRatio: number | null;
    dilutionWith: DilutionWith | null;
    // Approximate starting points, per grinder (the brew's grinder is in grinderName).
    grindStartingPoints: Array<{ grinderName: string; setting: number }>;
    flowUnit: FlowUnit; // for flow steps: g/s or ml/s
    // Back to back: each starts when the previous one actually ended
    // (step_end marks say when, for tap/logged steps).
    steps: Array<{
      stepOrder: number;
      stepType: string;
      label: string | null;
      durationSec: number | null; // null = until finish; a guide for tap steps
      advance: StepAdvance;
      targetWaterGrams: number | null; // cumulative "pour to" weight
      targetTempC: number | null;
      pressureBar: number | null;
      pressureEndBar: number | null; // ramp end
      flowRate: number | null;
      flowEndRate: number | null;
    }>;
  } | null;
  // Only this brew, no earlier ones (docs/api/llm-contract.md §9).
  brew: BrewSummary;
  drink: DrinkInfo | null; // the brew's drink, if any
  ratingScale: "1-5";
}

// A recipe's style (docs/api/recipe-styles.md §5e): the workspace's name for
// it, and the built-in it brews like (pour_over, immersion, hybrid,
// cold_brew; standard, soup; moka, ibrik; other). A custom style such as
// "Inverted" brews like immersion: judge it as that.
export interface StyleInfo {
  name: string;
  brewsLike: RecipeStyle;
}

interface BrewJoins {
  recipeName: string | null;
  recipeStyle: StyleInfo | null;
  methodKind: MethodKind | null;
  grinder: GrinderInfo | null;
  water: WaterInfo | null;
  machine: MachineInfo | null;
}
export type BrewRow = BrewLog & BrewJoins;

function ratio(brew: BrewLog): number | null {
  const out = ratioWater(brew.actualWaterGrams, brew.actualIceGrams) ?? brew.actualYieldGrams;
  return out === null ? null : Math.round((out / brew.actualDoseGrams) * 100) / 100;
}

// Extraction yield, % (docs/api/brew-logs.md §6), by the shared rule.
export function extractionYield(brew: BrewLog, style: StyleInfo | null): number | null {
  return sharedExtractionYield({ ...brew, brewsLike: style?.brewsLike ?? null });
}

// Coffee left in the grinder, g: beans in − grounds out (both weighed).
export function grinderRetention(brew: Pick<BrewLog, "beanWeightInGrams" | "groundWeightOutGrams">): number | null {
  const { beanWeightInGrams: into, groundWeightOutGrams: out } = brew;
  return into === null || out === null ? null : Math.round((into - out) * 100) / 100;
}

export function summarize(
  brew: BrewRow,
  roastDate: Date | null,
  freezes: readonly FreezePeriodLike[],
  marks: ReadonlyMap<string, BrewSummary["marks"]>,
  tools: ReadonlyMap<string, string[]>,
  problems: ReadonlyMap<string, string[]>,
  servedAs: ReadonlyMap<string, NonNullable<BrewSummary["drink"]>>
): BrewSummary {
  const age = roastDate
    ? effectiveRoastAge(roastDate.toISOString(), freezes, localBrewDate(brew.timestamp, brew.utcOffsetMinutes, config.brewTimezone))
    : null;
  return {
    timestamp: brew.timestamp.toISOString(),
    roastAgeDays: age?.ageDays ?? null,
    daysFrozenBeforeBrew: age?.daysFrozen ?? null,
    recipeName: brew.recipeName,
    recipeStyle: brew.recipeStyle,
    methodKind: brew.methodKind,
    grinder: brew.grinder,
    water: brew.water,
    machine: brew.machine,
    marks: marks.get(brew.id) ?? [],
    prepTools: tools.get(brew.id) ?? [],
    problems: problems.get(brew.id) ?? [],
    actualDoseGrams: brew.actualDoseGrams,
    actualWaterGrams: brew.actualWaterGrams,
    actualIceGrams: brew.actualIceGrams,
    actualYieldGrams: brew.actualYieldGrams,
    brewRatio: ratio(brew),
    tdsPercent: brew.tdsPercent,
    extractionYieldPercent: extractionYield(brew, brew.recipeStyle),
    actualTempC: brew.actualTempC,
    actualGrindSetting: brew.actualGrindSetting,
    grindRpm: brew.grindRpm,
    steeping: brew.steeping,
    beanWeightInGrams: brew.beanWeightInGrams,
    groundWeightOutGrams: brew.groundWeightOutGrams,
    grinderRetentionGrams: grinderRetention(brew),
    actualTimeSec: brew.actualTimeSec,
    drink: brew.drinkId ? (servedAs.get(brew.drinkId) ?? null) : null,
    rating: brew.rating,
    tastingNotes: brew.tastingNotes,
    drinkRating: brew.drinkRating,
    drinkTastingNotes: brew.drinkTastingNotes,
    steepTemp: brew.steepTemp,
    dilutionRatio: brew.dilutionRatio,
    dilutedWith: brew.dilutedWith,
    steepMinHours: brew.steepMinHours,
    steepMaxHours: brew.steepMaxHours,
    expectedFinishMinSec: brew.expectedFinishMinSec,
    expectedFinishMaxSec: brew.expectedFinishMaxSec,
  };
}

// Each drink's name and ingredient types, for labelling how brews were served.
export async function drinksServed(drinkIds: string[]): Promise<Map<string, NonNullable<BrewSummary["drink"]>>> {
  const ids = [...new Set(drinkIds)];
  if (ids.length === 0) return new Map();
  const [names, types] = await Promise.all([
    db.select({ id: drinks.id, name: drinks.name }).from(drinks).where(inArray(drinks.id, ids)),
    db
      .selectDistinct({ drinkId: drinkIngredients.drinkId, type: ingredients.ingredientType })
      .from(drinkIngredients)
      .innerJoin(ingredients, eq(drinkIngredients.ingredientId, ingredients.id))
      .where(inArray(drinkIngredients.drinkId, ids)),
  ]);
  return new Map(
    names.map((d) => [d.id, { name: d.name, ingredientTypes: types.filter((t) => t.drinkId === d.id).map((t) => t.type).sort() }])
  );
}

async function loadDrink(drinkId: string, made: Size): Promise<DrinkInfo | null> {
  const [drink] = await db
    .select({ name: drinks.name, size: drinks.servingSize, unit: drinks.servingUnit })
    .from(drinks)
    .where(eq(drinks.id, drinkId))
    .limit(1);
  if (!drink) return null;
  const parts = await db
    .select({
      name: ingredients.name,
      ingredientType: ingredients.ingredientType,
      amountValue: drinkIngredients.amountValue,
      amountUnit: drinkIngredients.amountUnit,
      note: drinkIngredients.note,
    })
    .from(drinkIngredients)
    .innerJoin(ingredients, eq(drinkIngredients.ingredientId, ingredients.id))
    .where(eq(drinkIngredients.drinkId, drinkId))
    .orderBy(asc(drinkIngredients.position));
  // Amounts are for the drink's default size; scale them to the size made.
  const [madeMl, defaultMl] = [toMl(made), toMl(drink)];
  const factor = madeMl && defaultMl ? madeMl / defaultMl : 1;
  return {
    name: drink.name,
    servingSize: sizeLabel(made) ?? sizeLabel(drink),
    ingredients: parts.map(({ amountValue, amountUnit, ...c }) => ({ ...c, amount: scaledAmount(amountValue, amountUnit, factor) })),
  };
}

export async function marksFor(brewLogIds: string[]): Promise<Map<string, BrewSummary["marks"]>> {
  const rows = await db
    .select({ brewLogId: brewLogMarks.brewLogId, kind: brewLogMarks.kind, stepOrder: brewLogMarks.stepOrder, atSec: brewLogMarks.atSec })
    .from(brewLogMarks)
    .where(inArray(brewLogMarks.brewLogId, brewLogIds))
    .orderBy(asc(brewLogMarks.atSec));
  const byLog = new Map<string, BrewSummary["marks"]>();
  for (const { brewLogId, ...mark } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), mark]);
  return byLog;
}

// Each brew's prep tool names, in checklist order.
export async function toolsFor(brewLogIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ brewLogId: brewLogTools.brewLogId, name: prepTools.name })
    .from(brewLogTools)
    .innerJoin(prepTools, eq(brewLogTools.toolId, prepTools.id))
    .where(inArray(brewLogTools.brewLogId, brewLogIds))
    .orderBy(asc(prepTools.position), asc(prepTools.name));
  const byLog = new Map<string, string[]>();
  for (const { brewLogId, name } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), name]);
  return byLog;
}

// Each brew's problem names, in list order.
export async function problemsFor(brewLogIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ brewLogId: brewLogProblems.brewLogId, name: brewProblems.name })
    .from(brewLogProblems)
    .innerJoin(brewProblems, eq(brewLogProblems.problemId, brewProblems.id))
    .where(inArray(brewLogProblems.brewLogId, brewLogIds))
    .orderBy(asc(brewProblems.position), asc(brewProblems.name));
  const byLog = new Map<string, string[]>();
  for (const { brewLogId, name } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), name]);
  return byLog;
}

export function withJoins({ brew, ...joins }: { brew: BrewLog } & BrewJoins): BrewRow {
  return { ...brew, ...joins };
}

const machineBrewers = alias(brewers, "machine_brewer");

export function selectBrews() {
  return db
    .select({
      brew: brewLogs,
      recipeName: recipes.name,
      recipeStyle: { name: recipeStyles.name, brewsLike: recipeStyles.brewsLike },
      methodKind: brewers.kind,
      grinder: {
        name: grinders.name,
        adjustment: grinders.adjustment,
        settingMin: grinders.settingMin,
        settingMax: grinders.settingMax,
        stepSize: grinders.stepSize,
        burrType: grinders.burrType,
        burrSizeMm: grinders.burrSizeMm,
        power: grinders.power,
        variableSpeed: grinders.variableSpeed,
        rpmMin: grinders.rpmMin,
        rpmMax: grinders.rpmMax,
      },
      water: {
        name: waterProfiles.name,
        tdsPpm: waterProfiles.tdsPpm,
        generalHardnessPpm: waterProfiles.generalHardnessPpm,
        alkalinityPpm: waterProfiles.alkalinityPpm,
        calciumPpm: waterProfiles.calciumPpm,
        magnesiumPpm: waterProfiles.magnesiumPpm,
        sodiumPpm: waterProfiles.sodiumPpm,
        potassiumPpm: waterProfiles.potassiumPpm,
        bicarbonatePpm: waterProfiles.bicarbonatePpm,
        chloridePpm: waterProfiles.chloridePpm,
        sulfatePpm: waterProfiles.sulfatePpm,
        ph: waterProfiles.ph,
      },
      machine: {
        name: machineBrewers.name,
        preinfusion: machineBrewers.preinfusion,
        flowControl: machineBrewers.flowControl,
        pressureControl: machineBrewers.pressureControl,
      },
    })
    .from(brewLogs)
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
    .leftJoin(brewers, eq(recipes.brewerId, brewers.id))
    .leftJoin(grinders, eq(brewLogs.grinderId, grinders.id))
    .leftJoin(waterProfiles, eq(brewLogs.waterProfileId, waterProfiles.id))
    // The brewer the log was made with, as a machine only when it's espresso.
    .leftJoin(machineBrewers, and(eq(brewLogs.brewerId, machineBrewers.id), eq(machineBrewers.kind, "espresso")));
}

// A bean as the AI sees it, with what its roast age is worked out from.
export interface LoadedBean {
  info: BrewContext["bean"];
  roastDate: Date | null;
  freezes: FreezePeriodLike[];
}
export async function loadBean(beanId: string): Promise<LoadedBean | null> {
  const [beanRow] = await db.select().from(beans).where(eq(beans.id, beanId)).limit(1);
  if (!beanRow) return null;
  const bean: Bean = beanRow;
  const [processRow, freezes] = await Promise.all([
    bean.processId
      ? db.select({ name: beanProcesses.name }).from(beanProcesses).where(eq(beanProcesses.id, bean.processId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
    db.select({ frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn }).from(beanFreezes).where(eq(beanFreezes.beanId, beanId)),
  ]);
  return {
    info: {
      roasterName: bean.roasterName,
      beanName: bean.beanName,
      batchNumber: bean.batchNumber,
      process: processRow?.name ?? null,
      roastLevel: bean.roastLevel,
      detailedRoastLevel: bean.detailedRoastLevel,
      roastType: bean.roastType,
      blendType: bean.blendType,
      decaf: bean.decaf,
      roastDate: bean.roastDate ? bean.roastDate.toISOString().slice(0, 10) : null,
      flavorProfile: bean.flavorProfile,
      originArea: bean.originArea,
      country: bean.country,
      region: bean.region,
      altitudeMasl: bean.altitudeMasl,
      roastWeightLossPercent: bean.roastWeightLossPercent,
    },
    roastDate: bean.roastDate,
    freezes,
  };
}

// Returns null if the brew log was deleted after the job was queued.
export async function loadBrewContext(brewLogId: string): Promise<BrewContext | null> {
  const [target] = await selectBrews().where(eq(brewLogs.id, brewLogId)).limit(1);
  if (!target) return null;
  const brew = withJoins(target);

  const bean = await loadBean(brew.beanId);
  if (!bean) return null; // Bean deletion cascades, so this means the log is going too.

  const [recipe, marks, tools, problems, servedAs] = await Promise.all([
    brew.recipeId ? loadRecipe(brew.recipeId) : Promise.resolve(null),
    marksFor([brew.id]),
    toolsFor([brew.id]),
    problemsFor([brew.id]),
    drinksServed(brew.drinkId ? [brew.drinkId] : []),
  ]);

  return {
    bean: bean.info,
    recipe,
    brew: summarize(brew, bean.roastDate, bean.freezes, marks, tools, problems, servedAs),
    drink: brew.drinkId ? await loadDrink(brew.drinkId, { size: brew.servingSize, unit: brew.servingUnit }) : null,
    ratingScale: "1-5",
  };
}

export async function loadRecipe(recipeId: string): Promise<BrewContext["recipe"]> {
  const [row] = await db
    .select({
      name: recipes.name,
      brewer: brewers.name,
      style: { name: recipeStyles.name, brewsLike: recipeStyles.brewsLike },
      methodKind: brewers.kind,
      targetDoseGrams: recipes.targetDoseGrams,
      targetWaterGrams: recipes.targetWaterGrams,
      targetIceGrams: recipes.targetIceGrams,
      expectedYieldGrams: recipes.expectedYieldGrams,
      expectedFinishMinSec: recipes.expectedFinishMinSec,
      expectedFinishMaxSec: recipes.expectedFinishMaxSec,
      firstDropMinSec: recipes.firstDropMinSec,
      firstDropMaxSec: recipes.firstDropMaxSec,
      flowUnit: recipes.flowUnit,
      targetTempC: recipes.targetTempC,
      steepMinHours: recipes.steepMinHours,
      steepMaxHours: recipes.steepMaxHours,
      steepTemp: recipes.steepTemp,
      dilutionRatio: recipes.dilutionRatio,
      dilutionWith: recipes.dilutionWith,
    })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
    .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
    .where(eq(recipes.id, recipeId))
    .limit(1);
  if (!row) return null;

  const [steps, grindStartingPoints] = await Promise.all([
    db
      .select({
        stepOrder: recipeSteps.stepOrder,
        stepType: recipeSteps.stepType,
        label: recipeSteps.label,
        durationSec: recipeSteps.durationSec,
        advance: recipeSteps.advance,
        targetWaterGrams: recipeSteps.targetWaterGrams,
        targetTempC: recipeSteps.targetTempC,
        pressureBar: recipeSteps.pressureBar,
        pressureEndBar: recipeSteps.pressureEndBar,
        flowRate: recipeSteps.flowRate,
        flowEndRate: recipeSteps.flowEndRate,
      })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(asc(recipeSteps.stepOrder)),
    db
      .select({ grinderName: grinders.name, setting: recipeGrindSettings.setting })
      .from(recipeGrindSettings)
      .innerJoin(grinders, eq(recipeGrindSettings.grinderId, grinders.id))
      .where(eq(recipeGrindSettings.recipeId, recipeId))
      .orderBy(asc(grinders.name)),
  ]);

  return { ...row, grindStartingPoints, steps };
}

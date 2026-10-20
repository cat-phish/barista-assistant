import {
  beanFreezes,
  beans,
  brewLogMarks,
  components,
  drinkComponents,
  drinks,
  brewLogs,
  brewMethods,
  grinders,
  machines,
  recipeGrindSettings,
  recipes,
  recipeSteps,
  type Bean,
  type BrewLog,
  type Grinder,
  type Machine,
  type FlowUnit,
  type MarkKind,
  type MethodKind,
  type ServingUnit,
  type StepAdvance,
} from "@barista/shared/schema";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "./db.js";
import { effectiveRoastAge, type FreezePeriodLike } from "./roastAge.js";

const PREVIOUS_BREW_COUNT = 5;

// The grinder a grind setting refers to, with whatever details are recorded
// (range and step size let the LLM talk in clicks). docs/api_spec.md §9.
export type GrinderInfo = Pick<Grinder, "name" | "adjustment" | "settingMin" | "settingMax" | "stepSize" | "burrType" | "burrSizeMm" | "power">;
// Espresso brews: what the machine lets the barista control.
export type MachineInfo = Pick<Machine, "name" | "preinfusion" | "flowControl" | "pressureControl">;

// What the LLM sees about one brew (docs/api_spec.md §9).
export interface BrewSummary {
  timestamp: string;
  // Effective age on the brew's date: days since roasting minus days frozen.
  roastAgeDays: number | null;
  daysFrozenBeforeBrew: number | null;
  recipeName: string | null;
  // The recipe's method kind (pour_over / immersion / espresso), null without a recipe.
  methodKind: MethodKind | null;
  // The grind setting only means something for this grinder (docs/api_spec.md §9).
  grinder: GrinderInfo | null;
  machine: MachineInfo | null; // espresso only
  // Shot timer taps, earliest first (espresso): first drop, end of manual pre-infusion.
  marks: Array<{ kind: MarkKind; stepOrder: number | null; atSec: number }>;
  actualDoseGrams: number;
  actualWaterGrams: number | null; // null for espresso
  actualYieldGrams: number | null; // measured beverage weight (shot weight for espresso)
  brewRatio: number | null; // water / dose; for espresso yield / dose
  actualTempC: number | null;
  actualGrindSetting: string | null;
  actualTimeSec: number;
  rating: number | null;
  tastingNotes: string | null;
}

// The drink a brew was made for: tasting notes may describe the whole drink.
// servingSize is the size made ("12 fl oz"), and amounts are scaled to it.
export interface DrinkInfo {
  name: string;
  servingSize: string | null;
  components: Array<{ name: string; componentType: string; amount: string | null; note: string | null }>;
}

type Size = { size: number | null; unit: ServingUnit | null };
const ML_PER_FL_OZ = 29.5735;
const toMl = (s: Size) => (s.size === null || s.unit === null ? null : s.unit === "fl_oz" ? s.size * ML_PER_FL_OZ : s.size);
const sizeLabel = (s: Size) => (s.size === null || s.unit === null ? null : `${s.size} ${s.unit === "fl_oz" ? "fl oz" : "ml"}`);

// Scale a component amount from the drink's default size to the size made.
export function scaledAmount(value: number | null, unit: string | null, factor: number): string | null {
  if (value === null) return unit;
  const n = Math.round(value * factor * 100) / 100;
  return unit ? `${n} ${unit}` : String(n);
}

export interface BrewContext {
  // roastLevel: one of ROAST_LEVELS (light … dark), or null if unknown.
  bean: { roasterName: string; beanName: string; process: string | null; roastLevel: string | null; roastDate: string | null };
  recipe: {
    name: string;
    method: string;
    methodKind: MethodKind;
    targetDoseGrams: number;
    targetWaterGrams: number | null; // null for espresso
    expectedYieldGrams: number | null; // estimate; for espresso the target shot weight
    // Target window for total brew (or shot) time, seconds (both or neither).
    expectedFinishMinSec: number | null;
    expectedFinishMaxSec: number | null;
    // Espresso: target window for the first drop, seconds (both or neither).
    firstDropMinSec: number | null;
    firstDropMaxSec: number | null;
    targetTempC: number | null;
    // Approximate starting points, per grinder (the brew's grinder is in grinderName).
    grindStartingPoints: Array<{ grinderName: string; setting: string }>;
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
  brew: BrewSummary;
  drink: DrinkInfo | null; // the target brew's drink, if any
  previousBrews: BrewSummary[];
  ratingScale: "1-5";
}

interface BrewJoins {
  recipeName: string | null;
  methodKind: MethodKind | null;
  grinder: GrinderInfo | null;
  machine: MachineInfo | null;
}
type BrewRow = BrewLog & BrewJoins;

function ratio(brew: BrewLog): number | null {
  const out = brew.actualWaterGrams ?? brew.actualYieldGrams;
  return out === null ? null : Math.round((out / brew.actualDoseGrams) * 100) / 100;
}

function summarize(
  brew: BrewRow,
  roastDate: Date | null,
  freezes: readonly FreezePeriodLike[],
  marks: ReadonlyMap<string, BrewSummary["marks"]>
): BrewSummary {
  const age = roastDate
    ? effectiveRoastAge(roastDate.toISOString(), freezes, brew.timestamp.toISOString().slice(0, 10))
    : null;
  return {
    timestamp: brew.timestamp.toISOString(),
    roastAgeDays: age?.ageDays ?? null,
    daysFrozenBeforeBrew: age?.daysFrozen ?? null,
    recipeName: brew.recipeName,
    methodKind: brew.methodKind,
    grinder: brew.grinder,
    machine: brew.machine,
    marks: marks.get(brew.id) ?? [],
    actualDoseGrams: brew.actualDoseGrams,
    actualWaterGrams: brew.actualWaterGrams,
    actualYieldGrams: brew.actualYieldGrams,
    brewRatio: ratio(brew),
    actualTempC: brew.actualTempC,
    actualGrindSetting: brew.actualGrindSetting,
    actualTimeSec: brew.actualTimeSec,
    rating: brew.rating,
    tastingNotes: brew.tastingNotes,
  };
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
      name: components.name,
      componentType: components.componentType,
      amountValue: drinkComponents.amountValue,
      amountUnit: drinkComponents.amountUnit,
      note: drinkComponents.note,
    })
    .from(drinkComponents)
    .innerJoin(components, eq(drinkComponents.componentId, components.id))
    .where(eq(drinkComponents.drinkId, drinkId))
    .orderBy(asc(drinkComponents.position));
  // Amounts are for the drink's default size; scale them to the size made.
  const [madeMl, defaultMl] = [toMl(made), toMl(drink)];
  const factor = madeMl && defaultMl ? madeMl / defaultMl : 1;
  return {
    name: drink.name,
    servingSize: sizeLabel(made) ?? sizeLabel(drink),
    components: parts.map(({ amountValue, amountUnit, ...c }) => ({ ...c, amount: scaledAmount(amountValue, amountUnit, factor) })),
  };
}

async function marksFor(brewLogIds: string[]): Promise<Map<string, BrewSummary["marks"]>> {
  const rows = await db
    .select({ brewLogId: brewLogMarks.brewLogId, kind: brewLogMarks.kind, stepOrder: brewLogMarks.stepOrder, atSec: brewLogMarks.atSec })
    .from(brewLogMarks)
    .where(inArray(brewLogMarks.brewLogId, brewLogIds))
    .orderBy(asc(brewLogMarks.atSec));
  const byLog = new Map<string, BrewSummary["marks"]>();
  for (const { brewLogId, ...mark } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), mark]);
  return byLog;
}

function withJoins({ brew, ...joins }: { brew: BrewLog } & BrewJoins): BrewRow {
  return { ...brew, ...joins };
}

function selectBrews() {
  return db
    .select({
      brew: brewLogs,
      recipeName: recipes.name,
      methodKind: brewMethods.kind,
      grinder: {
        name: grinders.name,
        adjustment: grinders.adjustment,
        settingMin: grinders.settingMin,
        settingMax: grinders.settingMax,
        stepSize: grinders.stepSize,
        burrType: grinders.burrType,
        burrSizeMm: grinders.burrSizeMm,
        power: grinders.power,
      },
      machine: {
        name: machines.name,
        preinfusion: machines.preinfusion,
        flowControl: machines.flowControl,
        pressureControl: machines.pressureControl,
      },
    })
    .from(brewLogs)
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
    .leftJoin(grinders, eq(brewLogs.grinderId, grinders.id))
    .leftJoin(machines, eq(brewLogs.machineId, machines.id));
}

// Returns null if the brew log was deleted after the job was queued.
export async function loadBrewContext(brewLogId: string): Promise<BrewContext | null> {
  const [target] = await selectBrews().where(eq(brewLogs.id, brewLogId)).limit(1);
  if (!target) return null;
  const brew = withJoins(target);

  const [beanRow] = await db.select().from(beans).where(eq(beans.id, brew.beanId)).limit(1);
  if (!beanRow) return null; // Bean deletion cascades, so this means the log is going too.
  const bean: Bean = beanRow;

  const [previous, recipe, freezes] = await Promise.all([
    // "Previous" = earlier than the analyzed brew, newest first.
    selectBrews()
      .where(and(eq(brewLogs.beanId, brew.beanId), lt(brewLogs.timestamp, brew.timestamp), ne(brewLogs.id, brew.id)))
      .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
      .limit(PREVIOUS_BREW_COUNT),
    brew.recipeId ? loadRecipe(brew.recipeId) : Promise.resolve(null),
    db.select({ frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn }).from(beanFreezes).where(eq(beanFreezes.beanId, brew.beanId)),
  ]);

  const previousRows = previous.map(withJoins);
  const marks = await marksFor([brew.id, ...previousRows.map((p) => p.id)]);

  return {
    bean: {
      roasterName: bean.roasterName,
      beanName: bean.beanName,
      process: bean.process,
      roastLevel: bean.roastLevel,
      roastDate: bean.roastDate ? bean.roastDate.toISOString().slice(0, 10) : null,
    },
    recipe,
    brew: summarize(brew, bean.roastDate, freezes, marks),
    drink: brew.drinkId ? await loadDrink(brew.drinkId, { size: brew.servingSize, unit: brew.servingUnit }) : null,
    previousBrews: previousRows.map((p) => summarize(p, bean.roastDate, freezes, marks)),
    ratingScale: "1-5",
  };
}

async function loadRecipe(recipeId: string): Promise<BrewContext["recipe"]> {
  const [row] = await db
    .select({
      name: recipes.name,
      method: brewMethods.name,
      methodKind: brewMethods.kind,
      targetDoseGrams: recipes.targetDoseGrams,
      targetWaterGrams: recipes.targetWaterGrams,
      expectedYieldGrams: recipes.expectedYieldGrams,
      expectedFinishMinSec: recipes.expectedFinishMinSec,
      expectedFinishMaxSec: recipes.expectedFinishMaxSec,
      firstDropMinSec: recipes.firstDropMinSec,
      firstDropMaxSec: recipes.firstDropMaxSec,
      flowUnit: recipes.flowUnit,
      targetTempC: recipes.targetTempC,
    })
    .from(recipes)
    .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
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

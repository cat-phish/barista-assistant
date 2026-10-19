import {
  beanFreezes,
  beans,
  brewLogs,
  brewMethods,
  grinders,
  recipes,
  recipeSteps,
  type Bean,
  type BrewLog,
} from "@barista/shared/schema";
import { and, asc, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "./db.js";
import { effectiveRoastAge, type FreezePeriodLike } from "./roastAge.js";

const PREVIOUS_BREW_COUNT = 5;

// What the LLM sees about one brew (docs/api_spec.md §9).
export interface BrewSummary {
  timestamp: string;
  // Effective age on the brew's date: days since roasting minus days frozen.
  roastAgeDays: number | null;
  daysFrozenBeforeBrew: number | null;
  recipeName: string | null;
  // The grind setting only means something for this grinder (docs/api_spec.md §9).
  grinderName: string | null;
  actualDoseGrams: number;
  actualYieldGrams: number;
  brewRatio: number;
  actualTempC: number | null;
  actualGrindSetting: string | null;
  actualTimeSec: number;
  rating: number | null;
  tastingNotes: string | null;
}

export interface BrewContext {
  bean: { roasterName: string; beanName: string; process: string | null; roastDate: string | null };
  recipe: {
    name: string;
    method: string;
    targetDoseGrams: number;
    targetYieldGrams: number;
    targetTempC: number | null;
    targetGrindSetting: string | null;
    steps: Array<{ stepOrder: number; actionName: string; targetTimeSec: number; targetWaterGrams: number }>;
  } | null;
  brew: BrewSummary;
  previousBrews: BrewSummary[];
  ratingScale: "1-5";
}

type BrewRow = BrewLog & { recipeName: string | null; grinderName: string | null };

function summarize(brew: BrewRow, roastDate: Date | null, freezes: readonly FreezePeriodLike[]): BrewSummary {
  const age = roastDate
    ? effectiveRoastAge(roastDate.toISOString(), freezes, brew.timestamp.toISOString().slice(0, 10))
    : null;
  return {
    timestamp: brew.timestamp.toISOString(),
    roastAgeDays: age?.ageDays ?? null,
    daysFrozenBeforeBrew: age?.daysFrozen ?? null,
    recipeName: brew.recipeName,
    grinderName: brew.grinderName,
    actualDoseGrams: brew.actualDoseGrams,
    actualYieldGrams: brew.actualYieldGrams,
    brewRatio: Math.round((brew.actualYieldGrams / brew.actualDoseGrams) * 100) / 100,
    actualTempC: brew.actualTempC,
    actualGrindSetting: brew.actualGrindSetting,
    actualTimeSec: brew.actualTimeSec,
    rating: brew.rating,
    tastingNotes: brew.tastingNotes,
  };
}

function selectBrews() {
  return db
    .select({ brew: brewLogs, recipeName: recipes.name, grinderName: grinders.name })
    .from(brewLogs)
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(grinders, eq(brewLogs.grinderId, grinders.id));
}

// Returns null if the brew log was deleted after the job was queued.
export async function loadBrewContext(brewLogId: string): Promise<BrewContext | null> {
  const [target] = await selectBrews().where(eq(brewLogs.id, brewLogId)).limit(1);
  if (!target) return null;
  const brew: BrewRow = { ...target.brew, recipeName: target.recipeName, grinderName: target.grinderName };

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

  return {
    bean: {
      roasterName: bean.roasterName,
      beanName: bean.beanName,
      process: bean.process,
      roastDate: bean.roastDate ? bean.roastDate.toISOString().slice(0, 10) : null,
    },
    recipe,
    brew: summarize(brew, bean.roastDate, freezes),
    previousBrews: previous.map((p) => summarize({ ...p.brew, recipeName: p.recipeName, grinderName: p.grinderName }, bean.roastDate, freezes)),
    ratingScale: "1-5",
  };
}

async function loadRecipe(recipeId: string): Promise<BrewContext["recipe"]> {
  const [row] = await db
    .select({
      name: recipes.name,
      method: brewMethods.name,
      targetDoseGrams: recipes.targetDoseGrams,
      targetYieldGrams: recipes.targetYieldGrams,
      targetTempC: recipes.targetTempC,
      targetGrindSetting: recipes.targetGrindSetting,
    })
    .from(recipes)
    .innerJoin(brewMethods, eq(recipes.methodId, brewMethods.id))
    .where(eq(recipes.id, recipeId))
    .limit(1);
  if (!row) return null;

  const steps = await db
    .select({
      stepOrder: recipeSteps.stepOrder,
      actionName: recipeSteps.actionName,
      targetTimeSec: recipeSteps.targetTimeSec,
      targetWaterGrams: recipeSteps.targetWaterGrams,
    })
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipeId))
    .orderBy(asc(recipeSteps.stepOrder));

  return { ...row, steps };
}

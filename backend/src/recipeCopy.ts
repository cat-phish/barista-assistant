import type { RecipeCopy } from "@barista/shared/recipeCopy";
import { brewers, recipes, recipeSteps, recipeStyles } from "@barista/shared/schema";
import { asc, eq } from "drizzle-orm";
import type { db } from "./db.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A brew's copy of its recipe (docs/api/brew-logs.md §6, "Recipe copy"),
// taken when the brew is logged or its recipeId changes. The same fields the
// worker's loadRecipe reads (worker/src/context.ts), less the grind starting
// points, which the worker keeps reading live.
export async function recipeCopy(tx: Tx, recipeId: string | null | undefined): Promise<RecipeCopy | null> {
  if (!recipeId) return null;
  const [row] = await tx
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
      targetTempC: recipes.targetTempC,
      stepTempsFollowBrew: recipes.stepTempsFollowBrew,
      steepMinHours: recipes.steepMinHours,
      steepMaxHours: recipes.steepMaxHours,
      steepTemp: recipes.steepTemp,
      dilutionRatio: recipes.dilutionRatio,
      dilutionWith: recipes.dilutionWith,
      flowUnit: recipes.flowUnit,
      stepTimeScaling: recipes.stepTimeScaling,
    })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
    .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
    .where(eq(recipes.id, recipeId))
    .limit(1);
  if (!row) return null;
  const steps = await tx
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
      scalesWithBatch: recipeSteps.scalesWithBatch,
    })
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipeId))
    .orderBy(asc(recipeSteps.stepOrder));
  return { ...row, steps };
}

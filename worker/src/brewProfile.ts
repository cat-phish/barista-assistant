// Loads a barista's brew profile (docs/api/llm-contract.md §9, "Brew
// profile"): their rated brews in the workspace, reduced by
// @barista/shared/brewProfile. Worked out each time a job runs.
import { alias } from "drizzle-orm/mysql-core";
import { and, desc, eq, isNotNull, lt, ne } from "drizzle-orm";
import { beans, brewLogs, brewers, parameterSuggestions, recipes, recipeStyles } from "@barista/shared/schema";
import type { AiDetail } from "@barista/shared/aiDetails";
import { buildBrewProfile, PROFILE_MAX_BREWS, type BrewProfile, type ProfileFocus } from "@barista/shared/brewProfile";
import { extractionYield as sharedExtractionYield } from "@barista/shared/brew";
import { effectiveRoastAge } from "@barista/shared/roastAge";
import { db } from "./db.js";
import { loadBean, sameCoffeeIds } from "./context.js";
import { localBrewDate } from "./localDate.js";
import { workspaceZone } from "./zone.js";

export interface ProfileRequest {
  personId: string | null; // whose brews: the barista, or who asked
  workspaceId: string;
  beanId: string;
  focus: ProfileFocus;
  before?: Date; // only brews before this (an analysis, an eval)
  exceptBrewId?: string; // the brew being analyzed
}

const recipeBrewers = alias(brewers, "profile_recipe_brewer");

export async function loadBrewProfile(r: ProfileRequest, hidden: ReadonlySet<AiDetail>): Promise<BrewProfile | null> {
  if (!r.personId || hidden.has("brewProfile")) return null;
  const [rows, coffee, zone] = await Promise.all([
    db
      .select({
        id: brewLogs.id,
        beanId: brewLogs.beanId,
        timestamp: brewLogs.timestamp,
        utcOffsetMinutes: brewLogs.utcOffsetMinutes,
        rating: brewLogs.rating,
        brewerId: brewLogs.brewerId,
        recipeId: brewLogs.recipeId,
        recipeCopy: brewLogs.recipeCopy,
        tdsPercent: brewLogs.tdsPercent,
        actualDoseGrams: brewLogs.actualDoseGrams,
        actualWaterGrams: brewLogs.actualWaterGrams,
        actualIceGrams: brewLogs.actualIceGrams,
        actualYieldGrams: brewLogs.actualYieldGrams,
        actualTempC: brewLogs.actualTempC,
        actualTimeSec: brewLogs.actualTimeSec,
        suggestionRoute: brewLogs.suggestionRoute,
        routes: parameterSuggestions.routes,
        roastLevel: beans.roastLevel,
        kind: brewers.kind,
        recipeKind: recipeBrewers.kind,
        brewsLike: recipeStyles.brewsLike,
      })
      .from(brewLogs)
      .innerJoin(beans, eq(brewLogs.beanId, beans.id))
      .leftJoin(brewers, eq(brewLogs.brewerId, brewers.id))
      .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
      .leftJoin(recipeBrewers, eq(recipes.brewerId, recipeBrewers.id))
      .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
      .leftJoin(parameterSuggestions, eq(brewLogs.suggestionId, parameterSuggestions.id))
      .where(
        and(
          eq(brewLogs.workspaceId, r.workspaceId),
          eq(brewLogs.userId, r.personId),
          isNotNull(brewLogs.rating),
          eq(brewLogs.steeping, false),
          r.before ? lt(brewLogs.timestamp, r.before) : undefined,
          r.exceptBrewId ? ne(brewLogs.id, r.exceptBrewId) : undefined,
        ),
      )
      .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
      .limit(PROFILE_MAX_BREWS),
    sameCoffeeIds(r.beanId),
    workspaceZone(r.workspaceId),
  ]);
  const bags = new Map((await Promise.all(coffee.map(loadBean))).flatMap((b, i) => (b ? [[coffee[i]!, b] as const] : [])));

  const brews = rows.map((b) => {
    const bag = bags.get(b.beanId);
    const age = bag?.roastDate ? effectiveRoastAge(bag.roastDate.toISOString(), bag.freezes, localBrewDate(b.timestamp, b.utcOffsetMinutes, zone)) : null;
    const brewsLike = b.brewsLike ?? b.recipeCopy?.style?.brewsLike ?? null;
    return {
      timestamp: b.timestamp.toISOString(),
      rating: b.rating!,
      methodKind: b.kind ?? b.recipeKind,
      brewerId: b.brewerId,
      recipeId: b.recipeId,
      roastLevel: b.roastLevel,
      sameCoffee: bags.has(b.beanId),
      roastAgeDays: age?.ageDays ?? null,
      tdsPercent: b.tdsPercent,
      extractionYieldPercent: sharedExtractionYield({ ...b, brewsLike }),
      tempC: b.actualTempC,
      doseGrams: b.actualDoseGrams,
      timeSec: b.actualTimeSec,
      routeLabel: b.suggestionRoute === null ? null : (b.routes?.[b.suggestionRoute]?.label ?? null),
    };
  });
  const focus = hidden.has("roastLevel") ? { ...r.focus, roastLevel: null } : r.focus;
  return buildBrewProfile(brews, focus);
}

// What "Suggest parameters" sends (docs/api/analysis.md §8b,
// docs/api/llm-contract.md §9b): the brew about to be made (bean, recipe,
// brewer, grinder) and up to maxBrews earlier brews from the chosen source,
// newest first, each with its latest analysis.
import {
  beans,
  brewers,
  brewLogs,
  grinders,
  llmAnalyses,
  recipes,
  recipeStyles,
  type AlternativeKind,
  type Brewer,
  type MethodKind,
  type ParameterSuggestion,
  type SuggestSource,
} from "@barista/shared/schema";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { config } from "./config.js";
import {
  drinksServed,
  loadBean,
  loadRecipe,
  marksFor,
  problemsFor,
  scaledToBrew,
  selectBrews,
  summarize,
  toolsFor,
  withJoins,
  type BrewContext,
  type BrewSummary,
  type GrinderInfo,
  type LoadedBean,
  type StyleInfo,
} from "./context.js";
import { db } from "./db.js";
import { localBrewDate } from "./localDate.js";
import { effectiveRoastAge } from "./roastAge.js";

// The brewer chosen; the controls only matter for an espresso machine.
export type BrewerInfo = Pick<Brewer, "name" | "kind" | "preinfusion" | "flowControl" | "pressureControl">;

// The advice given after an earlier brew: a later brew shows whether it helped.
export interface PastAnalysis {
  reasoning: string;
  nextStep: string | null;
  confidence: string | null;
  suggestedGrindDelta: string;
  suggestedTempDelta: number;
  suggestedRpmDelta: number | null;
  suggestedDoseDelta: number | null;
  suggestedYieldDelta: number | null;
  helpful: boolean | null; // the barista's 👍 / 👎
}

export interface SuggestBrew extends BrewSummary {
  sameBag: boolean; // this exact bean
  sameBean: boolean; // this coffee (roaster and name), any bag
  sameRecipe: boolean;
  sameGrinder: boolean;
  bean: BrewContext["bean"] | null; // another bag's or bean's brew: which one; null for this bag
  analysis: PastAnalysis | null;
}

// The batch about to be brewed: the barista's choice, which the AI keeps
// (it suggests a ratio). Filter: dose, hot water and ice; espresso: dose and
// shot weight. ratio is (water + ice) / dose, or shot weight / dose.
export interface SuggestBatch {
  doseGrams: number | null;
  waterGrams: number | null;
  iceGrams: number | null;
  yieldGrams: number | null;
  ratio: number | null;
}

// What else it may suggest (the kinds asked): the workspace's active
// recipes and brewers other than this one, and its other beans with weight
// left. ref is what the AI answers with ("r1"); id is matched back from it
// and not sent.
export interface RecipeOption {
  ref: string;
  id: string;
  name: string;
  brewer: string;
  methodKind: MethodKind;
  style: StyleInfo | null;
  targetDoseGrams: number;
  targetWaterGrams: number | null;
  targetIceGrams: number | null;
  expectedYieldGrams: number | null;
  targetTempC: number | null;
}
export interface BrewerOption {
  ref: string;
  id: string;
  name: string;
  kind: MethodKind;
}
export interface BeanOption {
  ref: string;
  id: string;
  bean: BrewContext["bean"];
  roastAgeDays: number | null; // today, as for this bean
  gramsLeft: number;
}
export interface SuggestOptions {
  recipes?: RecipeOption[];
  brewers?: BrewerOption[];
  beans?: BeanOption[];
}
// At most this many of each kind, so a big workspace stays affordable.
export const MAX_OPTIONS = 30;

export interface SuggestContext {
  source: SuggestSource;
  batch: SuggestBatch;
  bean: BrewContext["bean"];
  // The bean's effective age today (days since roasting minus days frozen).
  roastAgeDays: number | null;
  daysFrozen: number | null;
  recipe: BrewContext["recipe"];
  brewer: BrewerInfo | null;
  grinder: GrinderInfo | null;
  brews: SuggestBrew[];
  options: SuggestOptions; // empty when no alternatives were asked for
  ratingScale: "0.5-5";
}

export type SuggestRequest = Pick<
  ParameterSuggestion,
  "beanId" | "recipeId" | "brewerId" | "grinderId" | "source" | "maxBrews" | "batchDoseGrams" | "batchWaterGrams" | "batchIceGrams" | "batchYieldGrams" | "alternativesAsked"
>;

// The batch asked with, else (none sent) the recipe's targets.
function batchFor(r: SuggestRequest, recipe: BrewContext["recipe"], espresso: boolean): SuggestBatch {
  const asked = [r.batchDoseGrams, r.batchWaterGrams, r.batchIceGrams, r.batchYieldGrams].some((x) => x !== null);
  const dose = asked ? r.batchDoseGrams : (recipe?.targetDoseGrams ?? null);
  const water = espresso ? null : asked ? r.batchWaterGrams : (recipe?.targetWaterGrams ?? null);
  const ice = espresso ? null : asked ? r.batchIceGrams : (recipe?.targetIceGrams ?? null);
  const shot = !espresso ? null : asked ? r.batchYieldGrams : (recipe?.expectedYieldGrams ?? null);
  const out = espresso ? shot : water === null ? null : water + (ice ?? 0);
  return {
    doseGrams: dose,
    waterGrams: water,
    iceGrams: ice,
    yieldGrams: shot,
    ratio: dose && out ? Math.round((out / dose) * 100) / 100 : null,
  };
}

// The workspace's bags of this bean's coffee: the same roaster and name,
// ignoring case and spaces at the ends (as the brew page's repeat does).
async function sameCoffeeIds(beanId: string): Promise<string[]> {
  const [b] = await db.select({ workspaceId: beans.workspaceId, roasterName: beans.roasterName, beanName: beans.beanName }).from(beans).where(eq(beans.id, beanId));
  if (!b) return [beanId];
  const rows = await db
    .select({ id: beans.id })
    .from(beans)
    .where(
      and(
        eq(beans.workspaceId, b.workspaceId),
        sql`LOWER(TRIM(${beans.roasterName})) = ${b.roasterName.trim().toLowerCase()}`,
        sql`LOWER(TRIM(${beans.beanName})) = ${b.beanName.trim().toLowerCase()}`,
      ),
    );
  return rows.map((x) => x.id);
}

// Which earlier brews each source picks, or null when it can't (its recipe
// or brewer was deleted since): then no brews are sent. coffee: the bags of
// this bean's coffee (sameCoffeeIds).
function sourceFilter(r: SuggestRequest, coffee: readonly string[]): SQL | null {
  const bag = eq(brewLogs.beanId, r.beanId);
  const bean = inArray(brewLogs.beanId, [...coffee]);
  const recipe = r.recipeId ? eq(brewLogs.recipeId, r.recipeId) : null;
  const brewer = r.brewerId ? eq(brewLogs.brewerId, r.brewerId) : null;
  switch (r.source) {
    case "bag":
      return bag;
    case "bagRecipe":
      return recipe && and(bag, recipe)!;
    case "bagBrewer":
      return brewer && and(bag, brewer)!;
    case "bean":
      return bean;
    case "beanRecipe":
      return recipe && and(bean, recipe)!;
    case "beanBrewer":
      return brewer && and(bean, brewer)!;
    case "brewer":
      return brewer;
    case "recipe":
      return recipe;
  }
}

// Each brew's latest analysis.
async function latestAnalyses(brewLogIds: string[]): Promise<Map<string, PastAnalysis>> {
  if (brewLogIds.length === 0) return new Map();
  const { request: _sent, ...columns } = getTableColumns(llmAnalyses); // what was sent isn't needed
  const rows = await db.select(columns).from(llmAnalyses).where(inArray(llmAnalyses.brewLogId, brewLogIds)).orderBy(desc(llmAnalyses.createdAt), desc(llmAnalyses.id));
  const byLog = new Map<string, PastAnalysis>();
  for (const a of rows) {
    if (byLog.has(a.brewLogId)) continue;
    byLog.set(a.brewLogId, {
      reasoning: a.reasoning,
      nextStep: a.nextStep,
      confidence: a.confidence,
      suggestedGrindDelta: a.suggestedGrindDelta,
      suggestedTempDelta: a.suggestedTempDelta,
      suggestedRpmDelta: a.suggestedRpmDelta,
      suggestedDoseDelta: a.suggestedDoseDelta,
      suggestedYieldDelta: a.suggestedYieldDelta,
      helpful: a.helpful,
    });
  }
  return byLog;
}

// The other recipes, brewers and beans the AI may suggest, for the kinds asked.
async function loadOptions(r: SuggestRequest, workspaceId: string, kinds: readonly AlternativeKind[], today: string): Promise<SuggestOptions> {
  const options: SuggestOptions = {};
  if (kinds.includes("recipe")) {
    const rows = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        brewer: brewers.name,
        methodKind: brewers.kind,
        style: { name: recipeStyles.name, brewsLike: recipeStyles.brewsLike },
        targetDoseGrams: recipes.targetDoseGrams,
        targetWaterGrams: recipes.targetWaterGrams,
        targetIceGrams: recipes.targetIceGrams,
        expectedYieldGrams: recipes.expectedYieldGrams,
        targetTempC: recipes.targetTempC,
      })
      .from(recipes)
      .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
      .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
      .where(and(eq(recipes.workspaceId, workspaceId), isNull(recipes.archivedAt), isNull(brewers.archivedAt), r.recipeId ? ne(recipes.id, r.recipeId) : undefined))
      .orderBy(asc(brewers.name), asc(recipes.name))
      .limit(MAX_OPTIONS);
    options.recipes = rows.map((x, i) => ({ ref: `r${i + 1}`, ...x, style: x.style?.name ? x.style : null }));
  }
  if (kinds.includes("brewer")) {
    // Only brewers with a recipe to brew with.
    const rows = await db
      .selectDistinct({ id: brewers.id, name: brewers.name, kind: brewers.kind })
      .from(brewers)
      .innerJoin(recipes, and(eq(recipes.brewerId, brewers.id), isNull(recipes.archivedAt)))
      .where(and(eq(brewers.workspaceId, workspaceId), isNull(brewers.archivedAt), r.brewerId ? ne(brewers.id, r.brewerId) : undefined))
      .orderBy(asc(brewers.name))
      .limit(MAX_OPTIONS);
    options.brewers = rows.map((x, i) => ({ ref: `b${i + 1}`, ...x }));
  }
  if (kinds.includes("bean")) {
    const rows = await db
      .select({ id: beans.id, gramsLeft: beans.inventoryWeightGrams })
      .from(beans)
      .where(and(eq(beans.workspaceId, workspaceId), isNull(beans.archivedAt), gt(beans.inventoryWeightGrams, 0), ne(beans.id, r.beanId)))
      .orderBy(desc(beans.roastDate), asc(beans.id))
      .limit(MAX_OPTIONS);
    const loaded = await Promise.all(rows.map((x) => loadBean(x.id)));
    options.beans = rows.flatMap((x, i) => {
      const b = loaded[i];
      if (!b) return [];
      const age = b.roastDate ? effectiveRoastAge(b.roastDate.toISOString(), b.freezes, today) : null;
      return [{ ref: `n${i + 1}`, id: x.id, bean: b.info, roastAgeDays: age?.ageDays ?? null, gramsLeft: x.gramsLeft }];
    });
  }
  return options;
}

// options.ratedOnly: leave out brews without a rating (aiHidden
// "unratedHistory"). options.before: only brews before then (npm run eval
// rebuilds a past brew's suggestion).
export async function loadSuggestContext(r: SuggestRequest, options: { ratedOnly?: boolean; before?: Date } = {}): Promise<SuggestContext | null> {
  const target = await loadBean(r.beanId);
  if (!target) return null; // the bean was deleted: so is the suggestion

  const coffee = await sameCoffeeIds(r.beanId);
  const filter = sourceFilter(r, coffee);
  const [recipe, brewer, grinder, rows] = await Promise.all([
    r.recipeId ? loadRecipe(r.recipeId) : Promise.resolve(null),
    r.brewerId
      ? db
          .select({ name: brewers.name, kind: brewers.kind, preinfusion: brewers.preinfusion, flowControl: brewers.flowControl, pressureControl: brewers.pressureControl })
          .from(brewers)
          .where(eq(brewers.id, r.brewerId))
          .then((x) => x[0] ?? null)
      : Promise.resolve(null),
    r.grinderId
      ? db
          .select({
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
          })
          .from(grinders)
          .where(eq(grinders.id, r.grinderId))
          .then((x) => x[0] ?? null)
      : Promise.resolve(null),
    filter
      ? selectBrews()
          .where(
            and(
              filter,
              eq(brewLogs.steeping, false), // a cold brew still steeping has no result yet
              options.ratedOnly ? or(isNotNull(brewLogs.rating), isNotNull(brewLogs.drinkRating)) : undefined,
              options.before ? lt(brewLogs.timestamp, options.before) : undefined,
            ),
          )
          .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
          .limit(r.maxBrews)
      : Promise.resolve([]),
  ]);

  const brewRows = rows.map(withJoins);
  const ids = brewRows.map((b) => b.id);
  const otherBeanIds = [...new Set(brewRows.map((b) => b.beanId).filter((id) => id !== r.beanId))];
  const [marks, tools, problems, servedAs, analyses, ...others] = await Promise.all([
    marksFor(ids),
    toolsFor(ids),
    problemsFor(ids),
    drinksServed(brewRows.flatMap((b) => (b.drinkId ? [b.drinkId] : []))),
    latestAnalyses(ids),
    ...otherBeanIds.map(loadBean),
  ]);
  const beansById = new Map<string, LoadedBean>([[r.beanId, target]]);
  otherBeanIds.forEach((id, i) => {
    const b = others[i];
    if (b) beansById.set(id, b);
  });

  const today = localBrewDate(options.before ?? new Date(), null, config.brewTimezone);
  const age = target.roastDate ? effectiveRoastAge(target.roastDate.toISOString(), target.freezes, today) : null;
  const kinds = r.alternativesAsked ?? [];
  const [ws] = kinds.length ? await db.select({ workspaceId: beans.workspaceId }).from(beans).where(eq(beans.id, r.beanId)) : [];
  const alternatives = ws ? await loadOptions(r, ws.workspaceId, kinds, today) : {};
  const batch = batchFor(r, recipe, (recipe?.methodKind ?? brewer?.kind) === "espresso");
  return {
    source: r.source,
    batch,
    bean: target.info,
    roastAgeDays: age?.ageDays ?? null,
    daysFrozen: age?.daysFrozen ?? null,
    // Step times for the batch asked with, as the brew page will time it.
    recipe: recipe && scaledToBrew(recipe, batch.waterGrams),
    brewer,
    grinder,
    brews: brewRows.map((b) => {
      const bean = beansById.get(b.beanId);
      return {
        ...summarize(b, bean?.roastDate ?? null, bean?.freezes ?? [], marks, tools, problems, servedAs),
        sameBag: b.beanId === r.beanId,
        sameBean: coffee.includes(b.beanId),
        sameRecipe: r.recipeId !== null && b.recipeId === r.recipeId,
        sameGrinder: r.grinderId !== null && b.grinderId === r.grinderId,
        bean: b.beanId === r.beanId ? null : (bean?.info ?? null),
        analysis: analyses.get(b.id) ?? null,
      };
    }),
    options: alternatives,
    ratingScale: "0.5-5",
  };
}

// What "Suggest parameters" sends (docs/api/analysis.md §8b,
// docs/api/llm-contract.md §9b): the brew about to be made (bean, recipe,
// brewer, grinder) and up to maxBrews earlier brews from the chosen source,
// newest first, each with its latest analysis.
import { brewers, brewLogs, grinders, llmAnalyses, type Brewer, type ParameterSuggestion, type SuggestSource } from "@barista/shared/schema";
import { and, desc, eq, getTableColumns, inArray, isNotNull, lt, or, type SQL } from "drizzle-orm";
import { config } from "./config.js";
import {
  drinksServed,
  loadBean,
  loadRecipe,
  marksFor,
  problemsFor,
  selectBrews,
  summarize,
  toolsFor,
  withJoins,
  type BrewContext,
  type BrewSummary,
  type GrinderInfo,
  type LoadedBean,
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
  sameBean: boolean;
  sameRecipe: boolean;
  sameGrinder: boolean;
  bean: BrewContext["bean"] | null; // another bean's brew: which bean; null for this bean
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
  ratingScale: "1-5";
}

export type SuggestRequest = Pick<
  ParameterSuggestion,
  "beanId" | "recipeId" | "brewerId" | "grinderId" | "source" | "maxBrews" | "batchDoseGrams" | "batchWaterGrams" | "batchIceGrams" | "batchYieldGrams"
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

// Which earlier brews each source picks, or null when it can't (its recipe
// or brewer was deleted since): then no brews are sent.
function sourceFilter(r: SuggestRequest): SQL | null {
  const bean = eq(brewLogs.beanId, r.beanId);
  const recipe = r.recipeId ? eq(brewLogs.recipeId, r.recipeId) : null;
  const brewer = r.brewerId ? eq(brewLogs.brewerId, r.brewerId) : null;
  switch (r.source) {
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

// options.ratedOnly: leave out brews without a rating (aiHidden
// "unratedHistory"). options.before: only brews before then (npm run eval
// rebuilds a past brew's suggestion).
export async function loadSuggestContext(r: SuggestRequest, options: { ratedOnly?: boolean; before?: Date } = {}): Promise<SuggestContext | null> {
  const target = await loadBean(r.beanId);
  if (!target) return null; // the bean was deleted: so is the suggestion

  const filter = sourceFilter(r);
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

  const age = target.roastDate
    ? effectiveRoastAge(target.roastDate.toISOString(), target.freezes, localBrewDate(options.before ?? new Date(), null, config.brewTimezone))
    : null;
  return {
    source: r.source,
    batch: batchFor(r, recipe, (recipe?.methodKind ?? brewer?.kind) === "espresso"),
    bean: target.info,
    roastAgeDays: age?.ageDays ?? null,
    daysFrozen: age?.daysFrozen ?? null,
    recipe,
    brewer,
    grinder,
    brews: brewRows.map((b) => {
      const bean = beansById.get(b.beanId);
      return {
        ...summarize(b, bean?.roastDate ?? null, bean?.freezes ?? [], marks, tools, problems, servedAs),
        sameBean: b.beanId === r.beanId,
        sameRecipe: r.recipeId !== null && b.recipeId === r.recipeId,
        sameGrinder: r.grinderId !== null && b.grinderId === r.grinderId,
        bean: b.beanId === r.beanId ? null : (bean?.info ?? null),
        analysis: analyses.get(b.id) ?? null,
      };
    }),
    ratingScale: "1-5",
  };
}

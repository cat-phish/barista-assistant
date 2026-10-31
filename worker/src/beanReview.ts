// What a draft of a bean's Review sends (docs/api/analysis.md §8e,
// docs/api/llm-contract.md §9d): the bean, and up to maxBrews of this bag's
// finished brews, newest first.
import type { BeanReviewJobData } from "@barista/shared/jobs";
import { brewers, brewLogs } from "@barista/shared/schema";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { drinksServed, flavorsFor, loadBean, marksFor, problemsFor, selectBrews, summarize, toolsFor, withJoins, type BrewContext, type BrewSummary } from "./context.js";
import { db } from "./db.js";

export interface ReviewBrew extends BrewSummary {
  brewer: string | null; // its name
}
export interface BeanReviewContext {
  bean: BrewContext["bean"];
  brews: ReviewBrew[];
  ratingScale: "0.5-5";
}

// null when the bean is gone or no brews match: nothing to review.
export async function loadBeanReviewContext(r: Pick<BeanReviewJobData, "beanId" | "brewerIds" | "maxBrews" | "ratedOnly">): Promise<BeanReviewContext | null> {
  const bean = await loadBean(r.beanId);
  if (!bean) return null;
  const rows = await selectBrews()
    .where(
      and(
        eq(brewLogs.beanId, r.beanId),
        eq(brewLogs.steeping, false), // a cold brew still steeping has no result yet
        r.brewerIds ? inArray(brewLogs.brewerId, r.brewerIds) : undefined,
        r.ratedOnly ? or(isNotNull(brewLogs.rating), isNotNull(brewLogs.drinkRating)) : undefined,
      ),
    )
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
    .limit(r.maxBrews);
  if (rows.length === 0) return null;

  const brewRows = rows.map(withJoins);
  const ids = brewRows.map((b) => b.id);
  const brewerIds = [...new Set(brewRows.flatMap((b) => (b.brewerId ? [b.brewerId] : [])))];
  const [marks, tools, problems, flavors, servedAs, names] = await Promise.all([
    marksFor(ids),
    toolsFor(ids),
    problemsFor(ids),
    flavorsFor(ids),
    drinksServed(brewRows.flatMap((b) => (b.drinkId ? [b.drinkId] : []))),
    brewerIds.length ? db.select({ id: brewers.id, name: brewers.name }).from(brewers).where(inArray(brewers.id, brewerIds)) : Promise.resolve([]),
  ]);
  const brewerName = new Map(names.map((b) => [b.id, b.name]));
  return {
    bean: bean.info,
    brews: brewRows.map((b) => ({
      ...summarize(b, bean.roastDate, bean.freezes, marks, tools, problems, flavors, servedAs),
      brewer: (b.brewerId && brewerName.get(b.brewerId)) ?? null,
    })),
    ratingScale: "0.5-5",
  };
}

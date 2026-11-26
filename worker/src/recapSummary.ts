import type { RecapSummaryJobData } from "@barista/shared/jobs";
import { periodOf, previousPeriod } from "@barista/shared/recapPeriods";
import { userPreferences, DEFAULT_WORKSPACE_SETTINGS, recaps, users, withDefaults, workspaces } from "@barista/shared/schema";
import { isCustomPrompt } from "@barista/shared/aiPrompt";
import { yearInCoffeePeriod, type YearFigures } from "@barista/shared/yearInCoffee";
import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { resolveAi } from "./ai/resolve.js";
import { db } from "./db.js";
import { requestRecapSummary } from "./llm.js";
import { loadPeriodContext, type YearHighlights } from "./periodContext.js";
import { promptFor } from "./processor.js";
import { RECAP_PROMPT_VERSION } from "./prompt.js";

// A recap's (or Your Year in Coffee's) AI summary (docs/api/llm-contract.md §9f, docs/api/recaps.md
// §11c): the period of the row's person (scope "mine") or everyone's in its
// workspace ("all"), with the workspace's hidden details left out and the
// person's own instructions added. Saved on the row; throwing makes BullMQ
// retry, and failRecapSummary records the last error.

export type RecapSummaryResult = { status: "saved"; id: string } | { status: "skipped"; reason: string };

export async function writeRecapSummary({ recapId }: RecapSummaryJobData): Promise<RecapSummaryResult> {
  const [row] = await db
    .select({ recap: recaps, settings: workspaces.settings, preferences: users.preferences })
    .from(recaps)
    .innerJoin(workspaces, eq(workspaces.id, recaps.workspaceId))
    .innerJoin(users, eq(users.id, recaps.userId))
    .where(eq(recaps.id, recapId));
  if (!row) return { status: "skipped", reason: "recap no longer exists" };
  const { recap } = row;
  const prefs = userPreferences(row.preferences ?? null);
  const hidden = new Set(withDefaults(DEFAULT_WORKSPACE_SETTINGS, row.settings ?? null).aiHidden);
  // Your Year in Coffee: 1 January–6 December against the same dates a year
  // before, with the highlights of its frozen copy when it has one.
  const yearInCoffee = recap.kind === "yearInCoffee";
  const year = Number(recap.periodStart.slice(0, 4));
  const period = recap.kind === "yearInCoffee" ? yearInCoffeePeriod(year) : periodOf(recap.kind, recap.periodStart, prefs.weekStartsOn);
  const context = await loadPeriodContext({
    workspaceId: recap.workspaceId,
    userId: recap.scope === "mine" ? recap.userId : null,
    kind: recap.kind,
    period,
    previous: recap.kind === "yearInCoffee" ? yearInCoffeePeriod(year - 1) : previousPeriod(recap.kind, period, prefs.weekStartsOn),
  });
  if (yearInCoffee && recap.figures) context.yearHighlights = yearHighlights(recap.figures.figures);
  // A year also gets its months' written summaries, same scope (llm-contract.md §9f);
  // Your Year in Coffee only the months it covers whole (January to November).
  if (recap.kind === "yearly" || yearInCoffee) {
    const monthly = await db
      .select({ periodStart: recaps.periodStart, summary: recaps.summary, highlights: recaps.highlights })
      .from(recaps)
      .where(
        and(
          eq(recaps.workspaceId, recap.workspaceId),
          eq(recaps.userId, recap.userId),
          eq(recaps.scope, recap.scope),
          eq(recaps.kind, "monthly"),
          eq(recaps.status, "done"),
          gte(recaps.periodStart, period.start),
          yearInCoffee ? lt(recaps.periodStart, `${year}-12-01`) : lte(recaps.periodStart, period.end),
        ),
      )
      .orderBy(asc(recaps.periodStart));
    const written = monthly.flatMap((m) => (m.summary ? [{ month: m.periodStart.slice(0, 7), summary: m.summary, highlights: m.highlights ?? [] }] : []));
    if (written.length) context.monthlySummaries = written;
  }
  if (context.figures.brews === 0) {
    await db.update(recaps).set({ status: "failed", error: "No brews in this period", updatedAt: new Date() }).where(eq(recaps.id, recapId));
    return { status: "skipped", reason: "no brews" };
  }
  const custom = await promptFor(recap.userId, null);
  const ai = await resolveAi(recap.workspaceId, "writing");
  const { summary, usage } = await requestRecapSummary(ai, context, hidden, custom);
  await db
    .update(recaps)
    .set({
      status: "done",
      summary: summary.summary,
      highlights: summary.highlights,
      error: null,
      model: ai.models.main,
      promptVersion: isCustomPrompt(custom.prompt, null) ? `${RECAP_PROMPT_VERSION}+custom` : RECAP_PROMPT_VERSION,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      updatedAt: new Date(),
    })
    .where(eq(recaps.id, recapId));
  return { status: "saved", id: recapId };
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TOP = 5;
// The frozen figures as the AI gets them (periodContext.ts YearHighlights): names, no people.
export function yearHighlights(f: YearFigures): YearHighlights {
  return {
    longestStreak: f.streak ?? null,
    busiestMonth: f.busiestMonth ? { month: `${f.year}-${String(f.busiestMonth.month + 1).padStart(2, "0")}`, brews: f.busiestMonth.brews } : null,
    busiestWeekday: f.busiestWeekday ? { weekday: WEEKDAYS[f.busiestWeekday.weekday] ?? "", brews: f.busiestWeekday.brews } : null,
    favouriteHour: f.favouriteHour ?? null,
    origins: (f.origins ?? []).slice(0, TOP),
    roasters: (f.roasters ?? []).slice(0, TOP),
    processes: (f.processes ?? []).slice(0, TOP),
    varieties: (f.varieties ?? []).slice(0, TOP),
    flavors: (f.flavors ?? []).slice(0, TOP),
    mostImproved: f.mostImproved ?? null,
  };
}

// Every attempt failed: the recap shows why, with Try again.
export async function failRecapSummary(recapId: string, error: string): Promise<void> {
  await db.update(recaps).set({ status: "failed", error, updatedAt: new Date() }).where(eq(recaps.id, recapId));
}

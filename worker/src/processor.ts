import { randomUUID } from "node:crypto";
import type { AiPreviewJobData, BeanReviewJobData, BeanReviewResult, BrewAnalysisJobData, ParameterSuggestionJobData } from "@barista/shared/jobs";
import { EMPTY_AI_PROMPT, isCustomPrompt } from "@barista/shared/aiPrompt";
import { analysisRequests, beans, brewLogs, DEFAULT_WORKSPACE_SETTINGS, llmAnalyses, parameterSuggestions, users, withDefaults, workspaces, type AiRequest, type WorkspaceSettings } from "@barista/shared/schema";
import type { AiDetail } from "@barista/shared/aiDetails";
import { and, count, eq, gte } from "drizzle-orm";
import { loadBeanReviewContext } from "./beanReview.js";
import { loadBrewContext } from "./context.js";
import { db } from "./db.js";
import { config } from "./config.js";
import { analysisSent, analyzeWithLlm, beanReviewSent, PROMPT_VERSION, requestBeanReview, requestSuggestion, suggestionSent } from "./llm.js";
import type { PromptCustom } from "./prompt.js";
import { loadSuggestContext } from "./suggestContext.js";

// The brew's workspace and its settings: what it keeps from the AI
// (Settings → AI, docs/api/llm-contract.md §9 "What the AI sees") and
// auto-analyze (docs/api/analysis.md §8).
// baristaId: who made the brew, whose AI prompt its analysis uses.
async function workspaceOf(brewLogId: string): Promise<{ workspaceId: string; settings: WorkspaceSettings; baristaId: string | null } | null> {
  const [row] = await db
    .select({ workspaceId: workspaces.id, settings: workspaces.settings, baristaId: brewLogs.userId })
    .from(brewLogs)
    .innerJoin(workspaces, eq(brewLogs.workspaceId, workspaces.id))
    .where(eq(brewLogs.id, brewLogId));
  return row ? { workspaceId: row.workspaceId, settings: withDefaults(DEFAULT_WORKSPACE_SETTINGS, row.settings ?? null), baristaId: row.baristaId } : null;
}

// A person's own AI prompt (docs/api/auth.md §1c), with a one-off note: an
// analysis uses its brew's barista's, a suggestion the asker's. Nobody (a
// deleted account) means the defaults.
export async function promptFor(userId: string | null, note: string | null | undefined): Promise<PromptCustom> {
  const [row] = userId ? await db.select({ aiPrompt: users.aiPrompt }).from(users).where(eq(users.id, userId)) : [];
  return { prompt: row?.aiPrompt ?? EMPTY_AI_PROMPT, note: note || null };
}
// Saved with the result, so a customized prompt's results can be told apart.
const versionFor = (custom: PromptCustom): string => (isCustomPrompt(custom.prompt, custom.note) ? `${PROMPT_VERSION}+custom` : PROMPT_VERSION);

// Automatic analyses the workspace made in the last 24 hours (the daily cap).
async function autoAnalysesToday(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(llmAnalyses)
    .innerJoin(brewLogs, eq(llmAnalyses.brewLogId, brewLogs.id))
    .where(and(eq(brewLogs.workspaceId, workspaceId), eq(llmAnalyses.auto, true), gte(llmAnalyses.createdAt, new Date(Date.now() - 24 * 3600_000))));
  return row?.n ?? 0;
}

// Where the brew's analysis stands (analysis_requests): nothing pending, or
// why it wasn't made, shown with "Try again". A deleted brew has no row to
// keep (the insert's FK fails), which is fine.
export async function settleRequest(brewLogId: string, error: string | null): Promise<void> {
  if (error === null) {
    await db.delete(analysisRequests).where(eq(analysisRequests.brewLogId, brewLogId));
    return;
  }
  await db
    .insert(analysisRequests)
    .values({ brewLogId, dueAt: null, error })
    .onDuplicateKeyUpdate({ set: { dueAt: null, error, updatedAt: new Date() } })
    .catch(() => undefined);
}

export const CAP_REACHED = "Not analyzed automatically: the workspace's daily limit was reached";

// id: the analysis or suggestion saved.
export type JobResult = { status: "saved"; id: string } | { status: "skipped"; reason: string };

// One brew-analysis job. Throwing makes BullMQ retry (docs/api/llm-contract.md §9).
export async function processBrewAnalysis({ brewLogId, auto = false, note }: BrewAnalysisJobData): Promise<JobResult> {
  const context = await loadBrewContext(brewLogId);
  if (!context) {
    // Deleted after queueing: nothing to analyze, and retrying won't change that.
    return { status: "skipped", reason: "brew log no longer exists" };
  }
  // A cold brew still steeping has nothing to judge (the API refuses to queue
  // one; this covers a job queued just before it was started over).
  if (context.brew.steeping) {
    await settleRequest(brewLogId, null);
    return { status: "skipped", reason: "still steeping" };
  }

  const ws = await workspaceOf(brewLogId);
  const settings = ws?.settings ?? DEFAULT_WORKSPACE_SETTINGS;
  const hidden = new Set(settings.aiHidden);
  // The workspace only analyzes rated brews (the API refuses to queue an
  // unrated one; this covers a job queued before the switch).
  if (hidden.has("analyzeUnrated") && context.brew.rating === null && context.brew.drinkRating === null) {
    await settleRequest(brewLogId, null);
    return { status: "skipped", reason: "unrated brews aren't analyzed" };
  }
  if (auto) {
    // Turned off while it waited: as if never queued.
    if (!settings.autoAnalyze) {
      await settleRequest(brewLogId, null);
      return { status: "skipped", reason: "auto-analyze is off" };
    }
    const cap = settings.autoAnalyzeDailyCap;
    if (cap !== null && ws && (await autoAnalysesToday(ws.workspaceId)) >= cap) {
      await settleRequest(brewLogId, CAP_REACHED);
      return { status: "skipped", reason: "daily cap reached" };
    }
  }

  const custom = await promptFor(ws?.baristaId ?? null, note);
  const analysis = await analyzeWithLlm(context, hidden, custom);

  const analysisId = randomUUID();
  try {
    await db.insert(llmAnalyses).values({ id: analysisId, brewLogId, ...analysis, auto, model: config.openaiModel, promptVersion: versionFor(custom), request: analysisSent(context, hidden, custom) });
  } catch (err) {
    // The log may have been deleted while the LLM call was running (FK violation).
    if ((await loadBrewContext(brewLogId)) === null) {
      return { status: "skipped", reason: "brew log deleted during analysis" };
    }
    throw err;
  }
  await settleRequest(brewLogId, null);
  return { status: "saved", id: analysisId };
}

// One "Suggest parameters" request (docs/api/analysis.md §8b): the row says
// what for; the result goes back into it. Throwing makes BullMQ retry.
export async function processParameterSuggestion({ suggestionId }: ParameterSuggestionJobData): Promise<JobResult> {
  const [row] = await db
    .select({ suggestion: parameterSuggestions, settings: workspaces.settings })
    .from(parameterSuggestions)
    .innerJoin(beans, eq(parameterSuggestions.beanId, beans.id))
    .innerJoin(workspaces, eq(beans.workspaceId, workspaces.id))
    .where(eq(parameterSuggestions.id, suggestionId));
  if (!row) return { status: "skipped", reason: "suggestion no longer exists" };
  if (row.suggestion.status !== "pending") return { status: "skipped", reason: `already ${row.suggestion.status}` };

  const hidden = new Set(withDefaults(DEFAULT_WORKSPACE_SETTINGS, row.settings ?? null).aiHidden);
  const context = await loadSuggestContext(row.suggestion, { ratedOnly: hidden.has("unratedHistory") });
  if (!context) return { status: "skipped", reason: "bean no longer exists" };

  const custom = await promptFor(row.suggestion.requestedBy, row.suggestion.note);
  const { suggestion } = await requestSuggestion(context, hidden, custom);
  await db
    .update(parameterSuggestions)
    .set({
      ...suggestion,
      status: "done",
      brewCount: context.brews.length,
      model: config.openaiModel,
      promptVersion: versionFor(custom),
      request: suggestionSent(context, hidden, custom),
      completedAt: new Date(),
    })
    .where(eq(parameterSuggestions.id, suggestionId));
  return { status: "saved", id: suggestionId };
}

// What the bean's workspace keeps from the AI; null when the bean is gone.
async function hiddenFor(beanId: string): Promise<Set<AiDetail> | null> {
  const [row] = await db.select({ settings: workspaces.settings }).from(beans).innerJoin(workspaces, eq(beans.workspaceId, workspaces.id)).where(eq(beans.id, beanId));
  return row ? new Set(withDefaults(DEFAULT_WORKSPACE_SETTINGS, row.settings ?? null).aiHidden) : null;
}

// A draft of a bean's Review (docs/api/analysis.md §8e): the answer goes back
// to the waiting request, nothing is stored. null: the bean is gone or no
// brews match. Not retried (the person tries again).
export async function processBeanReview(data: BeanReviewJobData): Promise<BeanReviewResult | null> {
  const hidden = await hiddenFor(data.beanId);
  const context = hidden && (await loadBeanReviewContext(data));
  if (!context) return null;
  const draft = await requestBeanReview(context, hidden!, await promptFor(data.requestedBy, data.note));
  return { ...draft, brewCount: context.brews.length };
}

// A preview (docs/api/analysis.md §8d): what the job would send, built the
// same way (analysisSent / suggestionSent), without calling the AI. null
// when the brew or bean is gone.
export async function processAiPreview(data: AiPreviewJobData): Promise<AiRequest | null> {
  if (data.kind === "analysis") {
    const context = await loadBrewContext(data.brewLogId);
    if (!context) return null;
    const ws = await workspaceOf(data.brewLogId);
    return analysisSent(context, new Set((ws?.settings ?? DEFAULT_WORKSPACE_SETTINGS).aiHidden), await promptFor(ws?.baristaId ?? null, data.note));
  }
  if (data.kind === "beanReview") {
    const hidden = await hiddenFor(data.review.beanId);
    const context = hidden && (await loadBeanReviewContext(data.review));
    return context ? beanReviewSent(context, hidden!, await promptFor(data.review.requestedBy, data.review.note)) : null;
  }
  const hidden = await hiddenFor(data.suggestion.beanId);
  if (!hidden) return null;
  const context = await loadSuggestContext(data.suggestion, { ratedOnly: hidden.has("unratedHistory") });
  return context ? suggestionSent(context, hidden, await promptFor(data.suggestion.requestedBy, data.suggestion.note)) : null;
}

// Every attempt failed: the brew page shows why, with "Try again".
export async function failSuggestion(suggestionId: string, error: string): Promise<void> {
  await db.update(parameterSuggestions).set({ status: "failed", error, completedAt: new Date() }).where(eq(parameterSuggestions.id, suggestionId));
}

// What the journal says when every attempt failed (the details are in the
// worker's log).
export function failureMessage(unrecoverable: boolean): string {
  return unrecoverable ? "The AI service refused the request" : "The AI service couldn't be reached";
}

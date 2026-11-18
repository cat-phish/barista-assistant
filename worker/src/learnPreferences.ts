// Learning a person's preferences (docs/api/llm-contract.md §9g,
// docs/api/auth.md §1d): what they did in one workspace since the last run
// (likes and dislikes, rated or analyzed brews, the brew profile) sent with
// their current list; the changes the AI answers are merged in as proposals,
// or applied, as they chose. Nothing new means no AI call.
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { mergeLearned, withPreferenceDefaults, type AiPreferences, type LearnedChange } from "@barista/shared/aiPreferences";
import type { AiDetail } from "@barista/shared/aiDetails";
import type { PreferencesJobData } from "@barista/shared/jobs";
import { brewers, brewLogs, userPreferences, DEFAULT_WORKSPACE_SETTINGS, llmAnalyses, parameterSuggestions, users, withDefaults, workspaces } from "@barista/shared/schema";
import { resolveAi } from "./ai/resolve.js";
import { loadBean, selectBrews, withJoins } from "./context.js";
import { loadBrewProfile } from "./brewProfile.js";
import { db } from "./db.js";
import { requestLearnedPreferences } from "./llm.js";
import { profileInput } from "./prompt.js";
import { isWorkspaceMember, votesFor, type VoteSignal } from "./preferences.js";

export const LEARN_MAX_SIGNALS = 10;
const FIRST_LOOKBACK_MS = 30 * 24 * 3600_000;

export interface LearnBrew {
  day: string; // YYYY-MM-DD
  rating: number;
  method: string | null;
  recipe: string | null;
  doseGrams: number;
  waterGrams: number | null;
  tempC?: number | null;
  grindSetting: number | null;
  timeSec: number;
  tastingNotes: string | null;
  route: string | null; // the suggested route it was brewed from
  analysis: string | null; // the latest analysis's next step
}
export interface LearnInput {
  current: {
    mine: Array<{ id: string; text: string; basis: number; source: string }>;
    proposals: Array<{ change: string; id: string | null; text: string | null }>;
    workspace: string[];
  };
  // A dislike carries a ref ("d1", …) a change cites to apply at once.
  votes: Array<Omit<VoteSignal, "at"> & { ref?: string }>;
  analysisVotes: Array<AnalysisVote & { ref?: string }>;
  brews: LearnBrew[];
  profile: string[] | null;
}

// A 👍/👎 they gave an analysis (docs/api/analysis.md §8).
export interface AnalysisVote {
  vote: "up" | "down";
  advice: string; // the analysis's next step, or the start of its reasoning
  reason: string | null;
}

// Analyses in the workspace they rated since then; newest first.
async function analysisVotesSince(userId: string, workspaceId: string, since: Date): Promise<AnalysisVote[]> {
  const rows = await db
    .select({ helpful: llmAnalyses.helpful, nextStep: llmAnalyses.nextStep, reasoning: llmAnalyses.reasoning, reason: llmAnalyses.feedbackReason })
    .from(llmAnalyses)
    .innerJoin(brewLogs, eq(brewLogs.id, llmAnalyses.brewLogId))
    .where(and(eq(brewLogs.workspaceId, workspaceId), eq(llmAnalyses.feedbackBy, userId), isNotNull(llmAnalyses.helpful), gt(llmAnalyses.ratedAt, since)))
    .orderBy(desc(llmAnalyses.ratedAt))
    .limit(LEARN_MAX_SIGNALS);
  return rows.map((a) => ({ vote: a.helpful ? "up" : "down", advice: a.nextStep ?? a.reasoning.slice(0, 200), reason: a.reason }));
}

export type LearnResult = { status: "saved"; changes: number } | { status: "skipped"; reason: string };

// Their rated brews in the workspace made, or analyzed, since then; newest first.
async function brewsSince(userId: string, workspaceId: string, since: Date, hidden: ReadonlySet<AiDetail>): Promise<{ brews: LearnBrew[]; latest: ReturnType<typeof withJoins> | null }> {
  const analyzedSince = sql`exists (select 1 from ${llmAnalyses} where ${llmAnalyses.brewLogId} = ${brewLogs.id} and ${gt(llmAnalyses.createdAt, since)})`; // gt maps the date as the column does (UTC)
  const rows = (
    await selectBrews()
      .where(and(eq(brewLogs.workspaceId, workspaceId), eq(brewLogs.userId, userId), isNotNull(brewLogs.rating), eq(brewLogs.steeping, false), or(gt(brewLogs.timestamp, since), analyzedSince)))
      .orderBy(desc(brewLogs.timestamp))
      .limit(LEARN_MAX_SIGNALS)
  ).map(withJoins);
  if (!rows.length) return { brews: [], latest: null };
  const ids = rows.map((b) => b.id);
  const suggestionIds = [...new Set(rows.flatMap((b) => (b.suggestionId ? [b.suggestionId] : [])))];
  const [analyses, suggestions] = await Promise.all([
    db.select({ brewLogId: llmAnalyses.brewLogId, nextStep: llmAnalyses.nextStep }).from(llmAnalyses).where(inArray(llmAnalyses.brewLogId, ids)).orderBy(desc(llmAnalyses.createdAt)),
    suggestionIds.length ? db.select({ id: parameterSuggestions.id, routes: parameterSuggestions.routes }).from(parameterSuggestions).where(inArray(parameterSuggestions.id, suggestionIds)) : Promise.resolve([]),
  ]);
  const analysis = new Map<string, string | null>();
  for (const a of analyses) if (!analysis.has(a.brewLogId)) analysis.set(a.brewLogId, a.nextStep);
  const routes = new Map(suggestions.map((s) => [s.id, s.routes]));
  const brews = rows.map((b): LearnBrew => {
    const brew: LearnBrew = {
      day: b.timestamp.toISOString().slice(0, 10),
      rating: b.rating!,
      method: b.methodKind,
      recipe: b.recipeName,
      doseGrams: b.actualDoseGrams,
      waterGrams: b.actualWaterGrams,
      grindSetting: b.actualGrindSetting,
      timeSec: b.actualTimeSec,
      tastingNotes: b.tastingNotes?.slice(0, 500) ?? null,
      route: b.suggestionId && b.suggestionRoute !== null ? (routes.get(b.suggestionId)?.[b.suggestionRoute]?.label ?? null) : null,
      analysis: analysis.get(b.id) ?? null,
    };
    if (!hidden.has("temp")) brew.tempC = b.actualTempC;
    return brew;
  });
  return { brews, latest: rows[0]! };
}

async function profileOf(latest: ReturnType<typeof withJoins>, hidden: ReadonlySet<AiDetail>): Promise<string[] | null> {
  const [[brewer], bean] = await Promise.all([
    latest.brewerId ? db.select({ name: brewers.name, kind: brewers.kind }).from(brewers).where(eq(brewers.id, latest.brewerId)) : Promise.resolve([]),
    loadBean(latest.beanId),
  ]);
  const profile = await loadBrewProfile(
    {
      personId: latest.userId,
      workspaceId: latest.workspaceId,
      beanId: latest.beanId,
      focus: {
        methodKind: brewer?.kind ?? latest.methodKind,
        brewerId: latest.brewerId,
        brewer: brewer?.name ?? null,
        recipeId: latest.recipeId,
        recipe: latest.recipeName,
        roastLevel: hidden.has("roastLevel") ? null : (bean?.info.roastLevel ?? null),
      },
    },
    hidden,
  );
  return profileInput(profile, hidden);
}

// What a run sends (docs/api/llm-contract.md §9g); null when nothing is new.
// Exported for the token estimate in docs/api/auth.md §1d.
export async function learnInput(
  userId: string,
  workspaceId: string,
  since: Date,
  hidden: ReadonlySet<AiDetail>,
  workspaceLines: string[],
  prefs: AiPreferences,
): Promise<LearnInput | null> {
  const [votes, analysisVotes, { brews, latest }] = await Promise.all([
    votesFor(userId, workspaceId, hidden, LEARN_MAX_SIGNALS, since),
    analysisVotesSince(userId, workspaceId, since),
    brewsSince(userId, workspaceId, since, hidden),
  ]);
  if (!votes.length && !analysisVotes.length && !brews.length) return null;
  let n = 0;
  const ref = (vote: "up" | "down") => (vote === "down" ? { ref: `d${++n}` } : {});
  return {
    current: {
      mine: prefs.items.map((i) => ({ id: i.id, text: i.text, basis: i.basis, source: i.source })),
      proposals: prefs.proposals.map((p) => ({ change: p.change, id: p.targetId, text: p.text })),
      workspace: workspaceLines,
    },
    votes: votes.map((v) => ({ vote: v.vote, on: v.on, changes: v.changes, reason: v.reason, ...ref(v.vote) })),
    analysisVotes: analysisVotes.map((a) => ({ ...a, ...ref(a.vote) })),
    brews,
    profile: latest ? await profileOf(latest, hidden) : null,
  };
}

// A change skips the person's accepting only when it cites a dislike sent in
// this run (docs/api/llm-contract.md §9g); the AI's word alone isn't enough.
// SEC-80: one dislike is one accepting for one change, and never for a
// removal; any other change that cites it becomes a proposal.
export function checkedDislikes(changes: ReadonlyArray<Omit<LearnedChange, "fromDislike"> & { dislikeRef: string | null }>, input: LearnInput): LearnedChange[] {
  const refs = new Set([...input.votes, ...input.analysisVotes].flatMap((v) => (v.vote === "down" && v.ref ? [v.ref] : [])));
  const used = new Set<string>();
  return changes.map(({ dislikeRef, ...c }) => {
    const accepted = dislikeRef !== null && refs.has(dislikeRef) && c.change !== "remove" && !used.has(dislikeRef);
    if (accepted) used.add(dislikeRef);
    return { ...c, fromDislike: accepted };
  });
}

export async function learnPreferences({ userId, workspaceId }: PreferencesJobData): Promise<LearnResult> {
  const started = new Date();
  const [[person], [ws]] = await Promise.all([
    db.select({ p: users.aiPreferences, preferences: users.preferences }).from(users).where(eq(users.id, userId)),
    db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)),
  ]);
  if (!person || !ws) return { status: "skipped", reason: "person or workspace gone" };
  if (!(await isWorkspaceMember(userId, workspaceId))) return { status: "skipped", reason: "not a member" }; // SEC-20
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws.settings ?? null);
  const hidden = new Set<AiDetail>(settings.aiHidden);
  if (hidden.has("learnedPreferences")) return { status: "skipped", reason: "kept from the AI" };
  if (!userPreferences(person.preferences ?? null).learnAboutMe) return { status: "skipped", reason: "Learn about me is off" };
  const prefs = withPreferenceDefaults(person.p);
  const through = prefs.through[workspaceId];
  const since = through ? new Date(through) : new Date(started.getTime() - FIRST_LOOKBACK_MS);

  const input = await learnInput(userId, workspaceId, since, hidden, settings.aiPreferences, prefs);
  if (!input) {
    await saveThrough(userId, workspaceId, started);
    return { status: "skipped", reason: "nothing new" };
  }
  const ai = await resolveAi(workspaceId);
  const { changes: answered, usage } = await requestLearnedPreferences(ai, input);
  const changes = checkedDislikes(answered, input);

  // Merged onto the list as it is now: the person may have edited it meanwhile.
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ p: users.aiPreferences }).from(users).where(eq(users.id, userId)).for("update");
    if (!row) return;
    const now = withPreferenceDefaults(row.p);
    const merged = mergeLearned(now, changes, started.toISOString(), randomUUID);
    // Counted for the average Settings shows (docs/api/auth.md §1d).
    const counted = {
      runs: now.usage.runs + 1,
      promptTokens: now.usage.promptTokens + (usage?.promptTokens ?? 0),
      completionTokens: now.usage.completionTokens + (usage?.completionTokens ?? 0),
    };
    await tx.update(users).set({ aiPreferences: { ...merged, usage: counted, through: { ...now.through, [workspaceId]: started.toISOString() } } }).where(eq(users.id, userId));
  });
  return { status: "saved", changes: changes.length };
}

async function saveThrough(userId: string, workspaceId: string, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ p: users.aiPreferences }).from(users).where(eq(users.id, userId)).for("update");
    if (!row) return;
    const now = withPreferenceDefaults(row.p);
    await tx.update(users).set({ aiPreferences: { ...now, through: { ...now.through, [workspaceId]: at.toISOString() } } }).where(eq(users.id, userId));
  });
}

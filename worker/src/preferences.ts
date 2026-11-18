// Learned preferences as the AI gets them with an analysis or suggestion
// (docs/api/llm-contract.md §9, "Learned preferences"; docs/api/auth.md §1d):
// the person's items, the workspace's lines and, for suggestions, their
// latest likes and dislikes, so a dislike counts before the list catches up.
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { beans, userPreferences, DEFAULT_WORKSPACE_SETTINGS, parameterSuggestions, users, withDefaults, workspaceMembers, workspaces, type SuggestedRoute, type SuggestionFeedback } from "@barista/shared/schema";
import type { AiDetail } from "@barista/shared/aiDetails";
import { preferenceLine, withPreferenceDefaults } from "@barista/shared/aiPreferences";
import { db } from "./db.js";

export const RECENT_VOTES = 5;

export interface VoteSignal {
  at: string; // ISO, when the feedback last changed
  vote: "up" | "down";
  on: string; // the route's label, or "the whole suggestion: …"
  changes: string | null; // the route's grind, temperature and ratio
  reason: string | null;
}
export interface PreferencesInput {
  mine: string[];
  workspace: string[];
  recentVotes?: Omit<VoteSignal, "at">[];
}

const routeChanges = (r: Pick<SuggestedRoute, "grindSetting" | "grindRpm" | "tempC" | "ratio">, hidden: ReadonlySet<AiDetail>): string | null => {
  const parts = [
    r.grindSetting !== null && `grind ${r.grindSetting}`,
    r.grindRpm !== null && !hidden.has("rpm") && `${r.grindRpm} rpm`,
    r.tempC !== null && !hidden.has("temp") && `${r.tempC} °C`,
    r.ratio !== null && `1:${r.ratio}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

// Likes and dislikes the person gave on suggestions in this workspace, newest
// first; since: only feedback changed after it.
export async function votesFor(personId: string, workspaceId: string, hidden: ReadonlySet<AiDetail>, limit: number, since: Date | null = null): Promise<VoteSignal[]> {
  const rows = await db
    .select({
      feedback: parameterSuggestions.feedback,
      feedbackAt: parameterSuggestions.feedbackAt,
      nextStep: parameterSuggestions.nextStep,
      routes: parameterSuggestions.routes,
      grindSetting: parameterSuggestions.grindSetting,
      grindRpm: parameterSuggestions.grindRpm,
      tempC: parameterSuggestions.tempC,
      ratio: parameterSuggestions.ratio,
    })
    .from(parameterSuggestions)
    .innerJoin(beans, eq(parameterSuggestions.beanId, beans.id))
    .where(
      and(
        eq(beans.workspaceId, workspaceId),
        eq(parameterSuggestions.requestedBy, personId),
        isNotNull(parameterSuggestions.feedback),
        isNotNull(parameterSuggestions.feedbackAt),
        since ? gt(parameterSuggestions.feedbackAt, since) : undefined,
      ),
    )
    .orderBy(desc(parameterSuggestions.feedbackAt))
    .limit(limit);
  return rows.flatMap((s) => {
    const fb: SuggestionFeedback = s.feedback!;
    const at = s.feedbackAt!.toISOString();
    // Before routes, a suggestion's own values are its only route.
    const routes: SuggestedRoute[] = s.routes ?? [{ label: s.nextStep ?? "the suggestion", why: "", findings: [], grindSetting: s.grindSetting, grindRpm: s.grindRpm, tempC: s.tempC, ratio: s.ratio }];
    const out: VoteSignal[] = [];
    if (fb.suggestion) out.push({ at, vote: fb.suggestion.vote, on: `the whole suggestion: ${s.nextStep ?? ""}`.trim(), changes: null, reason: fb.suggestion.reason });
    fb.routes.forEach((v, i) => {
      const route = routes[i];
      if (v && route) out.push({ at, vote: v.vote, on: route.label, changes: routeChanges(route, hidden), reason: v.reason });
    });
    return out;
  }).slice(0, limit);
}

// null when the workspace keeps them from the AI, or there's nothing to send.
export async function loadPreferences(
  r: { personId: string | null; workspaceId: string },
  hidden: ReadonlySet<AiDetail>,
  options: { votes?: boolean } = {},
): Promise<PreferencesInput | null> {
  if (hidden.has("learnedPreferences")) return null;
  const [[person], [ws], votes] = await Promise.all([
    r.personId ? db.select({ p: users.aiPreferences, preferences: users.preferences }).from(users).where(eq(users.id, r.personId)) : Promise.resolve([]),
    db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, r.workspaceId)),
    r.personId && options.votes ? votesFor(r.personId, r.workspaceId, hidden, RECENT_VOTES) : Promise.resolve([]),
  ]);
  // Learn about me off (docs/api/auth.md §1d): only the workspace's lines.
  const learns = !!person && userPreferences(person.preferences ?? null).learnAboutMe;
  const input: PreferencesInput = {
    mine: learns ? withPreferenceDefaults(person.p).items.map(preferenceLine) : [],
    workspace: withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null).aiPreferences,
  };
  if (options.votes && learns) input.recentVotes = votes.map((v) => ({ vote: v.vote, on: v.on, changes: v.changes, reason: v.reason }));
  return input.mine.length || input.workspace.length || input.recentVotes?.length ? input : null;
}

// SEC-20: learning runs only for someone who is in the workspace now.
export async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));
  return Boolean(row);
}

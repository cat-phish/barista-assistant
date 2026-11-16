import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beans, brewers, brewLogs, llmAnalyses, parameterSuggestions, recipes, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { EMPTY_AI_PREFERENCES, mergeLearned, MAX_PREFERENCES, type AiPreference, type AiPreferences } from "@barista/shared/aiPreferences";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { requestLearnedPreferences } from "../src/llm.js";
import { checkedDislikes, learnPreferences, type LearnInput } from "../src/learnPreferences.js";
import { loadPreferences, votesFor } from "../src/preferences.js";
import { loadBrewContext } from "../src/context.js";

// Learned preferences (docs/api/auth.md §1d, docs/api/llm-contract.md §9g).
vi.mock("../src/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/llm.js")>()),
  requestLearnedPreferences: vi.fn(),
}));
vi.mock("../src/ai/resolve.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ai/resolve.js")>()),
  resolveAi: vi.fn(async () => ({ models: { main: "test" } })),
}));
const llm = vi.mocked(requestLearnedPreferences);

const NOW = "2026-11-14T10:00:00.000Z";
const item = (id: string, text: string, over: Partial<AiPreference> = {}): AiPreference => ({ id, text, basis: 3, source: "ai", updatedAt: NOW, ...over });
let n = 0;
const newId = () => `new-${++n}`;

describe("mergeLearned", () => {
  beforeEach(() => {
    n = 0;
  });
  const prefs = (over: Partial<AiPreferences> = {}): AiPreferences => ({ ...EMPTY_AI_PREFERENCES, items: [item("a", "Prefers 19-20% EY"), item("p", "No cooler water", { source: "person", basis: 0 })], ...over });

  it("proposes by default, and a newer proposal replaces one for the same item", () => {
    const once = mergeLearned(prefs(), [{ change: "edit", id: "a", text: "Prefers 19.5-20.5% EY", basis: 5, why: "w", fromDislike: false }], NOW, newId);
    expect(once.items).toEqual(prefs().items);
    expect(once.proposals).toEqual([{ id: "new-1", change: "edit", targetId: "a", text: "Prefers 19.5-20.5% EY", basis: 5, why: "w", createdAt: NOW }]);
    const twice = mergeLearned(once, [{ change: "remove", id: "a", text: null, basis: 6, why: "w", fromDislike: false }], NOW, newId);
    expect(twice.proposals.map((p) => [p.change, p.targetId])).toEqual([["remove", "a"]]);
  });

  it("with apply, applies, except to items the person wrote", () => {
    const merged = mergeLearned(
      prefs({ apply: "apply" }),
      [
        { change: "add", id: null, text: "Likes a long bloom", basis: 4, why: "w", fromDislike: false },
        { change: "remove", id: "a", text: null, basis: 4, why: "w", fromDislike: false },
        { change: "edit", id: "p", text: "Cooler water only on dark roasts", basis: 2, why: "w", fromDislike: false },
      ],
      NOW,
      newId,
    );
    expect(merged.items.map((i) => i.text)).toEqual(["No cooler water", "Likes a long bloom"]);
    expect(merged.proposals.map((p) => [p.change, p.targetId])).toEqual([["edit", "p"]]);
  });

  it("applies a change from a dislike even when proposing: the dislike accepts it", () => {
    const merged = mergeLearned(
      prefs(),
      [
        { change: "add", id: null, text: "Doesn't want cooler water", basis: 1, why: "w", fromDislike: true },
        { change: "edit", id: "p", text: "Never cooler water", basis: 1, why: "w", fromDislike: true },
      ],
      NOW,
      newId,
    );
    expect(merged.items.map((i) => i.text)).toEqual(["Prefers 19-20% EY", "No cooler water", "Doesn't want cooler water"]);
    // A line the person wrote still only gets a proposal.
    expect(merged.proposals.map((p) => [p.change, p.targetId])).toEqual([["edit", "p"]]);
  });

  it("drops changes naming no item, repeats and empty text; an add past the cap is a proposal", () => {
    const merged = mergeLearned(
      prefs(),
      [
        { change: "edit", id: "gone", text: "x", basis: 1, why: "w", fromDislike: false },
        { change: "add", id: null, text: "prefers 19-20% ey", basis: 1, why: "w", fromDislike: false },
        { change: "add", id: null, text: null, basis: 1, why: "w", fromDislike: false },
      ],
      NOW,
      newId,
    );
    expect(merged.proposals).toEqual([]);
    const full = { ...prefs({ apply: "apply" }), items: Array.from({ length: MAX_PREFERENCES }, (_, i) => item(`i${i}`, `Line ${i}`)) };
    const past = mergeLearned(full, [{ change: "add", id: null, text: "One more", basis: 2, why: "w", fromDislike: false }], NOW, newId);
    expect(past.items).toHaveLength(MAX_PREFERENCES);
    expect(past.proposals.map((p) => p.text)).toEqual(["One more"]);
  });
});

describe("loading and learning", () => {
  let workspaceId: string;
  let userId: string;
  let beanId: string;
  let brewerId: string;
  let suggestionId: string;
  let brewId: string;

  const setPrefs = (p: Partial<AiPreferences>) => db.update(users).set({ aiPreferences: { ...EMPTY_AI_PREFERENCES, ...p } }).where(eq(users.id, userId));
  const prefsNow = async () => (await db.select({ p: users.aiPreferences }).from(users).where(eq(users.id, userId)))[0]!.p!;

  beforeEach(async () => {
    llm.mockReset();
    workspaceId = randomUUID();
    userId = randomUUID();
    beanId = randomUUID();
    brewerId = randomUUID();
    suggestionId = randomUUID();
    brewId = randomUUID();
    const recipeId = randomUUID();
    await db.insert(users).values({ id: userId, email: `l-${userId}@example.com`, passwordHash: "x" });
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: `w-${workspaceId}`, settings: { aiPreferences: ["Decaf after 3pm"] } });
    await db.insert(workspaceMembers).values({ userId, workspaceId, role: "barista" }); // SEC-20: learning needs a membership
    await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
    await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji", roastLevel: "light", roastDate: new Date("2026-11-01T00:00:00Z") });
    await db.insert(recipes).values({ id: recipeId, workspaceId, name: "House V60", brewerId, targetDoseGrams: 15, targetWaterGrams: 250 });
    await db.insert(parameterSuggestions).values({
      id: suggestionId, beanId, recipeId, brewerId, source: "recipe", maxBrews: 5, requestedBy: userId, status: "done", nextStep: "Grind finer.",
      routes: [
        { label: "A touch finer", why: "w", findings: [], grindSetting: 12, grindRpm: null, tempC: null, ratio: null },
        { label: "Cooler water", why: "w", findings: [], grindSetting: null, grindRpm: null, tempC: 90, ratio: null },
      ],
      feedback: { suggestion: null, routes: [{ vote: "up", reason: null }, { vote: "down", reason: "I never want cooler water" }] },
      feedbackAt: new Date(Date.now() - 60_000),
    });
    await db.insert(brewLogs).values({
      id: brewId, workspaceId, userId, beanId, recipeId, brewerId, rating: 4.5, actualTempC: 94, tastingNotes: "Sweet, juicy",
      timestamp: new Date(Date.now() - 3600_000), actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 180, suggestionId, suggestionRoute: 0,
    });
    await db.insert(llmAnalyses).values({ id: randomUUID(), brewLogId: brewId, reasoning: "Good.", suggestedGrindDelta: "no_change", suggestedTempDelta: 0, nextStep: "Keep it.", createdAt: new Date(Date.now() - 1800_000) });
  });

  it("votesFor gives each route's vote with its changes, the temperature only when it may be seen", async () => {
    const votes = await votesFor(userId, workspaceId, new Set(), 10);
    expect(votes.map(({ at: _at, ...v }) => v)).toEqual([
      { vote: "up", on: "A touch finer", changes: "grind 12", reason: null },
      { vote: "down", on: "Cooler water", changes: "90 °C", reason: "I never want cooler water" },
    ]);
    expect((await votesFor(userId, workspaceId, new Set(["temp"]), 10))[1]!.changes).toBeNull();
    expect(await votesFor(userId, workspaceId, new Set(), 10, new Date())).toEqual([]);
  });

  it("loadPreferences sends the person's lines, the workspace's and, for suggestions, recent votes", async () => {
    await setPrefs({ items: [item("a", "Prefers 19-20% EY"), item("p", "No cooler water", { source: "person", basis: 0 })] });
    const prefs = await loadPreferences({ personId: userId, workspaceId }, new Set(), { votes: true });
    expect(prefs).toMatchObject({ mine: ["Prefers 19-20% EY (n=3)", "No cooler water"], workspace: ["Decaf after 3pm"] });
    expect(prefs!.recentVotes).toHaveLength(2);
    expect(await loadPreferences({ personId: userId, workspaceId }, new Set(["learnedPreferences"]))).toBeNull();
    // An analysis gets the lines, without votes; and in its context.
    const context = await loadBrewContext(brewId, { profile: new Set() });
    expect(context!.preferences).toEqual({ mine: ["Prefers 19-20% EY (n=3)", "No cooler water"], workspace: ["Decaf after 3pm"] });
    expect((await loadBrewContext(brewId))!.preferences).toBeNull();
  });

  it("learnPreferences sends what's new, proposes the changes and moves through on", async () => {
    // Only a change citing a dislike sent in this run skips the accepting.
    llm.mockResolvedValue({
      changes: [
        { change: "add", id: null, text: "Turns down cooler-water ideas", basis: 1, why: "Said so.", dislikeRef: "d1" },
        { change: "add", id: null, text: "Likes juicy cups", basis: 1, why: "Notes.", dislikeRef: "d9" },
        { change: "add", id: null, text: "Likes finer grinds", basis: 1, why: "Liked.", dislikeRef: null },
      ],
      usage: { promptTokens: 900, completionTokens: 60 },
    });
    expect(await learnPreferences({ userId, workspaceId })).toEqual({ status: "saved", changes: 3 });
    const input = llm.mock.calls[0]![1];
    expect(input.votes.map((v) => v.ref)).toEqual([undefined, "d1"]);
    expect(input.brews).toEqual([expect.objectContaining({ rating: 4.5, route: "A touch finer", analysis: "Keep it.", tastingNotes: "Sweet, juicy", tempC: 94 })]);
    expect(input.current.workspace).toEqual(["Decaf after 3pm"]);
    const after = await prefsNow();
    expect(after.items.map((i) => i.text)).toEqual(["Turns down cooler-water ideas"]);
    expect(after.proposals.map((p) => p.text)).toEqual(["Likes juicy cups", "Likes finer grinds"]);
    expect(after.through[workspaceId]).toBeDefined();
    expect(after.usage).toEqual({ runs: 1, promptTokens: 900, completionTokens: 60 });
    // Nothing new since: no call.
    expect(await learnPreferences({ userId, workspaceId })).toEqual({ status: "skipped", reason: "nothing new" });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("learns from an analysis's 👍/👎 and reason; Learn about me off stops it and what's sent", async () => {
    await db.update(llmAnalyses).set({ helpful: false, feedbackBy: userId, feedbackReason: "Grinding finer never helps me", ratedAt: new Date() }).where(eq(llmAnalyses.brewLogId, brewId));
    llm.mockResolvedValue({ changes: [], usage: null });
    await learnPreferences({ userId, workspaceId });
    expect(llm.mock.calls[0]![1].analysisVotes).toEqual([{ vote: "down", advice: "Keep it.", reason: "Grinding finer never helps me", ref: "d2" }]);

    await setPrefs({ items: [item("a", "Prefers 19-20% EY")] });
    await db.update(users).set({ preferences: { learnAboutMe: false } }).where(eq(users.id, userId));
    expect(await learnPreferences({ userId, workspaceId })).toEqual({ status: "skipped", reason: "Learn about me is off" });
    expect(await loadPreferences({ personId: userId, workspaceId }, new Set(), { votes: true })).toEqual({ mine: [], workspace: ["Decaf after 3pm"] });
  });

  it("applies with apply, and skips a workspace that keeps preferences from the AI", async () => {
    await setPrefs({ apply: "apply" });
    llm.mockResolvedValue({ changes: [{ change: "add", id: null, text: "Likes finer grinds", basis: 2, why: "w", dislikeRef: null }], usage: null });
    await learnPreferences({ userId, workspaceId });
    expect((await prefsNow()).items.map((i) => [i.text, i.source])).toEqual([["Likes finer grinds", "ai"]]);
    await db.update(workspaces).set({ settings: { aiHidden: ["learnedPreferences"] } }).where(eq(workspaces.id, workspaceId));
    expect(await learnPreferences({ userId, workspaceId })).toEqual({ status: "skipped", reason: "kept from the AI" });
  });

  // SEC-20: someone who has left (or was removed) is no longer learned about from that workspace.
  it("skips a person who is no longer a member, without calling the AI", async () => {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));
    llm.mockClear();
    expect(await learnPreferences({ userId, workspaceId })).toEqual({ status: "skipped", reason: "not a member" });
    expect(llm).not.toHaveBeenCalled();
  });

  // SEC-80: a dislike is one accepting for one change, and never a removal.
  it("a dislike applies at most one change, never a removal; the rest become proposals", async () => {
    const input = { votes: [{ vote: "down", on: "x", changes: null, reason: null, ref: "d1" }], analysisVotes: [] } as unknown as LearnInput;
    const change = (c: "add" | "remove", text: string | null, id: string | null) => ({ change: c, id, text, basis: 1, why: "w", dislikeRef: "d1" });
    const checked = checkedDislikes([change("add", "one", null), change("add", "two", null), change("add", "three", null), change("remove", null, "a"), change("add", "four", null)], input);
    expect(checked.map((c) => c.fromDislike)).toEqual([true, false, false, false, false]);
    const base = { ...EMPTY_AI_PREFERENCES, items: [item("a", "Prefers 19-20% EY")] };
    const merged = mergeLearned(base, checked, new Date().toISOString(), randomUUID);
    expect(merged.items.map((i) => i.text).sort()).toEqual(["Prefers 19-20% EY", "one"]);
    expect(merged.proposals.map((p) => p.change).sort()).toEqual(["add", "add", "add", "remove"]);
  });
});

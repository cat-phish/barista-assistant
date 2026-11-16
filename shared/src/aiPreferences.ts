// Learned preferences (docs/api/auth.md §1d, docs/api/llm-contract.md §9g;
// docs/backlog.md item 20): what the AI has learned a person likes and turns
// down, kept on users.ai_preferences. Pure helpers shared by the backend
// routes and the worker's learning job.

export const MAX_PREFERENCES = 20;
export const MAX_PROPOSALS = 10;
export const MAX_PREFERENCE_TEXT = 200;
export const MAX_LEARNED_CHANGES = 5; // per learning job
export const PREFERENCE_LEARN = ["auto", "manual"] as const;
export type PreferenceLearn = (typeof PREFERENCE_LEARN)[number];
export const PREFERENCE_APPLY = ["propose", "apply"] as const;
export type PreferenceApply = (typeof PREFERENCE_APPLY)[number];
export const PREFERENCE_CHANGES = ["add", "edit", "remove"] as const;
export type PreferenceChangeKind = (typeof PREFERENCE_CHANGES)[number];

export interface AiPreference {
  id: string;
  text: string;
  basis: number; // brews or votes behind it; 0 for one the person wrote
  source: "ai" | "person";
  updatedAt: string; // ISO
}
export interface PreferenceProposal {
  id: string;
  change: PreferenceChangeKind;
  targetId: string | null; // the item an edit or removal is for
  text: string | null; // null for a removal
  basis: number;
  why: string;
  createdAt: string; // ISO
}
export interface AiPreferences {
  learn: PreferenceLearn;
  apply: PreferenceApply;
  items: AiPreference[];
  proposals: PreferenceProposal[];
  through: Record<string, string>; // workspace id -> ISO time signals were learned up to
  usage: { runs: number; promptTokens: number; completionTokens: number }; // learning calls made, for the average shown
}
export const EMPTY_AI_PREFERENCES: AiPreferences = { learn: "auto", apply: "propose", items: [], proposals: [], through: {}, usage: { runs: 0, promptTokens: 0, completionTokens: 0 } };
export const withPreferenceDefaults = (p: Partial<AiPreferences> | null | undefined): AiPreferences => ({ ...EMPTY_AI_PREFERENCES, ...p });

// A change as the learning job answers it (id: the item's, for an edit or removal).
export interface LearnedChange {
  change: PreferenceChangeKind;
  id: string | null;
  text: string | null;
  basis: number;
  why: string;
  fromDislike: boolean; // it comes from a dislike: that counts as accepting it
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

// The list with a proposal applied; null when it can't apply (an add with
// the list full). An edit or removal whose item is gone changes nothing.
export function applyProposal(items: readonly AiPreference[], p: Omit<PreferenceProposal, "id" | "createdAt">, source: AiPreference["source"], now: string, newId: () => string): AiPreference[] | null {
  if (p.change === "add") {
    if (!p.text) return [...items];
    if (items.some((i) => same(i.text, p.text!))) return [...items];
    if (items.length >= MAX_PREFERENCES) return null;
    return [...items, { id: newId(), text: p.text, basis: p.basis, source, updatedAt: now }];
  }
  if (p.change === "remove") return items.filter((i) => i.id !== p.targetId);
  return items.map((i) => (i.id === p.targetId && p.text ? { ...i, text: p.text, basis: p.basis, source, updatedAt: now } : i));
}

// The learning job's changes merged in (docs/api/llm-contract.md §9g): ones
// naming no item, or adding what's there, are dropped; with "apply", or when
// it comes from a dislike (the dislike is the accepting), they apply, except
// to items the person wrote or an add past the cap, which become proposals
// like everything else with "propose". A new proposal replaces an older one
// for the same item.
export function mergeLearned(prefs: AiPreferences, changes: readonly LearnedChange[], now: string, newId: () => string): AiPreferences {
  let items = [...prefs.items];
  let proposals = [...prefs.proposals];
  for (const c of changes.slice(0, MAX_LEARNED_CHANGES)) {
    const target = c.id ? items.find((i) => i.id === c.id) : undefined;
    if (c.change !== "add" && !target) continue;
    if (c.change !== "remove" && !c.text) continue;
    if (c.change === "add" && items.some((i) => same(i.text, c.text!))) continue;
    if (c.change === "edit" && target && same(target.text, c.text!)) continue;
    const proposal = { change: c.change, targetId: c.change === "add" ? null : c.id, text: c.change === "remove" ? null : c.text, basis: c.basis, why: c.why };
    if ((prefs.apply === "apply" || c.fromDislike) && target?.source !== "person") {
      const next = applyProposal(items, proposal, "ai", now, newId);
      if (next) {
        items = next;
        proposals = proposals.filter((p) => p.targetId === null || items.some((i) => i.id === p.targetId));
        continue;
      }
    }
    proposals = proposals.filter((p) => (proposal.targetId ? p.targetId !== proposal.targetId : !(p.change === "add" && p.text && same(p.text, proposal.text!))));
    proposals.push({ id: newId(), ...proposal, createdAt: now });
  }
  return { ...prefs, items, proposals: proposals.slice(-MAX_PROPOSALS) };
}

// What goes to the AI with an analysis or suggestion (docs/api/llm-contract.md
// §9, "Learned preferences").
export const preferenceLine = (i: AiPreference): string => (i.source === "person" || i.basis <= 0 ? i.text : `${i.text} (n=${i.basis})`);

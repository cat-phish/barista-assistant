// Research settings (docs/api/research.md §1f; docs/backlog.md item 21):
// which built-in findings (research.ts) go to the AI, and findings people
// add themselves. A person has their own (users.research), a workspace its
// defaults and shared findings (workspaces.research). Pure helpers shared by
// the backend routes, the worker's prompt and the backup.
import { RESEARCH_EVIDENCE, RESEARCH_FINDINGS, RESEARCH_VERSION, researchVersionNumber, type ResearchFinding, type ResearchLever, type ResearchScope } from "./research.js";

// on: a rule for analyses and suggestions; off: never sent; experiment: only
// as something to try (chat-style experiment ideas), never to an analysis or
// a suggestion.
export const RESEARCH_MODES = ["on", "off", "experiment"] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

// A person's or workspace's own finding may also rest on their own test.
export const OWN_EVIDENCE = [...RESEARCH_EVIDENCE, "own"] as const;
export type OwnEvidence = (typeof OWN_EVIDENCE)[number];

export const MAX_OWN_FINDINGS = 20; // per person, and per workspace
export const MAX_FINDING_TITLE = 80;
export const MAX_FINDING_TEXT = 600;
export const MAX_FINDING_SOURCE = 300;
export const MAX_RESEARCH_NOTE = 200;
export const MAX_RESEARCH_DRAFT_TEXT = 4000; // free text turned into findings (§1f, "Drafts")
export const MAX_RESEARCH_DRAFTS = 5; // per draft call
export const OWN_FINDING_ID = /^[0-9a-f]{8}$/;

// How one built-in finding is treated: null = no choice of their own (the
// workspace's default, or the finding's). The note is the person's own memo
// (why it's off, say); it never goes to the AI.
export interface ResearchSetting {
  mode: ResearchMode | null;
  note: string | null;
}
export interface OwnFinding {
  id: string; // 8 hex characters; "own.<id>" in the prompt
  title: string;
  text: string; // framed as data about brewing
  levers: ResearchLever[];
  evidence: OwnEvidence;
  scope: ResearchScope;
  source: string | null;
  mode: ResearchMode;
  createdAt: string; // ISO
}
export interface ResearchSettings {
  settings: Record<string, ResearchSetting>; // by built-in key; missing = the default below
  own: OwnFinding[];
}
export interface UserResearch extends ResearchSettings {
  seenVersion: string | null; // the RESEARCH_VERSION they last dismissed the update notice for
}
export const EMPTY_RESEARCH_SETTINGS: ResearchSettings = { settings: {}, own: [] };
export const EMPTY_USER_RESEARCH: UserResearch = { ...EMPTY_RESEARCH_SETTINGS, seenVersion: null };
export const withResearchDefaults = (r: Partial<ResearchSettings> | null | undefined): ResearchSettings => ({ settings: r?.settings ?? {}, own: r?.own ?? [] });
export const withUserResearchDefaults = (r: Partial<UserResearch> | null | undefined): UserResearch => ({ ...withResearchDefaults(r), seenVersion: r?.seenVersion ?? null });

// What a built-in finding is without any setting.
export const defaultMode = (f: ResearchFinding): ResearchMode => (f.experiment ? "experiment" : "on");

// Precedence: the person's choice, then the workspace's default, then the
// finding's own. A setting for a key that no longer exists is ignored.
export function effectiveMode(f: ResearchFinding, person: ResearchSettings | null, workspace: ResearchSettings | null): ResearchMode {
  return person?.settings[f.key]?.mode ?? workspace?.settings[f.key]?.mode ?? defaultMode(f);
}

// A finding as the prompt gets it. Person's own findings are private to them
// (SEC-22): a saved request shows a placeholder in their place.
export interface SentFinding extends OwnFinding {
  private: boolean;
}
// What the worker sends for one person in one workspace: the built-in keys
// by mode, and the own findings (the person's first, then the workspace's),
// those switched off already dropped. `customized`: anything differs from
// the defaults, so the result's promptVersion gets "+custom".
export interface ResolvedResearch {
  builtIn: Record<string, ResearchMode>;
  own: SentFinding[];
  customized: boolean;
}
export function resolveResearch(person: ResearchSettings | null, workspace: ResearchSettings | null): ResolvedResearch {
  const builtIn: Record<string, ResearchMode> = {};
  let customized = false;
  for (const f of RESEARCH_FINDINGS) {
    builtIn[f.key] = effectiveMode(f, person, workspace);
    if (builtIn[f.key] !== defaultMode(f)) customized = true;
  }
  const own: SentFinding[] = [
    ...(person?.own ?? []).map((o) => ({ ...o, private: true })),
    ...(workspace?.own ?? []).map((o) => ({ ...o, private: false })),
  ].filter((o) => o.mode !== "off");
  return { builtIn, own, customized: customized || own.length > 0 };
}
// Today's defaults, as the worker sent them before the settings existed.
export const DEFAULT_RESEARCH: ResolvedResearch = resolveResearch(null, null);

// The built-in findings reworded or added since the version the person last
// dismissed; none when they never did (nothing to compare with).
export function findingsUpdatedSince(seenVersion: string | null): string[] {
  if (seenVersion === null || seenVersion === RESEARCH_VERSION) return [];
  const seen = researchVersionNumber(seenVersion);
  return RESEARCH_FINDINGS.filter((f) => researchVersionNumber(f.since) > seen).map((f) => f.key);
}

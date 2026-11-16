// Turning pasted text into research findings (docs/api/research.md §1f,
// "Drafts"; llm-contract.md §9h): the text goes to the AI as data, the
// drafts come back in the own-finding schema, and what the AI claimed is
// checked against the text itself: the evidence level can't exceed what the
// text says, and a source must be in the text or it's "not given".
import type { ResearchDraft, ResearchDraftJobData, ResearchDraftResult } from "@barista/shared/jobs";
import { MAX_FINDING_SOURCE, MAX_FINDING_TEXT, MAX_FINDING_TITLE, MAX_RESEARCH_DRAFTS, type OwnEvidence } from "@barista/shared/researchSettings";
import { resolveAi } from "./ai/resolve.js";
import { requestResearchDrafts, type ResearchDraftAnswer } from "./llm.js";
import { isWorkspaceMember } from "./preferences.js";

// What the text itself claims. Peer-reviewed needs a study, paper or
// journal named; a controlled test needs a test, trial or measurement; the
// barista's own test needs the first person. Otherwise expert opinion.
const PEER_REVIEWED = /peer[- ]review|\bjournal\b|\bstud(?:y|ies|ied)\b|\bpaper\b|\bet al\b|\bdoi\b|\bresearch(?:ers?)?\b|\bpublished\b/i;
const CONTROLLED = /\btest(?:ed|s|ing)?\b|\btrials?\b|\bexperiments?\b|\bblind\b|\bmeasured?\b|\bcompar(?:ed|ison)\b|\bcontrolled\b|\brefractometer\b|\bTDS\b|\bextraction yield\b/i;
const FIRST_PERSON = /\b(?:I|I've|I'm|my|mine|we|we've|our|ours)\b/;
const RANK: Record<Exclude<OwnEvidence, "own">, number> = { expert: 0, controlledTest: 1, peerReviewed: 2 };
export function cappedEvidence(text: string, claimed: OwnEvidence): OwnEvidence {
  if (claimed === "own") return FIRST_PERSON.test(text) ? "own" : "expert";
  const allowed = PEER_REVIEWED.test(text) ? 2 : CONTROLLED.test(text) ? 1 : 0;
  return RANK[claimed] <= allowed ? claimed : allowed === 1 ? "controlledTest" : "expert";
}

// A source counts only when the text holds it: every word of 3+ letters or
// digits in the source appears in the text (so "Rao, 2019" matches "Rao
// (2019)" but an invented paper doesn't).
const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
export function sourceInText(text: string, source: string | null): string | null {
  const given = source?.trim() ?? "";
  if (!given) return null;
  const have = new Set(words(text));
  const need = words(given);
  return need.length > 0 && need.every((w) => have.has(w)) ? given.slice(0, MAX_FINDING_SOURCE) : null;
}

const clean = (s: string, max: number): string => s.replace(/[\p{Cc}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

// The AI's drafts, checked against the text: at most 5, each with a title,
// a text and a lever; the evidence capped; the source verified.
export function checkedDrafts(text: string, answered: ResearchDraftAnswer["drafts"]): ResearchDraft[] {
  const out: ResearchDraft[] = [];
  for (const d of answered) {
    const title = clean(d.title, MAX_FINDING_TITLE);
    const body = clean(d.text, MAX_FINDING_TEXT);
    const levers = [...new Set(d.levers)];
    if (!title || !body || !levers.length) continue;
    out.push({ title, text: body, levers, evidence: cappedEvidence(text, d.evidence), scope: d.scope, source: sourceInText(text, d.source), mode: "on" });
    if (out.length === MAX_RESEARCH_DRAFTS) break;
  }
  return out;
}

export async function processResearchDraft(data: ResearchDraftJobData): Promise<ResearchDraftResult> {
  if (!(await isWorkspaceMember(data.requestedBy, data.workspaceId))) return { drafts: [] }; // SEC-20
  const ai = await resolveAi(data.workspaceId);
  const { drafts } = await requestResearchDrafts(ai, data.text);
  return { drafts: checkedDrafts(data.text, drafts) };
}

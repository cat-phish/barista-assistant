// Research settings (docs/api/research.md §1f): how a person's or a
// workspace's settings and own findings are checked. Own findings reach the
// AI prompt as data (SEC-22-style: never instructions), so their text is
// cleaned here: control characters go, whitespace collapses, lengths are
// capped, and nothing else is let through.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { RESEARCH_FINDINGS, RESEARCH_LEVERS, RESEARCH_SCOPES } from "@barista/shared/research";
import {
  MAX_FINDING_SOURCE,
  MAX_FINDING_TEXT,
  MAX_FINDING_TITLE,
  MAX_OWN_FINDINGS,
  MAX_RESEARCH_NOTE,
  OWN_EVIDENCE,
  OWN_FINDING_ID,
  RESEARCH_MODES,
  type OwnFinding,
  type ResearchSettings,
} from "@barista/shared/researchSettings";

export const BUILT_IN_KEYS = new Set(RESEARCH_FINDINGS.map((f) => f.key));

// Control characters (tabs and newlines included) become spaces, runs of
// whitespace one space; then trimmed. Lengths are checked after that.
export const cleanText = (s: string): string => s.replace(/[\p{Cc}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
// Pasted text for drafting keeps its line breaks (paragraphs mean something
// to the reader); other control characters go, blank runs are squeezed.
export const cleanDraftText = (s: string): string =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]|[\u2028\u2029]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const text = (max: number) => z.string().max(max * 4).transform(cleanText).pipe(z.string().min(1, "can't be empty").max(max, `at most ${max} characters`));

export const newFindingId = (): string => randomBytes(4).toString("hex");

// One own finding as sent to save; the id is kept when it's one of the stored
// ones, else a new one is made. Duplicate levers are dropped.
export const findingInputSchema = z
  .object({
    id: z.string().regex(OWN_FINDING_ID).optional(),
    title: text(MAX_FINDING_TITLE),
    text: text(MAX_FINDING_TEXT),
    levers: z
      .array(z.enum(RESEARCH_LEVERS))
      .min(1, "pick at least one lever")
      .max(RESEARCH_LEVERS.length)
      .transform((l) => [...new Set(l)]),
    evidence: z.enum(OWN_EVIDENCE),
    scope: z.enum(RESEARCH_SCOPES),
    source: z
      .string()
      .max(MAX_FINDING_SOURCE * 4)
      .transform(cleanText)
      .pipe(z.string().max(MAX_FINDING_SOURCE, `at most ${MAX_FINDING_SOURCE} characters`))
      .nullable()
      .transform((s) => s || null),
    mode: z.enum(RESEARCH_MODES),
  })
  .strict();
export type FindingInput = z.infer<typeof findingInputSchema>;

const settingSchema = z
  .object({
    mode: z.enum(RESEARCH_MODES).nullable(),
    note: z
      .string()
      .max(MAX_RESEARCH_NOTE * 4)
      .transform(cleanText)
      .pipe(z.string().max(MAX_RESEARCH_NOTE, `at most ${MAX_RESEARCH_NOTE} characters`))
      .nullable()
      .optional()
      .transform((s) => s || null),
  })
  .strict();

// The body of a PUT: settings by built-in key (an unknown key is refused),
// and the own findings in order.
export const researchPutSchema = z
  .object({
    settings: z.record(z.string(), settingSchema).refine((s) => Object.keys(s).every((k) => BUILT_IN_KEYS.has(k)), "settings: not a research finding"),
    own: z.array(findingInputSchema).max(MAX_OWN_FINDINGS, `at most ${MAX_OWN_FINDINGS} findings`),
  })
  .strict();
export type ResearchPut = z.infer<typeof researchPutSchema>;

// The stored findings merged with what was sent: a known id keeps its
// createdAt, a new one gets an id. null when an id isn't one of the stored.
export function mergeFindings(stored: readonly OwnFinding[], sent: readonly FindingInput[], now: string): OwnFinding[] | null {
  const byId = new Map(stored.map((o) => [o.id, o]));
  const out: OwnFinding[] = [];
  const used = new Set<string>();
  for (const f of sent) {
    const old = f.id ? byId.get(f.id) : undefined;
    if (f.id && (!old || used.has(f.id))) return null;
    let id = old?.id ?? newFindingId();
    while (!old && (used.has(id) || byId.has(id))) id = newFindingId();
    used.add(id);
    out.push({ id, title: f.title, text: f.text, levers: f.levers, evidence: f.evidence, scope: f.scope, source: f.source, mode: f.mode, createdAt: old?.createdAt ?? now });
  }
  return out;
}

// A stored block as it is in a backup (docs/api/backup.md §2b): the same
// checks, with ids and createdAt kept.
const storedFindingSchema = findingInputSchema.extend({ id: z.string().regex(OWN_FINDING_ID), createdAt: z.iso.datetime() }).strict();
export const storedResearchSchema = z
  .object({
    settings: z.record(z.string(), settingSchema).transform((s) => Object.fromEntries(Object.entries(s).filter(([k]) => BUILT_IN_KEYS.has(k)))),
    own: z
      .array(storedFindingSchema)
      .max(MAX_OWN_FINDINGS)
      .refine((l) => new Set(l.map((o) => o.id)).size === l.length, "duplicate finding ids"),
  })
  .strict();
export const checkStoredResearch = (value: unknown): ResearchSettings | null => {
  const r = storedResearchSchema.safeParse(value);
  return r.success ? r.data : null;
};

import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  AI_INSTRUCTIONS_MAX,
  AI_NOTE_MAX,
  AI_SECTION_MAX,
  EMPTY_AI_PROMPT,
  INSTRUCTIONS_INTRO,
  LABEL_INSTRUCTIONS_INTRO,
  LOCKED_SECTIONS,
  NOTE_INTRO,
  PROMPT_SECTION_TEXTS,
  PROMPT_TEXT,
  type AiPrompt,
  type PromptSectionText,
} from "@barista/shared/aiPrompt";
import { users } from "@barista/shared/schema";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";

// The caller's own AI prompt (docs/api/auth.md §1c): per person, the same in
// every workspace, used for their brews' analyses and their suggestions.
export interface AiPromptResponse {
  aiPrompt: AiPrompt;
  sections: readonly PromptSectionText[]; // the defaults, to show and reset to
  instructionsIntro: string;
  labelInstructionsIntro: string;
  noteIntro: string;
  limits: { instructions: number; section: number; note: number };
}

const promptSchema = z
  .object({
    instructions: z.string().trim().max(AI_INSTRUCTIONS_MAX).nullable(),
    labelInstructions: z.string().trim().max(AI_INSTRUCTIONS_MAX).nullable().optional(),
    overrides: z
      .record(z.string(), z.string().trim().min(1).max(AI_SECTION_MAX))
      .refine((o) => Object.keys(o).every((k) => k in PROMPT_TEXT), "overrides: not a prompt section")
      .refine((o) => Object.keys(o).every((k) => !LOCKED_SECTIONS.includes(k)), "overrides: that section can't be changed"),
  })
  .strict();

// A one-off note with one request (analysis, suggestion, or their previews).
export const noteSchema = z.string().trim().max(AI_NOTE_MAX).optional();

const respond = (aiPrompt: AiPrompt | null): AiPromptResponse => ({
  aiPrompt: { ...EMPTY_AI_PROMPT, ...aiPrompt },
  sections: PROMPT_SECTION_TEXTS,
  instructionsIntro: INSTRUCTIONS_INTRO,
  labelInstructionsIntro: LABEL_INSTRUCTIONS_INTRO,
  noteIntro: NOTE_INTRO,
  limits: { instructions: AI_INSTRUCTIONS_MAX, section: AI_SECTION_MAX, note: AI_NOTE_MAX },
});

// Mounted at /api/auth/me/ai-prompt
export const aiPromptRouter = Router();
aiPromptRouter.use(requireAuth);

aiPromptRouter.get("/", async (req: Request, res: Response<AiPromptResponse>) => {
  const [row] = await db.select({ aiPrompt: users.aiPrompt }).from(users).where(eq(users.id, authedUserId(req)));
  if (!row) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json(respond(row.aiPrompt));
});

// Replaces it. Empty instructions and a section's own default text count
// as unchanged, so they're not kept. Leaving labelInstructions out clears
// them, like the rest.
aiPromptRouter.put("/", async (req: Request, res: Response<AiPromptResponse>) => {
  const body = parseBody(promptSchema, req, res);
  if (!body) return;
  const overrides = Object.fromEntries(Object.entries(body.overrides).filter(([key, text]) => text !== PROMPT_TEXT[key]));
  const aiPrompt: AiPrompt = { instructions: body.instructions || null, labelInstructions: body.labelInstructions || null, overrides };
  const stored = aiPrompt.instructions || aiPrompt.labelInstructions || Object.keys(overrides).length ? aiPrompt : null;
  const [result] = await db.update(users).set({ aiPrompt: stored }).where(eq(users.id, authedUserId(req)));
  if (result.affectedRows === 0) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json(respond(stored));
});

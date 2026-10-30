import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { parseLexicon, type FlavorLexicon } from "@barista/shared/flavors";
import { flavorLexicons } from "@barista/shared/schema";
import { requireMembership } from "../auth/membership.js";
import { db } from "../db.js";
import { sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { workspaceLexicon } from "../flavorLexicon.js";

// docs/api/flavor-lexicon.md §2c
interface WorkspaceParams {
  workspaceId: string;
}
interface LexiconResponse {
  lexicon: FlavorLexicon; // as a file: download it, change it, import it
  custom: boolean;
  updatedAt: string | null;
}

async function reply(res: Response<LexiconResponse>, workspaceId: string): Promise<void> {
  const { lexicon, custom, updatedAt } = await workspaceLexicon(workspaceId);
  res.json({ lexicon, custom, updatedAt: updatedAt?.toISOString() ?? null });
}

// Mounted at /api/workspaces/:workspaceId/flavor-lexicon
export const flavorLexiconRouter = Router({ mergeParams: true });
flavorLexiconRouter.use(requireAuth);

flavorLexiconRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<LexiconResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  await reply(res, workspaceId);
});

// Replaces the wheel with the file sent. Brews keep their picks: one the new
// wheel doesn't have shows by its saved label.
flavorLexiconRouter.put("/", async (req: Request<WorkspaceParams>, res: Response<LexiconResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const parsed = parseLexicon(req.body);
  if (!parsed.ok) return sendError(res, 400, parsed.error);
  const { name, flavors } = parsed.lexicon;
  await db.insert(flavorLexicons).values({ workspaceId, name, flavors }).onDuplicateKeyUpdate({ set: { name, flavors } });
  await reply(res, workspaceId);
});

// Back to the built-in wheel.
flavorLexiconRouter.delete("/", async (req: Request<WorkspaceParams>, res: Response<LexiconResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  await db.delete(flavorLexicons).where(eq(flavorLexicons.workspaceId, workspaceId));
  await reply(res, workspaceId);
});

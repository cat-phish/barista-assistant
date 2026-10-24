import { Router, type Request, type Response } from "express";
import { requireResourceMembership, WRITE_ROLES } from "../auth/membership.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { brewLogs, DEFAULT_WORKSPACE_SETTINGS, llmAnalyses, withDefaults, workspaces } from "@barista/shared/schema";
import { db } from "../db.js";
import { enqueueBrewAnalysis, QueueUnavailableError } from "../queue.js";

export interface AnalyzeResponse {
  status: "queued";
  jobId: string;
  message: string;
}

// Mounted at /api/brew-logs
export const analyzeRouter = Router();
analyzeRouter.use(requireAuth);

analyzeRouter.post(
  "/:brewLogId/analyze",
  async (req: Request<{ brewLogId: string }>, res: Response<AnalyzeResponse>) => {
    const { brewLogId } = req.params;
    if (!(await requireResourceMembership(res, authedUserId(req), "brewLog", brewLogId, WRITE_ROLES))) {
      return;
    }

    // A cold brew still steeping has nothing to judge yet (docs/api/analysis.md §8).
    const [log] = await db
      .select({ steeping: brewLogs.steeping, rating: brewLogs.rating, drinkRating: brewLogs.drinkRating, settings: workspaces.settings })
      .from(brewLogs)
      .innerJoin(workspaces, eq(brewLogs.workspaceId, workspaces.id))
      .where(eq(brewLogs.id, brewLogId));
    if (log?.steeping) {
      sendError(res, 409, "This brew is still steeping: finish it first");
      return;
    }
    // The workspace can keep unrated brews from the AI (Settings → AI, llm-contract.md §9).
    const unrated = log && log.rating === null && log.drinkRating === null;
    if (unrated && withDefaults(DEFAULT_WORKSPACE_SETTINGS, log.settings).aiHidden.includes("analyzeUnrated")) {
      sendError(res, 409, "Rate this brew first: this workspace only analyzes rated brews");
      return;
    }

    let jobId: string;
    try {
      jobId = await enqueueBrewAnalysis(brewLogId);
    } catch (err) {
      if (err instanceof QueueUnavailableError) {
        console.error("Could not queue brew analysis:", err.message);
        sendError(res, 503, "Analysis is temporarily unavailable. Try again shortly.");
        return;
      }
      throw err;
    }

    res.status(202).json({ status: "queued", jobId, message: "Brew analysis queued." });
  }
);

// Was a suggestion useful? (docs/api/analysis.md §8): 👍 true, 👎 false, null
// takes it back. Who can analyze a brew can rate its suggestions.
const feedbackSchema = z.object({ helpful: z.boolean().nullable() }).strict();
analyzeRouter.put(
  "/:brewLogId/analyses/:analysisId/feedback",
  async (req: Request<{ brewLogId: string; analysisId: string }>, res: Response<{ helpful: boolean | null }>) => {
    const { brewLogId, analysisId } = req.params;
    if (!(await requireResourceMembership(res, authedUserId(req), "brewLog", brewLogId, WRITE_ROLES))) return;
    const body = parseBody(feedbackSchema, req, res);
    if (!body) return;
    const [result] = await db
      .update(llmAnalyses)
      .set({ helpful: body.helpful, ratedAt: body.helpful === null ? null : sql`NOW()` })
      .where(and(eq(llmAnalyses.id, analysisId), eq(llmAnalyses.brewLogId, brewLogId)));
    if (result.affectedRows === 0) {
      sendError(res, 404, "Analysis not found");
      return;
    }
    res.json({ helpful: body.helpful });
  }
);

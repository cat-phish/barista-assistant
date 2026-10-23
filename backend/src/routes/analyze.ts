import { Router, type Request, type Response } from "express";
import { requireResourceMembership, WRITE_ROLES } from "../auth/membership.js";
import { sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { eq } from "drizzle-orm";
import { brewLogs } from "@barista/shared/schema";
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
    const [log] = await db.select({ steeping: brewLogs.steeping }).from(brewLogs).where(eq(brewLogs.id, brewLogId));
    if (log?.steeping) {
      sendError(res, 409, "This brew is still steeping: finish it first");
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

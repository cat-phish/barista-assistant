import { desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { requireResourceMembership } from "../auth/membership.js";
import { db } from "../db.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewLogs, llmAnalyses, type LlmAnalysis } from "@barista/shared/schema";
import { loadBrewLogs, type BrewLogDetails } from "./brewLogs.js";

const RECENT_BREW_COUNT = 5;

export interface SuggestionsResponse {
  latestAnalysis: LlmAnalysis | null;
  analyzedBrew: BrewLogDetails | null;
  recentBrews: BrewLogDetails[];
}

// Mounted at /api/beans
export const suggestionsRouter = Router();
suggestionsRouter.use(requireAuth);

suggestionsRouter.get(
  "/:beanId/suggestions",
  async (req: Request<{ beanId: string }>, res: Response<SuggestionsResponse>) => {
    const { beanId } = req.params;

    // The URL has no workspace, so authorize through the bean's workspace.
    if (!(await requireResourceMembership(res, authedUserId(req), "bean", beanId))) return;

    // llm_analyses has no beanId; reach the bean through the analyzed brew log.
    const [[latest], recentBrews] = await Promise.all([
      db
        .select({ analysis: llmAnalyses })
        .from(llmAnalyses)
        .innerJoin(brewLogs, eq(llmAnalyses.brewLogId, brewLogs.id))
        .where(eq(brewLogs.beanId, beanId))
        .orderBy(desc(llmAnalyses.createdAt), desc(llmAnalyses.id))
        .limit(1),
      loadBrewLogs(eq(brewLogs.beanId, beanId), RECENT_BREW_COUNT),
    ]);

    const latestAnalysis = latest?.analysis ?? null;
    let analyzedBrew: BrewLogDetails | null = null;
    if (latestAnalysis) {
      analyzedBrew =
        recentBrews.find((brew) => brew.id === latestAnalysis.brewLogId) ??
        (await loadBrewLogs(eq(brewLogs.id, latestAnalysis.brewLogId)))[0] ??
        null;
    }

    res.json({ latestAnalysis, analyzedBrew, recentBrews });
  }
);

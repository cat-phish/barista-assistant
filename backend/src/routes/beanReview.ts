import { and, count, eq, inArray, isNotNull, or } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { BeanReviewJobData, BeanReviewResult } from "@barista/shared/jobs";
import { beans, brewers, brewLogs, DEFAULT_WORKSPACE_SETTINGS, MAX_REVIEW_BREWS, withDefaults, workspaces, type AiRequest } from "@barista/shared/schema";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { sendPreview } from "../preview.js";
import { JobTimeoutError, QueueUnavailableError, requestBeanReview } from "../queue.js";
import { noteSchema } from "./aiPrompt.js";

// "Write with AI" on a bean's Review (docs/api/analysis.md §8e): a draft from
// the brews the caller picks. The request waits for it; nothing is saved
// until the person saves the bean.
interface ReviewParams {
  workspaceId: string;
  beanId: string;
}

const draftSchema = z
  .object({
    // null: every brew, with or without a brewer. Unset: the workspace's.
    brewerIds: z.array(z.uuid()).min(1).max(200).nullable().optional(),
    maxBrews: z.number().int().min(1).max(MAX_REVIEW_BREWS).optional(),
    ratedOnly: z.boolean().optional(),
    note: noteSchema, // a one-off note (docs/api/auth.md §1c)
  })
  .strict();

// Mounted at /api/workspaces/:workspaceId/beans/:beanId/review-draft
export const beanReviewRouter = Router({ mergeParams: true });
beanReviewRouter.use(requireAuth);

// The job as it would run, or null once an error is sent. Shared by POST and
// the preview, so they can't differ.
async function resolveRequest(req: Request<ReviewParams>, res: Response): Promise<BeanReviewJobData | null> {
  const { workspaceId, beanId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return null;
  const body = parseBody(draftSchema, req, res);
  if (!body) return null;

  const [row] = await db
    .select({ settings: workspaces.settings })
    .from(beans)
    .innerJoin(workspaces, eq(beans.workspaceId, workspaces.id))
    .where(and(eq(beans.id, beanId), eq(beans.workspaceId, workspaceId)));
  if (!row) {
    sendError(res, 404, "Bean not found");
    return null;
  }
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, row.settings ?? null);
  if (!settings.beanReviews) {
    sendError(res, 403, "Writing bean reviews with AI is turned off for this workspace (Settings → AI)");
    return null;
  }

  // Unset, the workspace's list, or every brew when none of it applies.
  let brewerIds = body.brewerIds === undefined ? (settings.beanReviewBrewers === "all" ? null : settings.beanReviewBrewers) : body.brewerIds;
  if (brewerIds && body.brewerIds) {
    const known = await db.select({ id: brewers.id }).from(brewers).where(and(eq(brewers.workspaceId, workspaceId), inArray(brewers.id, brewerIds)));
    if (known.length !== brewerIds.length) {
      sendError(res, 400, "brewerIds: not a brewer in this workspace");
      return null;
    }
  }
  const ratedOnly = (body.ratedOnly ?? settings.beanReviewRatedOnly) || settings.aiHidden.includes("unratedHistory");
  const matching = (ids: string[] | null) =>
    db
      .select({ n: count() })
      .from(brewLogs)
      .where(
        and(
          eq(brewLogs.beanId, beanId),
          eq(brewLogs.steeping, false),
          ids ? inArray(brewLogs.brewerId, ids) : undefined,
          ratedOnly ? or(isNotNull(brewLogs.rating), isNotNull(brewLogs.drinkRating)) : undefined,
        ),
      );
  let found = (await matching(brewerIds))[0]?.n ?? 0;
  if (found === 0 && brewerIds && body.brewerIds === undefined) {
    brewerIds = null;
    found = (await matching(null))[0]?.n ?? 0;
  }
  if (found === 0) {
    sendError(res, 409, "No brews match these choices");
    return null;
  }
  return { beanId, brewerIds, maxBrews: body.maxBrews ?? settings.beanReviewMaxBrews, ratedOnly, requestedBy: userId, note: body.note || null };
}

beanReviewRouter.post("/", async (req: Request<ReviewParams>, res: Response<BeanReviewResult>) => {
  const job = await resolveRequest(req, res);
  if (!job) return;
  try {
    const result = await requestBeanReview(job);
    if (!result) {
      sendError(res, 409, "No brews match these choices"); // gone since the check
      return;
    }
    res.json(result);
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      console.error("Could not queue a bean review:", err.message);
      sendError(res, 503, "Reviews are temporarily unavailable. Try again shortly.");
      return;
    }
    if (err instanceof JobTimeoutError) {
      sendError(res, 504, "The review wasn't written in time. Try again shortly.");
      return;
    }
    // The worker's error (the AI provider's, or a reply that didn't parse).
    console.error("Bean review failed:", err instanceof Error ? err.message : err);
    sendError(res, 502, "The AI couldn't write the review. Try again shortly.");
  }
});

// What asking would send (docs/api/analysis.md §8d), without asking.
beanReviewRouter.post("/preview", async (req: Request<ReviewParams>, res: Response<{ request: AiRequest | null }>) => {
  const review = await resolveRequest(req, res);
  if (!review) return;
  await sendPreview(res, { kind: "beanReview", review });
});

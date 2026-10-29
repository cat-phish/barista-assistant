import { LABEL_MAX_IMAGES, type LabelReadResult } from "@barista/shared/jobs";
import { beanProcesses, DEFAULT_WORKSPACE_SETTINGS, withDefaults, workspaces } from "@barista/shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { processPhoto } from "../photos.js";
import { JobTimeoutError, QueueUnavailableError, readBeanLabel } from "../queue.js";

// docs/api/bean-label.md §4d: reads a bean's label from photos sent with the
// request (a new bean's aren't on the server yet). Nothing is stored. The
// photos are base64 in JSON, so app.ts gives this path a bigger body limit.
export const LABEL_BODY_PATH = /^\/api\/workspaces\/[^/]+\/bean-label$/;
// Each photo, decoded: the browser sends them at most 1024 px.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

interface WorkspaceParams {
  workspaceId: string;
}

const readSchema = z
  .object({
    images: z
      .array(z.base64().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4, "a photo is too large"))
      .min(1)
      .max(LABEL_MAX_IMAGES),
    // Then look it up on the web (needs labelWebLookup); website: the form's.
    web: z.boolean().optional(),
    website: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

// Mounted at /api/workspaces/:workspaceId/bean-label
export const beanLabelRouter = Router({ mergeParams: true });
beanLabelRouter.use(requireAuth);

beanLabelRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<LabelReadResult>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null);
  if (!settings.readLabels) {
    sendError(res, 403, "Reading bean labels is turned off for this workspace (Settings → AI)");
    return;
  }
  const body = parseBody(readSchema, req, res);
  if (!body) return;
  if (body.web && !settings.labelWebLookup) {
    sendError(res, 403, "Looking beans up on the web is turned off for this workspace (Settings → AI)");
    return;
  }

  // Re-encoded as stored photos are: upright, no metadata, at most 1024 px.
  const images: string[] = [];
  for (const b64 of body.images) {
    const photo = await processPhoto(Buffer.from(b64, "base64"));
    if (!photo) {
      sendError(res, 400, `Photo ${images.length + 1} isn't an image that can be read`);
      return;
    }
    images.push(photo.data.toString("base64"));
  }
  const processes = (
    await db
      .select({ name: beanProcesses.name })
      .from(beanProcesses)
      .where(and(eq(beanProcesses.workspaceId, workspaceId), eq(beanProcesses.hidden, false)))
      .orderBy(asc(beanProcesses.position), asc(beanProcesses.name))
  ).map((p) => p.name);

  try {
    res.json(await readBeanLabel({ images, processes, requestedBy: authedUserId(req), web: body.web ?? false, website: body.website || null }));
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      console.error("Could not queue a label read:", err.message);
      sendError(res, 503, "Reading labels is temporarily unavailable. Try again shortly.");
      return;
    }
    if (err instanceof JobTimeoutError) {
      sendError(res, 504, "The label wasn't read in time. Try again shortly.");
      return;
    }
    // The worker's error (the AI provider's, or a reply that didn't parse).
    console.error("Label read failed:", err instanceof Error ? err.message : err);
    sendError(res, 502, "The AI couldn't read the label. Try again, or with other photos.");
  }
});

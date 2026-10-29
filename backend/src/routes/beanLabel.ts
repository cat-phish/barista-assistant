import { EMPTY_LABEL_FIELDS, LABEL_MAX_IMAGES, type LabelFields, type LabelReadResult, type LabelWebResult } from "@barista/shared/jobs";
import { BLEND_TYPES, beanProcesses, DEFAULT_WORKSPACE_SETTINGS, DETAILED_ROAST_LEVELS, ROAST_LEVELS, ROAST_TYPES, withDefaults, workspaces, type WorkspaceSettings } from "@barista/shared/schema";
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
// request (a new bean's aren't on the server yet), and, as its own request,
// looks a bean up on the web from what's known of it. Nothing is stored. The
// photos are base64 in JSON, so app.ts gives that path a bigger body limit.
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
  })
  .strict();

// What's known of the bean, from a label read or the form: the label's
// fields, without one bag's roast date and batch number. Blank is null.
const known = z.string().trim().max(500).nullable().optional().transform((v) => v || null);
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional().transform((v) => v ?? null);
const lookUpSchema = z
  .object({
    fields: z
      .object({
        roasterName: known,
        beanName: known,
        processName: known,
        processText: known,
        country: known,
        region: known,
        producer: known,
        altitudeMasl: optional(z.number().int().min(0).max(10_000)),
        flavorProfile: known,
        detailedRoastLevel: optional(z.enum(DETAILED_ROAST_LEVELS)),
        roastLevel: optional(z.enum(ROAST_LEVELS)),
        roastType: optional(z.enum(ROAST_TYPES)),
        blendType: optional(z.enum(BLEND_TYPES)),
        decaf: optional(z.literal(true)),
        bagWeightGrams: optional(z.number().positive().max(100_000)),
        website: known,
      })
      .strict()
      .refine((f) => f.roasterName || f.beanName, "Give the roaster or the coffee's name to look it up"),
  })
  .strict();

// Mounted at /api/workspaces/:workspaceId/bean-label
export const beanLabelRouter = Router({ mergeParams: true });
beanLabelRouter.use(requireAuth);

// Who may, and what the workspace allows (403 otherwise); its settings and
// visible process names, or null when an answer was sent.
async function labelContext(
  req: Request<WorkspaceParams>,
  res: Response,
  web: boolean,
): Promise<{ settings: WorkspaceSettings; processes: string[] } | null> {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return null;
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null);
  if (!settings.readLabels) {
    sendError(res, 403, "Reading bean labels is turned off for this workspace (Settings → AI)");
    return null;
  }
  if (web && !settings.labelWebLookup) {
    sendError(res, 403, "Looking beans up on the web is turned off for this workspace (Settings → AI)");
    return null;
  }
  const processes = (
    await db
      .select({ name: beanProcesses.name })
      .from(beanProcesses)
      .where(and(eq(beanProcesses.workspaceId, workspaceId), eq(beanProcesses.hidden, false)))
      .orderBy(asc(beanProcesses.position), asc(beanProcesses.name))
  ).map((p) => p.name);
  return { settings, processes };
}

// The queue's and the worker's failures, as the route answers them.
function sendJobError(res: Response, err: unknown, what: "label" | "web"): void {
  if (err instanceof QueueUnavailableError) {
    console.error("Could not queue a label read:", err.message);
    sendError(res, 503, "Reading labels is temporarily unavailable. Try again shortly.");
    return;
  }
  if (err instanceof JobTimeoutError) {
    sendError(res, 504, what === "label" ? "The label wasn't read in time. Try again shortly." : "The web lookup didn't finish in time. Try again shortly.");
    return;
  }
  // The worker's error (the AI provider's, or a reply that didn't parse).
  console.error(what === "label" ? "Label read failed:" : "Web lookup failed:", err instanceof Error ? err.message : err);
  sendError(res, 502, what === "label" ? "The AI couldn't read the label. Try again, or with other photos." : "The web lookup didn't work. Try again shortly.");
}

beanLabelRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<LabelReadResult>) => {
  const context = await labelContext(req, res, false);
  if (!context) return;
  const body = parseBody(readSchema, req, res);
  if (!body) return;

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
  try {
    res.json(await readBeanLabel({ images, processes: context.processes, requestedBy: authedUserId(req) }));
  } catch (err) {
    sendJobError(res, err, "label");
  }
});

// The web lookup on its own: after a label read, again when it found
// nothing, or from what was typed in, without photos.
beanLabelRouter.post("/web", async (req: Request<WorkspaceParams>, res: Response<LabelWebResult>) => {
  const context = await labelContext(req, res, true);
  if (!context) return;
  const body = parseBody(lookUpSchema, req, res);
  if (!body) return;
  const lookUp: LabelFields = { ...EMPTY_LABEL_FIELDS, ...body.fields };
  try {
    const { web, webSources, webError } = await readBeanLabel({
      images: [],
      processes: context.processes,
      requestedBy: authedUserId(req),
      lookUp,
      webContext: context.settings.labelWebContext,
    });
    res.json({ web, webSources, webError });
  } catch (err) {
    sendJobError(res, err, "web");
  }
});

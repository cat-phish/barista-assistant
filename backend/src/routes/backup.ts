import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { workspaces } from "@barista/shared/schema";
import { z } from "zod";
import { requireMembership } from "../auth/membership.js";
import { db } from "../db.js";
import { buildBackup, checkBackup, restoreBackup, type BackupFile } from "../backup.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { SLUG_PATTERN } from "../validation.js";

// docs/api/backup.md §2b. Mounted at /api/workspaces, before the workspaces
// router. The restore body can be large: app.ts gives this path a bigger
// JSON limit (RESTORE_PATH).
export const RESTORE_PATH = "/api/workspaces/restore";

interface WorkspaceParams {
  workspaceId: string;
}

const restoreSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    slug: z.string().regex(SLUG_PATTERN, "must be 3-64 lowercase letters, digits or hyphens"),
    backup: z.unknown(),
  })
  .strict();

export const backupRouter = Router();
backupRouter.use(requireAuth);

// The whole workspace as one JSON file. Owners only: it holds everyone's brews.
backupRouter.get("/:workspaceId/backup", async (req: Request<WorkspaceParams>, res: Response<BackupFile>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const backup = await buildBackup(workspaceId);
  const day = backup.exportedAt.slice(0, 10);
  res.setHeader("Content-Disposition", `attachment; filename="${backup.workspace.slug}-backup-${day}.json"`);
  res.json(backup);
});

// A backup into a new workspace, owned by the caller (any signed-in person).
// Nothing is written unless the whole file checks out.
backupRouter.post("/restore", async (req: Request, res: Response<{ workspaceId: string }>) => {
  const body = parseBody(restoreSchema, req, res);
  if (!body) return;
  const [taken] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, body.slug));
  if (taken) {
    sendError(res, 409, "Slug already taken");
    return;
  }
  const checked = checkBackup(body.backup);
  if (!checked.ok) {
    sendError(res, 400, checked.error);
    return;
  }
  try {
    const workspaceId = await restoreBackup(checked.file, { name: body.name, slug: body.slug, ownerId: authedUserId(req) });
    res.status(201).json({ workspaceId });
  } catch (err) {
    if (!isDuplicateEntryError(err)) throw err;
    // The slug was free a moment ago, so this is (almost always) the file
    // repeating a name a workspace keeps unique, e.g. two grinders "C40".
    sendError(res, 409, "The backup repeats a name that must be unique in a workspace (or the slug was just taken)");
  }
});

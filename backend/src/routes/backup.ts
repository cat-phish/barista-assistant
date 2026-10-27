import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { workspaces } from "@barista/shared/schema";
import { z } from "zod";
import { requireMembership } from "../auth/membership.js";
import { db } from "../db.js";
import { buildBackup, checkBackup, restoreBackup, type BackupFile } from "../backup.js";
import { buildExport, fileLists, LISTS, previewImport, runImport, type ExportFile, type ImportSummary } from "../listImport.js";
import { beansCsv, brewLogsCsv, CSV_LISTS } from "../csv.js";
import { isDuplicateEntryError, parseBody, parseQuery, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { SLUG_PATTERN } from "../validation.js";

// docs/api/backup.md §2b. Mounted at /api/workspaces, before the workspaces
// router. Restore and import bodies can be large: app.ts gives these paths
// a bigger JSON limit (LARGE_BODY_PATH).
export const LARGE_BODY_PATH = /^\/api\/workspaces\/(restore|[^/]+\/import(\/preview)?)$/;

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

// ?aiRequests=true also includes what was sent to the AI (it's large).
const backupQuery = z.object({ aiRequests: z.enum(["true", "false"]).optional() }).strict();

// The whole workspace as one JSON file. Owners only: it holds everyone's brews.
backupRouter.get("/:workspaceId/backup", async (req: Request<WorkspaceParams>, res: Response<BackupFile>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const query = parseQuery(backupQuery, req, res);
  if (!query) return;
  const backup = await buildBackup(workspaceId, { aiRequests: query.aiRequests === "true" });
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

// ---- By list (docs/api/backup.md §2b, "By list") -----------------------------

const listSchema = z.enum(LISTS);
const exportSchema = z
  .object({
    lists: z.array(listSchema).min(1).refine((l) => new Set(l).size === l.length, "each list once"),
    // Only these items of a list (from a list page's select mode).
    ids: z.partialRecord(listSchema, z.array(z.uuid()).max(5000)).optional(),
    aiRequests: z.boolean().optional(), // include what was sent to the AI
  })
  .strict();
const importSchema = z
  .object({
    file: z.unknown(),
    lists: z.array(listSchema).min(1).optional(), // default: what the file offers
    duplicates: z.enum(["existing", "copy"]).default("existing"),
  })
  .strict();

// Lists, with everything their items need. Owners only, like a backup.
backupRouter.post("/:workspaceId/export", async (req: Request<WorkspaceParams>, res: Response<ExportFile>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const body = parseBody(exportSchema, req, res);
  if (!body) return;
  const file = await buildExport(workspaceId, body.lists, body.ids, { aiRequests: body.aiRequests });
  res.setHeader("Content-Disposition", `attachment; filename="${file.workspace.slug}-${body.lists.join("-")}-${file.exportedAt.slice(0, 10)}.json"`);
  res.json(file);
});

// What an import would add and what it would match, without writing.
backupRouter.post("/:workspaceId/import/preview", async (req: Request<WorkspaceParams>, res: Response<ImportSummary & { lists: string[] }>) => {
  const parsed = await importRequest(req, res);
  if (!parsed) return;
  res.json({ ...(await previewImport(parsed.workspaceId, parsed.userId, parsed.file, parsed.lists, parsed.duplicates)), lists: parsed.lists });
});

backupRouter.post("/:workspaceId/import", async (req: Request<WorkspaceParams>, res: Response<ImportSummary & { lists: string[] }>) => {
  const parsed = await importRequest(req, res);
  if (!parsed) return;
  try {
    res.json({ ...(await runImport(parsed.workspaceId, parsed.userId, parsed.file, parsed.lists, parsed.duplicates)), lists: parsed.lists });
  } catch (err) {
    if (!isDuplicateEntryError(err)) throw err;
    sendError(res, 409, "The file repeats a name that must be unique in a workspace");
  }
});

async function importRequest(req: Request<WorkspaceParams>, res: Response) {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, ["owner"]))) return null;
  const body = parseBody(importSchema, req, res);
  if (!body) return null;
  const checked = checkBackup(body.file);
  if (!checked.ok) {
    sendError(res, 400, checked.error);
    return null;
  }
  const offered = fileLists(checked.file);
  const lists = body.lists ?? offered;
  const missing = lists.find((l) => !offered.includes(l));
  if (missing) {
    sendError(res, 400, `lists: the file has no ${missing}`);
    return null;
  }
  return { workspaceId, userId, file: checked.file, lists, duplicates: body.duplicates };
}

// ---- CSV (docs/api/backup.md §2b, "CSV") --------------------------------------

const csvParams = z.object({ list: z.enum(CSV_LISTS) });
const CSV_NAMES = { brew_logs: "journal", beans: "beans" } as const;

// The journal or the beans for a spreadsheet. Owners only, like a backup.
backupRouter.get("/:workspaceId/csv/:list", async (req: Request<WorkspaceParams & { list: string }>, res: Response) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const parsed = csvParams.safeParse(req.params);
  if (!parsed.success) {
    sendError(res, 404, "Not found");
    return;
  }
  const list = parsed.data.list;
  const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const csv = list === "beans" ? await beansCsv(workspaceId) : await brewLogsCsv(workspaceId);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${ws?.slug ?? "workspace"}-${CSV_NAMES[list]}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { DB_BACKUP_FILE } from "@barista/shared/jobs";
import { BACKUP_FREQUENCIES, users, type BackupSettings, type BackupStatus } from "@barista/shared/schema";
import { backupDir, backupTimezone, isAdminEmail } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { enqueueBackupNow, nextBackupAt, syncBackupSchedule } from "../queue.js";
import { getBackupSettings, getBackupStatus, saveBackupSettings } from "../serverSettings.js";

// docs/api/server.md §10: server administration, for the admins named in
// ADMIN_EMAILS. Mounted at /api/server.

export interface BackupFileInfo {
  name: string;
  bytes: number;
  createdAt: string;
}
export interface ServerBackupsResponse {
  settings: BackupSettings;
  status: BackupStatus;
  timezone: string; // the zone the hour is in
  nextRunAt: string | null; // the next scheduled dump, null when off
  files: BackupFileInfo[]; // newest first
}

const settingsSchema = z
  .object({
    frequency: z.enum(BACKUP_FREQUENCIES),
    hour: z.number().int().min(0).max(23),
    weekday: z.number().int().min(0).max(6),
    keep: z.number().int().min(1).max(90),
  })
  .strict();

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, authedUserId(req)));
  if (!user || !isAdminEmail(user.email)) {
    sendError(res, 403, "Only server admins can do this");
    return;
  }
  next();
}

// The dumps in the backup folder, newest first; none if it doesn't exist.
async function listFiles(): Promise<BackupFileInfo[]> {
  let names: string[];
  try {
    names = await readdir(backupDir());
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((n) => DB_BACKUP_FILE.test(n))
      .map(async (name) => {
        const s = await stat(path.join(backupDir(), name));
        return { name, bytes: s.size, createdAt: s.mtime.toISOString() };
      }),
  );
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

async function overview(): Promise<ServerBackupsResponse> {
  const [settings, status, files, nextRunAt] = await Promise.all([getBackupSettings(), getBackupStatus(), listFiles(), nextBackupAt().catch(() => null)]);
  return { settings, status, timezone: backupTimezone(), nextRunAt, files };
}

export const serverRouter = Router();
serverRouter.use(requireAuth, requireAdmin);

serverRouter.get("/backups", async (_req: Request, res: Response<ServerBackupsResponse>) => {
  res.json(await overview());
});

// Saved, then the schedule follows (created, moved or removed).
serverRouter.put("/backups/settings", async (req: Request, res: Response<ServerBackupsResponse>) => {
  const body = parseBody(settingsSchema, req, res);
  if (!body) return;
  await saveBackupSettings(body);
  try {
    await syncBackupSchedule(body);
  } catch (err) {
    console.error("Backup schedule not updated:", err instanceof Error ? err.message : err);
    sendError(res, 503, "Saved, but the schedule couldn't be updated (is Redis running?). Save again to retry.");
    return;
  }
  res.json(await overview());
});

// "Back up now": a dump outside the schedule, run by the worker.
serverRouter.post("/backups/run", async (_req: Request, res: Response<{ queued: true }>) => {
  try {
    await enqueueBackupNow();
  } catch (err) {
    console.error("Backup not queued:", err instanceof Error ? err.message : err);
    sendError(res, 503, "The backup couldn't be queued (is Redis running?)");
    return;
  }
  res.status(202).json({ queued: true });
});

// One dump file. Only names the worker writes, straight from the folder.
serverRouter.get("/backups/files/:name", async (req: Request<{ name: string }>, res: Response) => {
  const { name } = req.params;
  if (!DB_BACKUP_FILE.test(name)) {
    sendError(res, 404, "Backup not found");
    return;
  }
  const file = path.join(backupDir(), name);
  try {
    await stat(file);
  } catch {
    sendError(res, 404, "Backup not found");
    return;
  }
  res.download(file, name);
});

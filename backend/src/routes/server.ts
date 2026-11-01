import { AI_PROVIDERS, DEFAULT_SERVER_AI, lastFour, type AiEnvStatus, type ServerAiConfig } from "@barista/shared/aiConfig";
import { encryptSecret } from "@barista/shared/secrets";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { aiKey } from "./aiConfig.js";
import { sendAiCheck } from "../aiConfig.js";
import { DB_BACKUP_FILE } from "@barista/shared/jobs";
import { BACKUP_FREQUENCIES, users, type BackupSettings, type BackupStatus } from "@barista/shared/schema";
import { verifyPassword } from "../auth/password.js";
import { backupDir, backupDownloadsEnabled, backupTimezone, config } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { loginLimiter } from "./auth.js";
import { enqueueBackupNow, nextBackupAt, syncBackupSchedule } from "../queue.js";
import { getAiEnvStatus, getServerAi, saveServerAi, getBackupSettings, getBackupStatus, saveBackupSettings } from "../serverSettings.js";

// docs/api/server.md §10: server administration, for server admins (granted
// on the server: npm run admin -- grant <email>). Mounted at /api/server.

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
  downloadsEnabled: boolean; // false: dumps stay on the server (BACKUP_DOWNLOADS)
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
  const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, authedUserId(req)));
  if (!user?.isAdmin) {
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
  return { settings, status, timezone: backupTimezone(), nextRunAt, files, downloadsEnabled: backupDownloadsEnabled() };
}

export const serverRouter = Router();
serverRouter.use(requireAuth, requireAdmin);

// The AI offered to workspaces without their own key (docs/api/server.md §10b).
// The key is write-only; apiKey left out keeps the one saved.
const serverAiSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS),
    apiKey: aiKey.optional(),
    baseUrl: z.string().trim().url().max(500).regex(/^https?:\/\//i, "must start with http:// or https://").nullable().optional(),
    model: z.string().trim().min(1).max(100).nullable().optional(),
    visionModel: z.string().trim().min(1).max(100).nullable().optional(),
    webModel: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict();

export interface ServerAiResponse extends Omit<ServerAiConfig, "apiKeyEncrypted" | "apiKeyLast4"> {
  keyLast4: string | null;
  env: AiEnvStatus;
  canSaveKeys: boolean;
}

async function serverAiView(): Promise<ServerAiResponse> {
  const [{ apiKeyEncrypted: _key, apiKeyLast4, ...rest }, env] = await Promise.all([getServerAi(), getAiEnvStatus()]);
  return { ...rest, keyLast4: apiKeyLast4, env, canSaveKeys: config.aiConfigSecret !== null };
}

serverRouter.get("/ai", async (_req: Request, res: Response<ServerAiResponse>) => {
  res.json(await serverAiView());
});

serverRouter.put("/ai", async (req: Request, res: Response<ServerAiResponse>) => {
  const body = parseBody(serverAiSchema, req, res);
  if (!body) return;
  if (body.apiKey && !config.aiConfigSecret) {
    sendError(res, 409, "Keys can't be saved until AI_CONFIG_SECRET is set on the server");
    return;
  }
  const saved = await getServerAi();
  const apiKeyEncrypted = body.apiKey ? encryptSecret(body.apiKey, config.aiConfigSecret!) : saved.apiKeyEncrypted;
  if (apiKeyEncrypted && !body.model) {
    sendError(res, 400, "Choose a model");
    return;
  }
  await saveServerAi({
    enabled: body.enabled,
    provider: body.provider,
    apiKeyEncrypted,
    apiKeyLast4: body.apiKey ? lastFour(body.apiKey) : saved.apiKeyLast4,
    baseUrl: body.baseUrl ?? null,
    model: body.model ?? null,
    visionModel: body.visionModel ?? null,
    webModel: body.webModel ?? null,
  });
  res.json(await serverAiView());
});

// Forgets the key and models; whether the server's AI is offered stays.
serverRouter.delete("/ai", async (_req: Request, res: Response<ServerAiResponse>) => {
  const { enabled } = await getServerAi();
  await saveServerAi({ ...DEFAULT_SERVER_AI, enabled });
  res.json(await serverAiView());
});

for (const action of ["models", "test"] as const) {
  serverRouter.post(`/ai/${action}`, async (_req: Request, res: Response) => {
    if (!(await getServerAi()).apiKeyEncrypted) {
      sendError(res, 409, "Save a key first");
      return;
    }
    await sendAiCheck(res, { workspaceId: null, action });
  });
}

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

// One dump file, after the admin enters their password again: a dump holds
// every account's data, so a stolen session alone isn't enough. Only names
// the worker writes, straight from the folder. Rate-limited with logins.
const downloadSchema = z.object({ password: z.string().min(1).max(256) }).strict();
serverRouter.post("/backups/files/:name", loginLimiter, async (req: Request<{ name: string }>, res: Response) => {
  if (!backupDownloadsEnabled()) {
    sendError(res, 403, "Downloads are turned off on this server: copy backups from its backups folder");
    return;
  }
  const body = parseBody(downloadSchema, req, res);
  if (!body) return;
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, authedUserId(req)));
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    sendError(res, 401, "Wrong password");
    return;
  }
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

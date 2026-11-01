// Server-wide settings (docs/api/server.md §10), one JSON value per key in
// server_settings. Missing keys mean the defaults.
import { AI_ENV_KEY, AI_SERVER_KEY, DEFAULT_AI_ENV, DEFAULT_SERVER_AI, type AiEnvStatus, type ServerAiConfig } from "@barista/shared/aiConfig";
import { eq } from "drizzle-orm";
import { DEFAULT_BACKUP_SETTINGS, serverSettings, type BackupSettings, type BackupStatus } from "@barista/shared/schema";
import { db } from "./db.js";

const EMPTY_STATUS: BackupStatus = { lastRunAt: null, lastFile: null, lastBytes: null, lastError: null };

async function read<T extends object>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, key));
  const value = row?.value;
  return value && typeof value === "object" ? { ...fallback, ...(value as Partial<T>) } : { ...fallback };
}

export const getBackupSettings = (): Promise<BackupSettings> => read("backups", DEFAULT_BACKUP_SETTINGS);
export const getBackupStatus = (): Promise<BackupStatus> => read("backups_status", EMPTY_STATUS);

export async function saveBackupSettings(settings: BackupSettings): Promise<void> {
  await db.insert(serverSettings).values({ key: "backups", value: settings }).onDuplicateKeyUpdate({ set: { value: settings } });
}

export const getServerAi = (): Promise<ServerAiConfig> => read(AI_SERVER_KEY, DEFAULT_SERVER_AI);
export const getAiEnvStatus = (): Promise<AiEnvStatus> => read(AI_ENV_KEY, DEFAULT_AI_ENV);

export async function saveServerAi(value: ServerAiConfig): Promise<void> {
  await db.insert(serverSettings).values({ key: AI_SERVER_KEY, value }).onDuplicateKeyUpdate({ set: { value } });
}

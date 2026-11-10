import type { ServerChatLimits } from './chats';
import { api } from './client';

// docs/api/server.md §10: server administration (admins only).
export type BackupFrequency = 'off' | 'daily' | 'weekly';
export interface BackupSettings {
  frequency: BackupFrequency;
  hour: number; // 0-23, in `timezone`
  weekday: number; // 0-6, Sunday first
  keep: number; // 1-90
}
export interface ServerBackups {
  settings: BackupSettings;
  status: { lastRunAt: string | null; lastFile: string | null; lastBytes: number | null; lastError: string | null };
  timezone: string;
  nextRunAt: string | null;
  files: Array<{ name: string; bytes: number; createdAt: string }>;
  downloadsEnabled: boolean; // false: dumps stay on the server (BACKUP_DOWNLOADS)
}

// docs/api/chat.md §12.
export type ServerChatInput = Omit<ServerChatLimits, 'maxDaysSetAt'>;
export interface ServerChatPreview {
  chats: number;
  people: number;
  pinned: number; // of chats
  pinnedLater: number; // pinned chats past the age limit, kept a week
  pinnedLaterOn: string | null;
}
export interface ServerChat {
  limits: ServerChatLimits;
  usedBytes: number;
}

export const AI_PROVIDERS = { openai: 'OpenAI or compatible', anthropic: 'Anthropic' } as const;
export type AiProvider = keyof typeof AI_PROVIDERS;
export interface AiCheck {
  ok: boolean;
  models: string[];
  error: string | null;
}
// docs/api/server.md §10b: what workspaces without their own key use.
export interface ServerAi {
  enabled: boolean;
  provider: AiProvider;
  keyLast4: string | null;
  baseUrl: string | null;
  model: string | null;
  visionModel: string | null;
  webModel: string | null;
  env: { configured: boolean; model: string | null };
  canSaveKeys: boolean;
}
export interface ServerAiInput {
  enabled: boolean;
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
  visionModel?: string | null;
  webModel?: string | null;
}

export const serverApi = {
  chat: () => api.get<ServerChat>('/api/server/chat'),
  saveChat: (limits: ServerChatInput) => api.put<ServerChat>('/api/server/chat', limits),
  // What saving these would delete (docs/api/chat.md §12, "Saving limits").
  previewChat: (limits: ServerChatInput) => api.post<ServerChatPreview>('/api/server/chat/preview', limits),
  purgeChats: () => api.delete('/api/server/chats'),
  ai: () => api.get<ServerAi>('/api/server/ai'),
  saveAi: (input: ServerAiInput) => api.put<ServerAi>('/api/server/ai', input),
  removeAi: () => api.delete<ServerAi>('/api/server/ai'),
  aiModels: () => api.post<AiCheck>('/api/server/ai/models'),
  testAi: () => api.post<AiCheck>('/api/server/ai/test'),
  backups: () => api.get<ServerBackups>('/api/server/backups'),
  saveBackupSettings: (settings: BackupSettings) => api.put<ServerBackups>('/api/server/backups/settings', settings),
  backUpNow: () => api.post<{ queued: true }>('/api/server/backups/run'),
  // The admin's password again: a dump holds every account's data.
  backupFile: (name: string, password: string) => api.file(`/api/server/backups/files/${encodeURIComponent(name)}`, { password }),
};

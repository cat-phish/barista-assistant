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
}

export const serverApi = {
  backups: () => api.get<ServerBackups>('/api/server/backups'),
  saveBackupSettings: (settings: BackupSettings) => api.put<ServerBackups>('/api/server/backups/settings', settings),
  backUpNow: () => api.post<{ queued: true }>('/api/server/backups/run'),
  backupFile: (name: string) => api.file(`/api/server/backups/files/${encodeURIComponent(name)}`),
};

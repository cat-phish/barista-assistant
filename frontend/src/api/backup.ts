import { api } from './client';

// docs/api/backup.md §2b: the whole workspace as one JSON file.
export interface BackupFile {
  format: 'barista-backup';
  version: number;
  exportedAt: string;
  workspace: { name: string; slug: string };
  tables: Record<string, unknown[]>;
}

export const backupApi = {
  // Owners only.
  download: (workspaceId: string) => api.get<BackupFile>(`/api/workspaces/${workspaceId}/backup`),
  // Into a new workspace the caller owns; 409 when the slug is taken, 400
  // with the first problem when the file doesn't check out.
  restore: (name: string, slug: string, backup: BackupFile) =>
    api.post<{ workspaceId: string }>('/api/workspaces/restore', { name, slug, backup }),
};

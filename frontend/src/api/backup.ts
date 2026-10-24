import { api } from './client';

// docs/api/backup.md §2b: the whole workspace as one JSON file.
export interface BackupFile {
  format: 'barista-backup';
  version: number;
  exportedAt: string;
  workspace: { name: string; slug: string };
  tables: Record<string, unknown[]>;
  // An export (By list): which lists it was made for.
  scope?: 'lists';
  lists?: ListName[];
}

// What can be exported and imported on its own (docs/api/backup.md §2b, "By list").
export const LISTS = ['beans', 'recipes', 'drinks', 'ingredients', 'brewers', 'grinders', 'water_profiles', 'prep_tools', 'brew_problems', 'brew_logs'] as const;
export type ListName = (typeof LISTS)[number];
export type Duplicates = 'existing' | 'copy';

// What an import adds and what it finds already there, per table.
export interface ImportSummary {
  lists: ListName[]; // the lists it covers (by default, all the file offers)
  tables: Array<{ table: string; added: string[]; matched: Array<{ name: string; existing: string }> }>;
  details: Record<string, number>; // rows that come along: steps, freezes, marks…
}

export const backupApi = {
  // Owners only.
  download: (workspaceId: string) => api.get<BackupFile>(`/api/workspaces/${workspaceId}/backup`),
  // Into a new workspace the caller owns; 409 when the slug is taken, 400
  // with the first problem when the file doesn't check out.
  restore: (name: string, slug: string, backup: BackupFile) =>
    api.post<{ workspaceId: string }>('/api/workspaces/restore', { name, slug, backup }),
  // Lists (or, with ids, some of their items) with what they need. Owners only.
  exportLists: (workspaceId: string, lists: ListName[], ids?: Partial<Record<ListName, string[]>>) =>
    api.post<BackupFile & { scope: 'lists'; lists: ListName[] }>(`/api/workspaces/${workspaceId}/export`, { lists, ...(ids ? { ids } : {}) }),
  previewImport: (workspaceId: string, file: BackupFile, duplicates: Duplicates, lists?: ListName[]) =>
    api.post<ImportSummary>(`/api/workspaces/${workspaceId}/import/preview`, { file, duplicates, ...(lists ? { lists } : {}) }),
  // The journal or the beans for a spreadsheet (names, not IDs). Owners only.
  csv: (workspaceId: string, list: 'brew_logs' | 'beans') => api.file(`/api/workspaces/${workspaceId}/csv/${list}`),
  importLists: (workspaceId: string, file: BackupFile, duplicates: Duplicates, lists: ListName[]) =>
    api.post<ImportSummary>(`/api/workspaces/${workspaceId}/import`, { file, duplicates, lists }),
};

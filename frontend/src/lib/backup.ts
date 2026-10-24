// Reading a backup file before restoring it (docs/api/backup.md §2b), and
// saving one. Unit-tested in backup.test.ts.
import type { BackupFile } from '../api/backup';

// What the preview counts, by the file's table names.
const COUNTED: Array<[table: string, one: string, many: string]> = [
  ['brew_logs', 'brew', 'brews'],
  ['beans', 'bean', 'beans'],
  ['recipes', 'recipe', 'recipes'],
  ['drinks', 'drink', 'drinks'],
  ['ingredients', 'ingredient', 'ingredients'],
  ['brewers', 'brewer', 'brewers'],
  ['grinders', 'grinder', 'grinders'],
  ['water_profiles', 'water profile', 'water profiles'],
  ['menu_items', 'menu item', 'menu items'],
];

export type ReadBackup = { ok: true; file: BackupFile } | { ok: false; error: string };

export function readBackup(text: string): ReadBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a backup (it isn't JSON)." };
  }
  const file = data as Partial<BackupFile> | null;
  if (!file || file.format !== 'barista-backup' || typeof file.tables !== 'object' || !file.workspace) {
    return { ok: false, error: "That file isn't a Barista backup." };
  }
  return { ok: true, file: file as BackupFile };
}

// "12 brews · 3 beans · 2 recipes", leaving out what the file has none of.
export function backupSummary(file: BackupFile): string {
  return COUNTED.flatMap(([table, one, many]) => {
    const n = file.tables[table]?.length ?? 0;
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
  }).join(' · ');
}

export const backupFileName = (file: BackupFile): string => `${file.workspace.slug}-backup-${file.exportedAt.slice(0, 10)}.json`;

// Hands the browser a file to save.
export function saveJson(fileName: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

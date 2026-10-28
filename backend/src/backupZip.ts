// A backup with its bean photos as one .zip (docs/api/backup.md §2b):
// backup.json (the usual file, with bean_photos rows) and photos/<id>.webp
// for each row. Without the zip, a JSON file has no photos.
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { buildBackup, type BackupFile, type BackupOptions, type BackupRow } from "./backup.js";
import { photoPath } from "./photos.js";

export const ZIP_BACKUP_JSON = "backup.json";
const PHOTO_ENTRY = /^photos\/([0-9a-f-]{36})\.webp$/;
// What a zip may hold once unpacked: the JSON as large as a JSON restore
// takes, and photos as large as one could be.
const MAX_JSON_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// The workspace and its photos. A row whose file is missing is left out.
export async function buildBackupZip(workspaceId: string, options: Omit<BackupOptions, "photos"> = {}): Promise<{ file: BackupFile; zip: Uint8Array }> {
  const file = await buildBackup(workspaceId, { ...options, photos: true });
  const entries: Zippable = {};
  const rows: BackupRow[] = [];
  for (const row of file.tables.bean_photos ?? []) {
    const data = await readFile(photoPath(workspaceId, row.id as string)).catch(() => null);
    if (!data) continue;
    rows.push(row);
    entries[`photos/${row.id as string}.webp`] = [data, { level: 0 }]; // WebP is compressed already
  }
  file.tables.bean_photos = rows;
  entries[ZIP_BACKUP_JSON] = new TextEncoder().encode(JSON.stringify(file));
  return { file, zip: zipSync(entries) };
}

export type ReadZip = { ok: true; backup: unknown; photos: Map<string, Buffer> } | { ok: false; error: string };

// Only backup.json and photos/<id>.webp are read; anything else, or larger
// than they can be, is skipped before it's unpacked.
export function readBackupZip(data: Buffer): ReadZip {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) =>
        (f.name === ZIP_BACKUP_JSON && f.originalSize <= MAX_JSON_BYTES) || (PHOTO_ENTRY.test(f.name) && f.originalSize <= MAX_PHOTO_BYTES),
    });
  } catch {
    return { ok: false, error: "Not a zip file that can be read" };
  }
  const json = files[ZIP_BACKUP_JSON];
  if (!json) return { ok: false, error: `The zip has no ${ZIP_BACKUP_JSON}` };
  let backup: unknown;
  try {
    backup = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return { ok: false, error: `${ZIP_BACKUP_JSON} isn't valid JSON` };
  }
  const photos = new Map<string, Buffer>();
  for (const [name, bytes] of Object.entries(files)) {
    const id = PHOTO_ENTRY.exec(name)?.[1];
    if (id) photos.set(id, Buffer.from(bytes));
  }
  return { ok: true, backup, photos };
}

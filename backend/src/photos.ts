// Bean photo files (docs/api/bean-photos.md §4c): one WebP per photo at
// PHOTO_DIR/<workspaceId>/<photoId>.webp. Rows live in bean_photos; deletes
// there cascade, so whoever deletes beans or a workspace removes the files
// after the commit, and sweepOrphanPhotos catches anything left over.
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { beanPhotos, beans } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { photoDir } from "./config.js";
import { db } from "./db.js";

// One size only, big enough for the edit page; the list shows it smaller.
export const PHOTO_MAX_EDGE = 1024;
export const PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const WEBP_QUALITY = 80;

export interface ProcessedPhoto {
  data: Buffer;
  width: number;
  height: number;
}

// Upright (EXIF orientation applied), inside PHOTO_MAX_EDGE, WebP. sharp
// writes no metadata unless asked, so EXIF (GPS, camera…) is dropped.
// null if it isn't an image sharp can read.
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto | null> {
  try {
    const { data, info } = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

const workspaceDir = (workspaceId: string) => join(photoDir(), workspaceId);
export const photoPath = (workspaceId: string, photoId: string) => join(workspaceDir(workspaceId), `${photoId}.webp`);

// Written beside, then renamed, so a reader never sees half a file.
export async function writePhotoFile(workspaceId: string, photoId: string, data: Buffer): Promise<void> {
  await mkdir(workspaceDir(workspaceId), { recursive: true });
  const path = photoPath(workspaceId, photoId);
  await writeFile(`${path}.partial`, data);
  await rename(`${path}.partial`, path);
}

// Failures are logged, not thrown: the rows are already gone, and the sweep
// gets another go.
export async function removePhotoFiles(workspaceId: string, photoIds: string[]): Promise<void> {
  await Promise.all(
    photoIds.map((id) => rm(photoPath(workspaceId, id), { force: true }).catch((err: unknown) => console.error(`Photo ${id} not removed:`, err))),
  );
}
export async function removeWorkspacePhotos(workspaceId: string): Promise<void> {
  await rm(workspaceDir(workspaceId), { recursive: true, force: true }).catch((err: unknown) => console.error(`Photos of ${workspaceId} not removed:`, err));
}

// Files with no photo row (a cascade nobody cleaned up after, a crash
// mid-upload): removed. Returns how many.
export async function sweepOrphanPhotos(): Promise<number> {
  const rows = await db.select({ id: beanPhotos.id, workspaceId: beans.workspaceId }).from(beanPhotos).innerJoin(beans, eq(beanPhotos.beanId, beans.id));
  const known = new Set(rows.map((r) => `${r.workspaceId}/${r.id}.webp`));
  let removed = 0;
  const dirs = await readdir(photoDir(), { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const files = await readdir(join(photoDir(), dir.name));
    for (const file of files) {
      if (known.has(`${dir.name}/${file}`)) continue;
      await rm(join(photoDir(), dir.name, file), { force: true });
      removed++;
    }
    if (files.length > 0 && files.every((f) => !known.has(`${dir.name}/${f}`))) await rm(join(photoDir(), dir.name), { recursive: true, force: true });
  }
  return removed;
}

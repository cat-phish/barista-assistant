// Bean photo files (docs/api/bean-photos.md §4c), and the menu logo (§7b): one WebP per photo at
// PHOTO_DIR/<workspaceId>/<photoId>.webp. Rows live in bean_photos; deletes
// there cascade, so whoever deletes beans or a workspace removes the files
// after the commit, and sweepOrphanPhotos catches anything left over.
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { aiChatPhotos, beanPhotos, beans, workspaces } from "@barista/shared/schema";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
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

// Chat photos (docs/api/chat.md §12) in a folder of their own beside the
// workspaces', so the bean photo sweep leaves them to sweepChatPhotos.
const CHAT_DIR = "chats";
const chatWorkspaceDir = (workspaceId: string) => join(photoDir(), CHAT_DIR, workspaceId);
export const chatPhotoPath = (workspaceId: string, photoId: string) => join(chatWorkspaceDir(workspaceId), `${photoId}.webp`);

// Written beside, then renamed, so a reader never sees half a file.
async function writeWhole(dir: string, path: string, data: Buffer): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(`${path}.partial`, data);
  await rename(`${path}.partial`, path);
}
export const writePhotoFile = (workspaceId: string, photoId: string, data: Buffer): Promise<void> => writeWhole(workspaceDir(workspaceId), photoPath(workspaceId, photoId), data);
export const writeChatPhotoFile = (workspaceId: string, photoId: string, data: Buffer): Promise<void> => writeWhole(chatWorkspaceDir(workspaceId), chatPhotoPath(workspaceId, photoId), data);

// Failures are logged, not thrown: the rows are already gone, and the sweep
// gets another go.
export async function removePhotoFiles(workspaceId: string, photoIds: string[]): Promise<void> {
  await Promise.all(
    photoIds.map((id) => rm(photoPath(workspaceId, id), { force: true }).catch((err: unknown) => console.error(`Photo ${id} not removed:`, err))),
  );
}
export async function removeChatPhotoFiles(workspaceId: string, photoIds: string[]): Promise<void> {
  await Promise.all(
    photoIds.map((id) => rm(chatPhotoPath(workspaceId, id), { force: true }).catch((err: unknown) => console.error(`Chat photo ${id} not removed:`, err))),
  );
}
export async function removeWorkspacePhotos(workspaceId: string): Promise<void> {
  for (const dir of [workspaceDir(workspaceId), chatWorkspaceDir(workspaceId)]) {
    await rm(dir, { recursive: true, force: true }).catch((err: unknown) => console.error(`Photos of ${workspaceId} not removed:`, err));
  }
}

// Files with no photo row (a cascade nobody cleaned up after, a crash
// mid-upload): removed. Returns how many. A workspace's menu logos
// (workspaces.menuLogoIds, docs/api/menu.md §7b) live beside its bean photos.
export async function sweepOrphanPhotos(): Promise<number> {
  const rows = await db.select({ id: beanPhotos.id, workspaceId: beans.workspaceId }).from(beanPhotos).innerJoin(beans, eq(beanPhotos.beanId, beans.id));
  const logos = (await db.select({ ids: workspaces.menuLogoIds, workspaceId: workspaces.id }).from(workspaces).where(isNotNull(workspaces.menuLogoIds))).flatMap(
    (w) => (w.ids ?? []).map((id) => ({ id, workspaceId: w.workspaceId })),
  );
  const known = new Set([...rows, ...logos].map((r) => `${r.workspaceId}/${r.id}.webp`));
  let removed = 0;
  const dirs = await readdir(photoDir(), { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name === CHAT_DIR) continue;
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

const UNSENT_MS = 24 * 3600_000;

// Chat photos never sent, and files with no row (a deleted account's chats).
// Returns how many files went.
export async function sweepChatPhotos(): Promise<number> {
  const unsent = and(isNull(aiChatPhotos.messageId), lt(aiChatPhotos.createdAt, new Date(Date.now() - UNSENT_MS)));
  const old = await db.select({ id: aiChatPhotos.id }).from(aiChatPhotos).where(unsent);
  if (old.length) await db.delete(aiChatPhotos).where(inArray(aiChatPhotos.id, old.map((p) => p.id)));
  const rows = await db.select({ id: aiChatPhotos.id, workspaceId: aiChatPhotos.workspaceId }).from(aiChatPhotos);
  const known = new Set(rows.map((r) => `${r.workspaceId}/${r.id}.webp`));
  let removed = 0;
  const root = join(photoDir(), CHAT_DIR);
  for (const dir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(join(root, dir.name))) {
      if (known.has(`${dir.name}/${file}`)) continue;
      await rm(join(root, dir.name, file), { force: true });
      removed++;
    }
  }
  return removed;
}

// A photo from a backup zip (docs/api/backup.md §2b) as the server would have
// stored it: a WebP inside
// PHOTO_MAX_EDGE. Its real size, or null to leave it out.
export async function checkStoredPhoto(data: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(data, { failOn: "error" }).metadata();
    if (meta.format !== "webp" || !meta.width || !meta.height) return null;
    if (meta.width > PHOTO_MAX_EDGE || meta.height > PHOTO_MAX_EDGE) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { and, asc, count, eq } from "drizzle-orm";
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { beanPhotos, beans, MAX_BEAN_PHOTOS } from "@barista/shared/schema";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { photoPath, PHOTO_MAX_UPLOAD_BYTES, processPhoto, removePhotoFiles, writePhotoFile } from "../photos.js";

// A photo as beans carry it (docs/api/bean-photos.md §4c); the image is at
// GET …/beans/:beanId/photos/:id.
export interface PhotoInfo {
  id: string;
  width: number;
  height: number;
}

interface PhotoParams {
  workspaceId: string;
  beanId: string;
  photoId: string;
}
type BeanParams = Omit<PhotoParams, "photoId">;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Locks the bean (scoped to the workspace) so photo positions change one
// request at a time. False if it isn't there.
async function lockBean(tx: Tx, params: BeanParams): Promise<boolean> {
  const [bean] = await tx
    .select({ id: beans.id })
    .from(beans)
    .where(and(eq(beans.id, params.beanId), eq(beans.workspaceId, params.workspaceId)))
    .for("update");
  return !!bean;
}

// Positions 0..n-1 in the given order: the first is the cover.
async function renumber(tx: Tx, ids: string[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await tx.update(beanPhotos).set({ position }).where(eq(beanPhotos.id, id));
  }
}

const orderedIds = async (tx: Tx, beanId: string): Promise<string[]> =>
  (await tx.select({ id: beanPhotos.id }).from(beanPhotos).where(eq(beanPhotos.beanId, beanId)).orderBy(asc(beanPhotos.position), asc(beanPhotos.createdAt))).map(
    (r) => r.id,
  );

// Mounted at /api/workspaces/:workspaceId/beans/:beanId/photos
export const beanPhotosRouter = Router({ mergeParams: true });
beanPhotosRouter.use(requireAuth);

// The image itself, whatever its type: sharp decides whether it is one.
const imageBody = express.raw({ type: () => true, limit: PHOTO_MAX_UPLOAD_BYTES });

beanPhotosRouter.post("/", imageBody, async (req: Request<BeanParams>, res: Response<{ photo: PhotoInfo }>) => {
  const { workspaceId, beanId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const [bean] = await db
    .select({ id: beans.id })
    .from(beans)
    .where(and(eq(beans.id, beanId), eq(beans.workspaceId, workspaceId)))
    .limit(1);
  if (!bean) {
    sendError(res, 404, "Bean not found");
    return;
  }
  const photo = Buffer.isBuffer(req.body) && req.body.length > 0 ? await processPhoto(req.body) : null;
  if (!photo) {
    sendError(res, 400, "Not an image that can be read (JPEG, PNG, WebP, GIF, AVIF or TIFF)");
    return;
  }

  // The file goes first: a row never points at a missing file.
  const id = randomUUID();
  await writePhotoFile(workspaceId, id, photo.data);
  const added = await db.transaction(async (tx) => {
    if (!(await lockBean(tx, req.params))) return "not_found" as const;
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(beanPhotos).where(eq(beanPhotos.beanId, beanId));
    if (n >= MAX_BEAN_PHOTOS) return "full" as const;
    await tx.insert(beanPhotos).values({ id, beanId, position: n, width: photo.width, height: photo.height });
    return "added" as const;
  });
  if (added !== "added") {
    await removePhotoFiles(workspaceId, [id]);
    if (added === "full") sendError(res, 409, `A bean has at most ${MAX_BEAN_PHOTOS} photos`);
    else sendError(res, 404, "Bean not found");
    return;
  }
  res.status(201).json({ photo: { id, width: photo.width, height: photo.height } });
});

// Any member. A photo never changes once uploaded, so it can be cached for good.
beanPhotosRouter.get("/:photoId", async (req: Request<PhotoParams>, res: Response) => {
  const { workspaceId, beanId, photoId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const [row] = await db
    .select({ id: beanPhotos.id })
    .from(beanPhotos)
    .innerJoin(beans, eq(beanPhotos.beanId, beans.id))
    .where(and(eq(beanPhotos.id, photoId), eq(beanPhotos.beanId, beanId), eq(beans.workspaceId, workspaceId)))
    .limit(1);
  const path = row ? photoPath(workspaceId, row.id) : null;
  if (!path || !(await access(path).then(() => true, () => false))) {
    sendError(res, 404, "Photo not found");
    return;
  }
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.type("image/webp").sendFile(path);
});

const coverSchema = z.object({ cover: z.literal(true) }).strict();
const orderSchema = z
  .object({ photoIds: z.array(z.uuid()).max(MAX_BEAN_PHOTOS).refine((ids) => new Set(ids).size === ids.length, "each photo once") })
  .strict();

// Every photo of the bean, once each, in the new order: the first is the cover.
// Before /:photoId, so "order" isn't taken for an id.
beanPhotosRouter.put("/order", async (req: Request<BeanParams>, res: Response<{ photos: PhotoInfo[] }>) => {
  const { workspaceId, beanId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(orderSchema, req, res);
  if (!body) return;
  const result = await db.transaction(async (tx) => {
    if (!(await lockBean(tx, req.params))) return "not_found" as const;
    const ids = await orderedIds(tx, beanId);
    if (ids.length !== body.photoIds.length || !body.photoIds.every((id) => ids.includes(id))) return "mismatch" as const;
    await renumber(tx, body.photoIds);
    return "ok" as const;
  });
  if (result === "not_found") {
    sendError(res, 404, "Bean not found");
    return;
  }
  if (result === "mismatch") {
    sendError(res, 400, "photoIds: must list every photo of this bean exactly once");
    return;
  }
  res.json({ photos: await photosOf(beanId) });
});

// { "cover": true } makes it the first photo; the rest keep their order.
beanPhotosRouter.patch("/:photoId", async (req: Request<PhotoParams>, res: Response<{ photos: PhotoInfo[] }>) => {
  const { workspaceId, beanId, photoId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  if (!parseBody(coverSchema, req, res)) return;
  const found = await db.transaction(async (tx) => {
    if (!(await lockBean(tx, req.params))) return false;
    const ids = await orderedIds(tx, beanId);
    if (!ids.includes(photoId)) return false;
    await renumber(tx, [photoId, ...ids.filter((id) => id !== photoId)]);
    return true;
  });
  if (!found) {
    sendError(res, 404, "Photo not found");
    return;
  }
  res.json({ photos: await photosOf(beanId) });
});

beanPhotosRouter.delete("/:photoId", async (req: Request<PhotoParams>, res: Response) => {
  const { workspaceId, beanId, photoId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const found = await db.transaction(async (tx) => {
    if (!(await lockBean(tx, req.params))) return false;
    const ids = await orderedIds(tx, beanId);
    if (!ids.includes(photoId)) return false;
    await tx.delete(beanPhotos).where(eq(beanPhotos.id, photoId));
    await renumber(tx, ids.filter((id) => id !== photoId));
    return true;
  });
  if (!found) {
    sendError(res, 404, "Photo not found");
    return;
  }
  await removePhotoFiles(workspaceId, [photoId]);
  res.status(204).end();
});

// A bean's photos, cover first.
export async function photosOf(beanId: string): Promise<PhotoInfo[]> {
  return db
    .select({ id: beanPhotos.id, width: beanPhotos.width, height: beanPhotos.height })
    .from(beanPhotos)
    .where(eq(beanPhotos.beanId, beanId))
    .orderBy(asc(beanPhotos.position), asc(beanPhotos.createdAt));
}

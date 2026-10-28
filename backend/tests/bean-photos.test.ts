import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Response } from "superagent";
import { describe, expect, it } from "vitest";
import { MAX_BEAN_PHOTOS } from "@barista/shared/schema";
import { photoDir } from "../src/config.js";
import { addMember, newBean, newBrewLog, newUser, newWorkspace, type TestUser } from "./helpers.js";

// A JPEG from a phone held upright: stored landscape, EXIF says turn it.
const jpeg = (width: number, height: number, orientation?: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } } })
    .jpeg()
    .withMetadata(orientation ? { orientation } : {})
    .toBuffer();

const binary = (res: Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const bean = await newBean(owner, ws.id);
  const base = `/api/workspaces/${ws.id}/beans/${bean}/photos`;
  return { owner, ws, bean, base };
}
const upload = async (user: TestUser, base: string, image: Buffer, type = "image/jpeg") => user.agent.post(base).set("Content-Type", type).send(image);
const fileOf = (workspaceId: string, photoId: string) => join(photoDir(), workspaceId, `${photoId}.webp`);
const photosOf = async (user: TestUser, workspaceId: string, beanId: string): Promise<Array<{ id: string; width: number; height: number }>> =>
  (await user.agent.get(`/api/workspaces/${workspaceId}/beans`)).body.beans.find((b: { id: string }) => b.id === beanId).photos;

describe("bean photos (docs/api/bean-photos.md §4c)", () => {
  it("stores an upright WebP at most 1024 px, without EXIF, and serves it", async () => {
    const { owner, ws, bean, base } = await setup();
    const res = await upload(owner, base, await jpeg(2000, 1000, 6));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Orientation 6 turns it a quarter: 1000 × 2000, then down to fit 1024.
    expect(res.body.photo).toMatchObject({ width: 512, height: 1024 });
    const id = res.body.photo.id as string;
    expect(existsSync(fileOf(ws.id, id))).toBe(true);

    const got = await owner.agent.get(`${base}/${id}`).buffer(true).parse(binary);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/webp");
    expect(got.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    const meta = await sharp(got.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 1024 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();

    // A small one stays its size; the bean lists both, in upload order.
    const small = (await upload(owner, base, await jpeg(300, 200), "image/png")).body.photo;
    expect(small).toMatchObject({ width: 300, height: 200 });
    expect((await photosOf(owner, ws.id, bean)).map((p) => p.id)).toEqual([id, small.id]);
  });

  it("refuses what isn't an image, too big, or one too many", async () => {
    const { owner, base } = await setup();
    expect((await upload(owner, base, Buffer.from("not a photo"), "text/plain")).status).toBe(400);
    expect((await owner.agent.post(base).set("Content-Type", "image/jpeg")).status).toBe(400);
    expect((await upload(owner, base, Buffer.alloc(16 * 1024 * 1024))).status).toBe(413);
    const image = await jpeg(50, 50);
    for (let i = 0; i < MAX_BEAN_PHOTOS; i++) expect((await upload(owner, base, image)).status).toBe(201);
    expect((await upload(owner, base, image)).status).toBe(409);
  });

  it("makes a photo the cover, and deletes one with its file", async () => {
    const { owner, ws, bean, base } = await setup();
    const image = await jpeg(50, 50);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await upload(owner, base, image)).body.photo.id);
    const covered = await owner.agent.patch(`${base}/${ids[2]}`).send({ cover: true });
    expect(covered.status).toBe(200);
    expect(covered.body.photos.map((p: { id: string }) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect((await owner.agent.patch(`${base}/${ids[0]}`).send({ cover: false })).status).toBe(400);

    expect((await owner.agent.delete(`${base}/${ids[2]}`)).status).toBe(204);
    expect(existsSync(fileOf(ws.id, ids[2]!))).toBe(false);
    expect((await photosOf(owner, ws.id, bean)).map((p) => p.id)).toEqual([ids[0], ids[1]]);
    expect((await owner.agent.get(`${base}/${ids[2]}`)).status).toBe(404);
    expect((await owner.agent.delete(`${base}/${ids[2]}`)).status).toBe(404);
  });

  it("removes the files with the bean, and with the workspace", async () => {
    const { owner, ws, bean, base } = await setup();
    const id = (await upload(owner, base, await jpeg(50, 50))).body.photo.id as string;
    await newBrewLog(owner, ws.id, bean);
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/beans/${bean}?deleteBrewLogs=true`)).status).toBe(204);
    expect(existsSync(fileOf(ws.id, id))).toBe(false);

    const other = await newBean(owner, ws.id);
    const kept = (await upload(owner, `/api/workspaces/${ws.id}/beans/${other}/photos`, await jpeg(50, 50))).body.photo.id as string;
    expect(existsSync(fileOf(ws.id, kept))).toBe(true);
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}?confirm=${ws.slug}`)).status).toBe(204);
    expect(existsSync(join(photoDir(), ws.id))).toBe(false);
  });

  it("viewers can look but not change; other workspaces get 404", async () => {
    const { owner, ws, bean, base } = await setup();
    const id = (await upload(owner, base, await jpeg(50, 50))).body.photo.id as string;
    const viewer = await newUser("viewer");
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(`${base}/${id}`)).status).toBe(200);
    expect((await upload(viewer, base, await jpeg(50, 50))).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${id}`).send({ cover: true })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${id}`)).status).toBe(403);

    const stranger = await newUser("stranger");
    expect((await stranger.agent.get(`${base}/${id}`)).status).toBe(404);
    // Another workspace's bean id under this workspace: not found.
    const theirs = await newWorkspace(stranger);
    const theirBean = await newBean(stranger, theirs.id);
    expect((await upload(owner, `/api/workspaces/${ws.id}/beans/${theirBean}/photos`, await jpeg(50, 50))).status).toBe(404);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/beans/${bean}/photos/${theirBean}`)).status).toBe(404);
  });
});

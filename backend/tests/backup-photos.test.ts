import { existsSync } from "node:fs";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import sharp from "sharp";
import type { Response } from "superagent";
import { describe, expect, it } from "vitest";
import { photoDir } from "../src/config.js";
import { newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

const jpeg = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#6b4" } }).jpeg().toBuffer();
const binary = (res: Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};

// A workspace with one bean and two photos, the second made the cover.
async function withPhotos() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const bean = await newBean(owner, ws.id, { roasterName: "Onyx", beanName: "Geometry" });
  const photos = `/api/workspaces/${ws.id}/beans/${bean}/photos`;
  const a = (await owner.agent.post(photos).set("Content-Type", "image/jpeg").send(await jpeg(400, 300))).body.photo.id as string;
  const b = (await owner.agent.post(photos).set("Content-Type", "image/jpeg").send(await jpeg(300, 400))).body.photo.id as string;
  await owner.agent.patch(`${photos}/${b}`).send({ cover: true });
  return { owner, ws, ids: [b, a] };
}
const zipBackup = async (owner: TestUser, workspaceId: string) => {
  const res = await owner.agent.get(`/api/workspaces/${workspaceId}/backup?photos=true`).buffer(true).parse(binary);
  expect(res.status).toBe(200);
  return res;
};
const restoreZip = (owner: TestUser, zip: Uint8Array, slug: string) =>
  owner.agent.post(`/api/workspaces/restore?name=Copy&slug=${slug}`).set("Content-Type", "application/zip").send(Buffer.from(zip));
const beansOf = async (owner: TestUser, workspaceId: string) =>
  (await owner.agent.get(`/api/workspaces/${workspaceId}/beans`)).body.beans as Array<{ id: string; photos: Array<{ id: string; width: number; height: number }> }>;

describe("backups with photos: a .zip (docs/api/backup.md §2b)", () => {
  it("holds backup.json and each photo, and restores them under new ids", async () => {
    const { owner, ws, ids } = await withPhotos();
    const res = await zipBackup(owner, ws.id);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`attachment; filename="${ws.slug}-backup-\\d{4}-\\d{2}-\\d{2}\\.zip"`));
    const files = unzipSync(res.body as Buffer);
    expect(Object.keys(files).sort()).toEqual(["backup.json", ...ids.map((id) => `photos/${id}.webp`)].sort());
    const backup = JSON.parse(new TextDecoder().decode(files["backup.json"]));
    expect(backup.tables.bean_photos.map((p: { id: string }) => p.id).sort()).toEqual([...ids].sort());

    const restored = await restoreZip(owner, res.body as Buffer, `copy-${ws.slug}`);
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    const copyId = restored.body.workspaceId as string;
    const [copy] = await beansOf(owner, copyId);
    // Same order and sizes (cover first), new ids, files in place.
    const [original] = await beansOf(owner, ws.id);
    expect(copy!.photos.map((p) => [p.width, p.height])).toEqual(original!.photos.map((p) => [p.width, p.height]));
    for (const p of copy!.photos) {
      expect(ids).not.toContain(p.id);
      expect(existsSync(join(photoDir(), copyId, `${p.id}.webp`))).toBe(true);
      expect((await owner.agent.get(`/api/workspaces/${copyId}/beans/${copy!.id}/photos/${p.id}`)).status).toBe(200);
    }
  });

  it("leaves out photos whose file is missing or isn't a stored photo; a JSON file has none", async () => {
    const { owner, ws, ids } = await withPhotos();
    const files = unzipSync((await zipBackup(owner, ws.id)).body as Buffer);
    delete files[`photos/${ids[0]}.webp`]; // missing
    files[`photos/${ids[1]}.webp`] = strToU8("not an image"); // not a WebP
    const restored = await restoreZip(owner, zipSync(files), `partial-${ws.slug}`);
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    expect((await beansOf(owner, restored.body.workspaceId))[0]!.photos).toEqual([]);

    // A JSON file naming photos it doesn't carry: the rows are dropped.
    const backup = JSON.parse(new TextDecoder().decode(files["backup.json"]));
    const fromJson = await owner.agent.post("/api/workspaces/restore").send({ name: "J", slug: `json-${ws.slug}`, backup });
    expect(fromJson.status).toBe(201);
    expect((await beansOf(owner, fromJson.body.workspaceId))[0]!.photos).toEqual([]);
  });

  it("refuses a zip that isn't one, or has no backup.json", async () => {
    const { owner, ws } = await withPhotos();
    expect((await restoreZip(owner, strToU8("nope"), `bad-${ws.slug}`)).status).toBe(400);
    const empty = await restoreZip(owner, zipSync({ "readme.txt": strToU8("hi") }), `bad2-${ws.slug}`);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/backup\.json/);
    // The name and slug are still checked.
    const zip = (await zipBackup(owner, ws.id)).body as Buffer;
    expect((await owner.agent.post("/api/workspaces/restore?name=X&slug=No Spaces").set("Content-Type", "application/zip").send(zip)).status).toBe(400);
    expect((await restoreZip(owner, zip, ws.slug)).status).toBe(409);
  });
});

// Security audit session 4, second batch: SEC-04, SEC-63 (backup half), SEC-64, SEC-91, SEC-92.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { workspaceAiConfigs } from "@barista/shared/schema";
import { app } from "../src/app.js";
import { checkBackup } from "../src/backup.js";
import { photoDir } from "../src/config.js";
import { db } from "../src/db.js";
import { chatQueue } from "../src/queue.js";
import { newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

const binary = (r: { on(e: string, f: (c?: Buffer) => void): void }, done: (err: Error | null, body: Buffer) => void) => {
  const parts: Buffer[] = [];
  r.on("data", (c) => parts.push(c!));
  r.on("end", () => done(null, Buffer.concat(parts)));
};
const noise = (w: number, h: number) =>
  sharp(Buffer.from(Array.from({ length: w * h * 3 }, (_, i) => (i * 2654435761) >>> 24)), { raw: { width: w, height: h, channels: 3 } });

beforeEach(async () => {
  await chatQueue.obliterate({ force: true });
});

// SEC-04: a chat import keeps file timestamps, so a future updatedAt pins a chat on top and defeats aging.
describe("SEC-04 chat import timestamps", () => {
  it("clamps updatedAt to now", async () => {
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const other = (await newWorkspace(owner)).id;
    for (const id of [ws, other]) await db.insert(workspaceAiConfigs).values({ workspaceId: id, provider: "openai", apiKeyEncrypted: "x", apiKeyLast4: "1234", model: "m" });
    await owner.agent.post(`/api/workspaces/${ws}/chats`).send({ content: "Hello" });
    const zip = (await owner.agent.get(`/api/workspaces/${ws}/chats/export`).buffer(true).parse(binary as never)).body as Buffer;
    const files = unzipSync(zip);
    const file = JSON.parse(strFromU8(files["chats.json"]!));
    file.chats[0].updatedAt = new Date(Date.now() + 10 * 365 * 86_400_000).toISOString();
    files["chats.json"] = strToU8(JSON.stringify(file));
    const res = await owner.agent.post(`/api/workspaces/${other}/chats/import`).set("Content-Type", "application/zip").send(Buffer.from(zipSync(files)));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [chat] = (await owner.agent.get(`/api/workspaces/${other}/chats`)).body.chats as Array<{ updatedAt: string }>;
    expect(new Date(chat!.updatedAt).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});

// SEC-63: restored rows are trusted as the restorer's own history. Timestamps in the future always qualify as "recent".
describe("SEC-63 restored history", () => {
  it("checkBackup refuses a brew dated five years ahead", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const bean = await newBean(owner, ws.id);
    await newBrewLog(owner, ws.id, bean);
    const backup = (await owner.agent.get(`/api/workspaces/${ws.id}/backup`)).body;
    backup.tables.brew_logs[0].timestamp = new Date(Date.now() + 5 * 365 * 86_400_000).toISOString();
    expect(checkBackup(backup).ok).toBe(false);
  });
});

// SEC-64: restore stores photo bytes as given, junk included.
describe("SEC-64 restored photos are re-encoded", () => {
  it("stores no more than a re-encode of the entry", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const bean = await newBean(owner, ws.id);
    const photos = `/api/workspaces/${ws.id}/beans/${bean}/photos`;
    const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#884422" } }).jpeg().toBuffer();
    expect((await owner.agent.post(photos).set("Content-Type", "image/jpeg").send(jpeg)).status).toBe(201);
    const zip = (await owner.agent.get(`/api/workspaces/${ws.id}/backup?photos=true`).buffer(true).parse(binary as never)).body as Buffer;
    const files = unzipSync(zip);
    const name = Object.keys(files).find((n) => n.startsWith("photos/"))!;
    files[name] = Buffer.concat([files[name]!, Buffer.alloc(1_000_000, 0x41)]); // junk after the RIFF chunks
    const res = await owner.agent.post("/api/workspaces/restore?name=Copy&slug=sec64-copy").set("Content-Type", "application/zip").send(Buffer.from(zipSync(files)));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const copyId = res.body.workspaceId as string;
    const [copyBean] = (await owner.agent.get(`/api/workspaces/${copyId}/beans`)).body.beans as Array<{ photos: Array<{ id: string }> }>;
    const stored = await readFile(join(photoDir(), copyId, `${copyBean!.photos[0]!.id}.webp`));
    expect(stored.byteLength).toBeLessThan(500_000);
  });
});

// SEC-91: uploads aren't throttled or budgeted per account.
describe("SEC-91 photo uploads", () => {
  it("answers 429 or 413 somewhere in 72 uploads in a row", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const jpeg = await noise(64, 64).jpeg().toBuffer();
    let refused = false;
    for (let b = 0; b < 12 && !refused; b++) {
      const bean = await newBean(owner, ws.id, { beanName: `Bean ${b}` });
      for (let i = 0; i < 6 && !refused; i++) {
        const res = await owner.agent.post(`/api/workspaces/${ws.id}/beans/${bean}/photos`).set("Content-Type", "image/jpeg").send(jpeg);
        if (res.status === 429 || res.status === 413) refused = true;
        else expect(res.status).toBe(201);
      }
    }
    expect(refused).toBe(true);
  }, 60_000);
});

// SEC-92: the public menu is rebuilt for every anonymous request.
describe("SEC-92 public menu", () => {
  it("sends a Cache-Control header", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const res = await request(app).get(`/api/public/menu/${ws.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/max-age|s-maxage/);
  });
});

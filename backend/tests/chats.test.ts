import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { AI_SERVER_KEY, CHAT_LIMITS_KEY, DEFAULT_SERVER_AI } from "@barista/shared/aiConfig";
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatStreamEvent } from "@barista/shared/jobs";
import { aiChatMessages, aiChatPhotos, aiChats, serverSettings, workspaceAiConfigs } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Redis } from "ioredis";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setAdmin } from "../src/adminAccess.js";
import { app } from "../src/app.js";
import { overLimits } from "../src/chatData.js";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { chatPhotoPath, sweepChatPhotos, sweepOrphanPhotos, writeChatPhotoFile } from "../src/photos.js";
import { chatQueue } from "../src/queue.js";
import { addMember, newBean, newBrewLog, newUser, newWorkspace, type TestUser } from "./helpers.js";

// AI chat (docs/api/chat.md §12), with the worker's part played by the test.
const redis = new Redis(config.redis.url, { ...(config.redis.password ? { password: config.redis.password } : {}) });
afterAll(() => redis.disconnect());

async function withAi(workspaceId: string): Promise<void> {
  await db.insert(workspaceAiConfigs).values({ workspaceId, provider: "openai", apiKeyEncrypted: "x", apiKeyLast4: "1234", model: "m" });
}
const url = (workspaceId: string) => `/api/workspaces/${workspaceId}/chats`;
const publish = (messageId: string, event: ChatStreamEvent) => redis.xadd(chatReplyKey(messageId), "*", CHAT_EVENT_FIELD, JSON.stringify(event));
const finish = (id: string, content: string) => db.update(aiChatMessages).set({ content, status: "done" }).where(eq(aiChatMessages.id, id));

let owner: TestUser;
let workspaceId: string;
beforeEach(async () => {
  await chatQueue.obliterate({ force: true });
  owner = await newUser();
  workspaceId = (await newWorkspace(owner)).id;
  await withAi(workspaceId);
});

describe("chats", () => {
  it("starts a chat: saved, titled, and its reply queued", async () => {
    const res = await owner.agent.post(url(workspaceId)).send({ content: "  Why is my V60 sour?\nIt's a light roast.  " });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.chat.title).toBe("Why is my V60 sour?");
    expect(res.body.messages.map((m: { role: string; status: string; position: number }) => [m.position, m.role, m.status])).toEqual([[1, "user", "done"], [2, "assistant", "pending"]]);
    const reply = res.body.messages[1].id as string;
    expect((await chatQueue.getJob(`chat-${reply}`))?.data).toEqual({ messageId: reply, photos: [] });
    expect((await owner.agent.get(url(workspaceId))).body.chats.map((c: { id: string }) => c.id)).toEqual([res.body.chat.id]);
  });

  it("takes one message at a time", async () => {
    const start = await owner.agent.post(url(workspaceId)).send({ content: "One" });
    const chat = `${url(workspaceId)}/${start.body.chat.id}`;
    expect((await owner.agent.post(`${chat}/messages`).send({ content: "Two" })).status).toBe(409);
    await finish(start.body.messages[1].id, "Answer");
    const next = await owner.agent.post(`${chat}/messages`).send({ content: "Two" });
    expect(next.status).toBe(202);
    expect(next.body.messages.map((m: { position: number }) => m.position)).toEqual([3, 4]);
    expect((await owner.agent.get(chat)).body.messages).toHaveLength(4);
  });

  it("checks the message, and needs AI set up", async () => {
    expect((await owner.agent.post(url(workspaceId)).send({ content: "   " })).status).toBe(400);
    expect((await owner.agent.post(url(workspaceId)).send({ content: "x".repeat(4001) })).status).toBe(400);
    await db.delete(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
    await db.insert(serverSettings).values({ key: AI_SERVER_KEY, value: { ...DEFAULT_SERVER_AI, enabled: false } });
    const res = await owner.agent.post(url(workspaceId)).send({ content: "Hello" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ai_not_configured");
  });

  it("keeps a chat private, even from the workspace's owner", async () => {
    const barista = await newUser();
    await addMember(owner, workspaceId, barista, "barista");
    const start = await barista.agent.post(url(workspaceId)).send({ content: "Mine" });
    const chat = `${url(workspaceId)}/${start.body.chat.id}`;
    expect((await owner.agent.get(url(workspaceId))).body.chats).toEqual([]);
    expect((await owner.agent.get(chat)).status).toBe(404);
    expect((await owner.agent.post(`${chat}/messages`).send({ content: "Hi" })).status).toBe(404);
    expect((await owner.agent.get(`${chat}/messages/${start.body.messages[1].id}/stream`)).status).toBe(404);
    expect((await owner.agent.delete(chat)).status).toBe(404);
    expect((await barista.agent.delete(chat)).status).toBe(204);
  });

  it("is closed to outsiders, and viewers can't send", async () => {
    const viewer = await newUser();
    await addMember(owner, workspaceId, viewer, "viewer");
    expect((await viewer.agent.post(url(workspaceId)).send({ content: "Hi" })).status).toBe(403);
    expect((await viewer.agent.get(url(workspaceId))).status).toBe(200);
    expect((await (await newUser()).agent.get(url(workspaceId))).status).toBe(404);
  });
});

describe("attachments", () => {
  it("saves them with their labels, each once", async () => {
    const bean = await newBean(owner, workspaceId, { roasterName: "Onyx", beanName: "Guji" });
    const brew = await newBrewLog(owner, workspaceId, bean);
    const res = await owner.agent.post(url(workspaceId)).send({ content: "Compare", attachments: [{ kind: "bean", id: bean }, { kind: "bean", id: bean }, { kind: "brew", id: brew }] });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.messages[0].attachments).toEqual([
      { kind: "bean", id: bean, label: "Onyx Guji" },
      { kind: "brew", id: brew, label: expect.stringMatching(/^Guji, \d{4}-\d{2}-\d{2}$/) },
    ]);
    expect(res.body.messages[1].attachments).toEqual([]);
    expect((await owner.agent.get(`${url(workspaceId)}/${res.body.chat.id}`)).body.messages[0].attachments).toHaveLength(2);
  });

  it("refuses another workspace's, and too many", async () => {
    const other = await newUser();
    const theirs = await newBean(other, (await newWorkspace(other)).id);
    expect((await owner.agent.post(url(workspaceId)).send({ content: "Hi", attachments: [{ kind: "bean", id: theirs }] })).status).toBe(400);
    expect((await owner.agent.get(url(workspaceId))).body.chats).toEqual([]);
    const many = Array.from({ length: 11 }, () => ({ kind: "bean", id: theirs }));
    expect((await owner.agent.post(url(workspaceId)).send({ content: "Hi", attachments: many })).status).toBe(400);
  });
});

describe("photos", () => {
  const png = () => sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#654321" } }).png().toBuffer();
  const upload = async (user: TestUser, ws = workspaceId) => (await user.agent.post(`${url(ws)}/photos`).set("Content-Type", "image/png").send(await png())).body.photo as { id: string; width: number };

  it("resizes one, sends it with a message and puts it in the job", async () => {
    const photo = await upload(owner);
    expect(photo.width).toBe(1024);
    const res = await owner.agent.post(url(workspaceId)).send({ content: "What's this?", photoIds: [photo.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.messages[0].photos).toEqual([{ id: photo.id, width: 1024, height: 512 }]);
    const job = await chatQueue.getJob(`chat-${res.body.messages[1].id}`);
    expect(job?.data.photos).toEqual([{ messageId: res.body.messages[0].id, base64: expect.any(String) }]);
    expect((await owner.agent.get(`${url(workspaceId)}/photos/${photo.id}`)).headers["content-type"]).toMatch(/image\/webp/);
  });

  it("is only for whoever uploaded it, and can only be sent once", async () => {
    const barista = await newUser();
    await addMember(owner, workspaceId, barista, "barista");
    const photo = await upload(owner);
    expect((await barista.agent.get(`${url(workspaceId)}/photos/${photo.id}`)).status).toBe(404);
    expect((await barista.agent.post(url(workspaceId)).send({ content: "Hi", photoIds: [photo.id] })).status).toBe(400);
    expect((await owner.agent.post(url(workspaceId)).send({ content: "Hi", photoIds: [photo.id] })).status).toBe(202);
    expect((await owner.agent.post(url(workspaceId)).send({ content: "Again", photoIds: [photo.id] })).status).toBe(400);
  });

  it("refuses what isn't an image, and more than four", async () => {
    expect((await owner.agent.post(`${url(workspaceId)}/photos`).set("Content-Type", "image/png").send(Buffer.from("nope"))).status).toBe(400);
    const ids = Array.from({ length: 5 }, () => randomUUID());
    expect((await owner.agent.post(url(workspaceId)).send({ content: "Hi", photoIds: ids })).status).toBe(400);
  });

  it("removes the file with the chat", async () => {
    const photo = await upload(owner);
    const res = await owner.agent.post(url(workspaceId)).send({ content: "Hi", photoIds: [photo.id] });
    await owner.agent.delete(`${url(workspaceId)}/${res.body.chat.id}`);
    await expect(access(chatPhotoPath(workspaceId, photo.id))).rejects.toThrow();
  });

  it("sweeps a photo never sent after a day, and files with no row", async () => {
    const fresh = await upload(owner);
    const old = await upload(owner);
    await db.update(aiChatPhotos).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(aiChatPhotos.id, old.id));
    const stray = randomUUID();
    await writeChatPhotoFile(workspaceId, stray, Buffer.from("x"));
    // At least these two: other tests' workspaces leave files behind.
    expect(await sweepChatPhotos()).toBeGreaterThanOrEqual(2);
    await access(chatPhotoPath(workspaceId, fresh.id));
    await expect(access(chatPhotoPath(workspaceId, stray))).rejects.toThrow();
    await expect(access(chatPhotoPath(workspaceId, old.id))).rejects.toThrow();
    // The bean photo sweep leaves chat photos alone.
    await sweepOrphanPhotos();
    await access(chatPhotoPath(workspaceId, fresh.id));
  });
});

describe("turning chat off", () => {
  it("off for the workspace, sending is refused and reading isn't", async () => {
    const start = await owner.agent.post(url(workspaceId)).send({ content: "Hi" });
    await finish(start.body.messages[1].id, "Hello");
    await owner.agent.patch(`/api/workspaces/${workspaceId}/settings`).send({ aiChat: false });
    const chat = `${url(workspaceId)}/${start.body.chat.id}`;
    const refused = await owner.agent.post(`${chat}/messages`).send({ content: "Again" });
    expect([refused.status, refused.body.code]).toEqual([403, "chat_off"]);
    expect((await owner.agent.post(url(workspaceId)).send({ content: "New" })).status).toBe(403);
    expect((await owner.agent.get(chat)).body.messages).toHaveLength(2);
    expect((await owner.agent.get(url(workspaceId))).body.canSend).toBe(false);
  });

  it("off for one member, set only by an owner", async () => {
    const barista = await newUser();
    await addMember(owner, workspaceId, barista, "barista");
    const set = `/api/workspaces/${workspaceId}/members/${barista.id}/chat`;
    expect((await barista.agent.put(set).send({ enabled: true })).status).toBe(403);
    expect((await owner.agent.put(set).send({ enabled: false })).body).toEqual({ userId: barista.id, chatEnabled: false });
    expect((await barista.agent.post(url(workspaceId)).send({ content: "Hi" })).status).toBe(403);
    expect((await barista.agent.get(url(workspaceId))).body.canSend).toBe(false);
    expect((await owner.agent.post(url(workspaceId)).send({ content: "Hi" })).status).toBe(202);
    const members = (await owner.agent.get(`/api/workspaces/${workspaceId}/members`)).body.members as Array<{ userId: string; chatEnabled: boolean }>;
    expect(members.find((m) => m.userId === barista.id)?.chatEnabled).toBe(false);
    await owner.agent.put(set).send({ enabled: true });
    expect((await barista.agent.post(url(workspaceId)).send({ content: "Hi" })).status).toBe(202);
  });
});

describe("limits and purging", () => {
  const MB = 1024 ** 2;
  const day = 24 * 3600_000;
  const now = new Date("2026-11-01T00:00:00Z");
  const chat = (id: string, age: number, bytes: number) => ({ id, userId: "u", updatedAt: new Date(now.getTime() - age * day), bytes });

  it("takes the oldest first until the rest fit, never the one in use", () => {
    const chats = [chat("new", 0, 5), chat("old", 9, 5), chat("mid", 5, 5)];
    expect(overLimits(chats, { maxBytes: 10, maxDays: null }, null, now)).toEqual(["old"]);
    expect(overLimits(chats, { maxBytes: 4, maxDays: null }, "old", now)).toEqual(["mid", "new"]);
    expect(overLimits(chats, { maxBytes: null, maxDays: 6 }, null, now)).toEqual(["old"]);
    expect(overLimits(chats, { maxBytes: null, maxDays: null }, null, now)).toEqual([]);
  });

  it("a person can be stricter than the server, not looser", async () => {
    await owner.agent.get("/api/auth/me/chat-settings").expect(200);
    await db.insert(serverSettings).values({ key: CHAT_LIMITS_KEY, value: { maxBytes: 10 * MB, maxDays: 30, dailyMessages: null } });
    const settings = "/api/auth/me/chat-settings";
    expect((await owner.agent.put(settings).send({ maxBytes: 11 * MB, maxDays: null })).status).toBe(400);
    expect((await owner.agent.put(settings).send({ maxBytes: null, maxDays: 31 })).status).toBe(400);
    const saved = await owner.agent.put(settings).send({ maxBytes: 2 * MB, maxDays: null });
    expect(saved.body.effective).toEqual({ maxBytes: 2 * MB, maxDays: 30 });
    // Lowering the server's below it wins without rewriting theirs.
    await db.update(serverSettings).set({ value: { maxBytes: MB, maxDays: 30, dailyMessages: null } }).where(eq(serverSettings.key, CHAT_LIMITS_KEY));
    const after = await owner.agent.get(settings);
    expect(after.body.own.maxBytes).toBe(2 * MB);
    expect(after.body.effective.maxBytes).toBe(MB);
  });

  it("deletes older chats when a limit is lowered, and counts what's kept", async () => {
    const first = await owner.agent.post(url(workspaceId)).send({ content: "x".repeat(2000) });
    await finish(first.body.messages[1].id, "y".repeat(2000));
    await db.update(aiChats).set({ updatedAt: new Date(Date.now() - 2 * day) }).where(eq(aiChats.id, first.body.chat.id));
    const second = await owner.agent.post(url(workspaceId)).send({ content: "z".repeat(1500) });
    expect((await owner.agent.get("/api/auth/me/chat-settings")).body.usedBytes).toBe(5500);
    await owner.agent.put("/api/auth/me/chat-settings").send({ maxBytes: 2048, maxDays: null });
    expect((await owner.agent.get(url(workspaceId))).body.chats.map((c: { id: string }) => c.id)).toEqual([second.body.chat.id]);
  });

  it("stops at the daily limit", async () => {
    await db.insert(serverSettings).values({ key: CHAT_LIMITS_KEY, value: { maxBytes: null, maxDays: null, dailyMessages: 1 } });
    expect((await owner.agent.post(url(workspaceId)).send({ content: "One" })).status).toBe(202);
    const res = await owner.agent.post(url(workspaceId)).send({ content: "Two" });
    expect([res.status, res.body.code]).toEqual([429, "chat_limit"]);
  });

  it("purges your own chats and photos, in every workspace, and nobody else's", async () => {
    const barista = await newUser();
    await addMember(owner, workspaceId, barista, "barista");
    await barista.agent.post(url(workspaceId)).send({ content: "Theirs" });
    const photo = (await owner.agent.post(`${url(workspaceId)}/photos`).set("Content-Type", "image/png").send(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer())).body.photo as { id: string };
    await owner.agent.post(url(workspaceId)).send({ content: "Mine" });
    expect((await owner.agent.delete("/api/auth/me/chats")).status).toBe(204);
    expect((await owner.agent.get(url(workspaceId))).body.chats).toEqual([]);
    await expect(access(chatPhotoPath(workspaceId, photo.id))).rejects.toThrow();
    expect((await barista.agent.get(url(workspaceId))).body.chats).toHaveLength(1);
  });

  it("keeps the server's routes to admins", async () => {
    expect((await owner.agent.get("/api/server/chat")).status).toBe(403);
    expect((await owner.agent.delete("/api/server/chats")).status).toBe(403);
  });

  it("lets an admin set the server's limits, which prune, and purge everyone's chats", async () => {
    const admin = await newUser();
    expect(await setAdmin(admin.email, true)).toBe(true);
    expect((await admin.agent.get("/api/server/chat")).body.limits).toEqual({ maxBytes: 1024 ** 3, maxDays: null, dailyMessages: 200 });
    const old = await owner.agent.post(url(workspaceId)).send({ content: "Old" });
    await finish(old.body.messages[1].id, "Reply");
    await db.update(aiChats).set({ updatedAt: new Date(Date.now() - 40 * day) }).where(eq(aiChats.id, old.body.chat.id));
    await owner.agent.post(url(workspaceId)).send({ content: "New" });

    const limits = { maxBytes: 5 * MB, maxDays: 30, dailyMessages: 50 };
    const saved = await admin.agent.put("/api/server/chat").send(limits);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.limits).toEqual(limits);
    expect(saved.body.usedBytes).toBe(3);
    expect((await owner.agent.get(url(workspaceId))).body.chats).toHaveLength(1);
    expect((await admin.agent.put("/api/server/chat").send({ ...limits, maxDays: 0 })).status).toBe(400);

    expect((await admin.agent.delete("/api/server/chats")).status).toBe(204);
    expect((await owner.agent.get(url(workspaceId))).body.chats).toEqual([]);
  });

  it("deletes a member's chats when they leave, and only theirs", async () => {
    const barista = await newUser();
    await addMember(owner, workspaceId, barista, "barista");
    await barista.agent.post(url(workspaceId)).send({ content: "Mine" });
    await owner.agent.post(url(workspaceId)).send({ content: "Stays" });
    expect((await barista.agent.delete(`/api/workspaces/${workspaceId}/members/${barista.id}`)).status).toBe(204);
    expect(await db.select().from(aiChats).where(eq(aiChats.userId, barista.id))).toEqual([]);
    expect((await owner.agent.get(url(workspaceId))).body.chats).toHaveLength(1);
  });
});

describe("export and import", () => {
  const binary = (r: { on(e: string, f: (c?: Buffer) => void): void }, done: (err: Error | null, body: Buffer) => void) => {
    const parts: Buffer[] = [];
    r.on("data", (c) => parts.push(c!));
    r.on("end", () => done(null, Buffer.concat(parts)));
  };
  const exported = async (user: TestUser, ws: string): Promise<Buffer> => (await user.agent.get(`${url(ws)}/export`).buffer(true).parse(binary as never)).body as Buffer;
  const imported = (user: TestUser, ws: string, zip: Buffer) => user.agent.post(`${url(ws)}/import`).set("Content-Type", "application/zip").send(zip);
  const png = () => sharp({ create: { width: 20, height: 20, channels: 3, background: "#123456" } }).png().toBuffer();

  async function chatWithPhoto(): Promise<{ chatId: string; photoId: string }> {
    const photo = (await owner.agent.post(`${url(workspaceId)}/photos`).set("Content-Type", "image/png").send(await png())).body.photo as { id: string };
    const bean = await newBean(owner, workspaceId, { roasterName: "Onyx", beanName: "Guji" });
    const res = await owner.agent.post(url(workspaceId)).send({ content: "Look", photoIds: [photo.id], attachments: [{ kind: "bean", id: bean }] });
    await finish(res.body.messages[1].id, "A puck");
    return { chatId: res.body.chat.id, photoId: photo.id };
  }

  it("brings a chat and its photo into another workspace, and skips it there next time", async () => {
    const { chatId } = await chatWithPhoto();
    const zip = await exported(owner, workspaceId);
    const other = (await newWorkspace(owner)).id;
    await withAi(other);
    const res = await imported(owner, other, zip);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ imported: 1, skipped: 0 });
    const [chat] = (await owner.agent.get(url(other))).body.chats as Array<{ id: string; title: string }>;
    expect(chat!.title).toBe("Look");
    expect(chat!.id).not.toBe(chatId);
    const { messages } = (await owner.agent.get(`${url(other)}/${chat!.id}`)).body as { messages: Array<{ id: string; content: string; attachments: unknown[]; photos: Array<{ id: string }> }> };
    expect(messages.map((m) => m.content)).toEqual(["Look", "A puck"]);
    expect(messages[0]!.attachments).toHaveLength(1);
    expect((await owner.agent.get(`${url(other)}/photos/${messages[0]!.photos[0]!.id}`)).status).toBe(200);

    expect((await imported(owner, workspaceId, zip)).body).toEqual({ imported: 0, skipped: 1 });
  });

  it("only holds your own, and leaves out a reply still being written", async () => {
    const barista = await newUser();
    await addMember(owner, workspaceId, barista, "barista");
    await chatWithPhoto();
    await barista.agent.post(url(workspaceId)).send({ content: "Theirs" });
    const { chats } = JSON.parse(strFromU8(unzipSync(await exported(barista, workspaceId))["chats.json"]!)) as { chats: Array<{ title: string; messages: unknown[] }> };
    expect(chats.map((c) => c.title)).toEqual(["Theirs"]);
    expect(chats[0]!.messages).toHaveLength(1);
  });

  it("restores your own after a purge, with the same id", async () => {
    const { chatId } = await chatWithPhoto();
    const zip = await exported(owner, workspaceId);
    await owner.agent.delete("/api/auth/me/chats");
    expect((await imported(owner, workspaceId, zip)).body).toEqual({ imported: 1, skipped: 0 });
    expect((await owner.agent.get(`${url(workspaceId)}/${chatId}`)).status).toBe(200);
  });

  it("refuses what isn't an export, and what won't fit", async () => {
    const big = await owner.agent.post(url(workspaceId)).send({ content: "x".repeat(900) });
    await finish(big.body.messages[1].id, "Reply");
    const zip = await exported(owner, workspaceId);
    expect((await imported(owner, workspaceId, Buffer.from("nope"))).status).toBe(400);
    expect((await imported(owner, workspaceId, Buffer.from(zipSync({ "chats.json": strToU8("{}") })))).status).toBe(400);
    const other = (await newWorkspace(owner)).id;
    await owner.agent.put("/api/auth/me/chat-settings").send({ maxBytes: 1024, maxDays: null });
    const res = await imported(owner, other, zip);
    expect(res.status).toBe(409);
    expect((await owner.agent.get(url(other))).body.chats).toEqual([]);
  });

  it("needs chat on, and write access, to import", async () => {
    await chatWithPhoto();
    const zip = await exported(owner, workspaceId);
    const viewer = await newUser();
    await addMember(owner, workspaceId, viewer, "viewer");
    expect((await imported(viewer, workspaceId, zip)).status).toBe(403);
    await owner.agent.patch(`/api/workspaces/${workspaceId}/settings`).send({ aiChat: false });
    expect((await imported(owner, workspaceId, zip)).status).toBe(403);
  });
});

describe("the reply stream", () => {
  const events = (body: string) => body.split("\n\n").filter((e) => e.startsWith("id:") || e.startsWith("event:"));

  it("passes the pieces on, then the saved message", async () => {
    const start = await owner.agent.post(url(workspaceId)).send({ content: "Hi" });
    const reply = start.body.messages[1].id as string;
    await publish(reply, { type: "text", text: "Hel" });
    await publish(reply, { type: "text", text: "lo" });
    // Finished once the stream is open: one opened later just gets the result.
    setTimeout(() => void finish(reply, "Hello").then(() => publish(reply, { type: "end" })), 300);

    const res = await owner.agent.get(`${url(workspaceId)}/${start.body.chat.id}/messages/${reply}/stream`).buffer(true).parse((r, done) => {
      let body = "";
      r.on("data", (c: Buffer) => (body += c.toString()));
      r.on("end", () => done(null, body));
    });
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const sent = events(res.body as string);
    expect(sent[0]).toMatch(/event: text\ndata: {"text":"Hel"}/);
    expect(sent[1]).toMatch(/event: text\ndata: {"text":"lo"}/);
    expect(sent[2]).toMatch(/^event: done\ndata: /);
    expect(JSON.parse(sent[2]!.split("data: ")[1]!)).toMatchObject({ id: reply, content: "Hello", status: "done" });
  });

  it("carries on from Last-Event-ID", async () => {
    const start = await owner.agent.post(url(workspaceId)).send({ content: "Hi" });
    const reply = start.body.messages[1].id as string;
    const first = await publish(reply, { type: "text", text: "seen" });
    await publish(reply, { type: "text", text: "new" });
    await publish(reply, { type: "end" });
    const res = await owner.agent.get(`${url(workspaceId)}/${start.body.chat.id}/messages/${reply}/stream`).set("Last-Event-ID", first!).buffer(true).parse((r, done) => {
      let body = "";
      r.on("data", (c: Buffer) => (body += c.toString()));
      r.on("end", () => done(null, body));
    });
    expect(res.body).toContain('"new"');
    expect(res.body).not.toContain('"seen"');
  });

  it("answers at once for a finished reply, and not for a question", async () => {
    const start = await owner.agent.post(url(workspaceId)).send({ content: "Hi" });
    const [question, reply] = start.body.messages as Array<{ id: string }>;
    await finish(reply!.id, "Done already");
    const stream = (id: string) => `${url(workspaceId)}/${start.body.chat.id}/messages/${id}/stream`;
    expect((await owner.agent.get(stream(reply!.id))).text).toContain("Done already");
    expect((await owner.agent.get(stream(question!.id))).status).toBe(404);
  });

  it("marks a reply that never finished as failed", async () => {
    const start = await owner.agent.post(url(workspaceId)).send({ content: "Hi" });
    const reply = start.body.messages[1].id as string;
    await db.update(aiChatMessages).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(aiChatMessages.id, reply));
    const res = await owner.agent.get(`${url(workspaceId)}/${start.body.chat.id}`);
    expect(res.body.messages[1]).toMatchObject({ status: "failed", error: "The reply stopped before it finished" });
  });
});

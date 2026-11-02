import { AI_SERVER_KEY, DEFAULT_SERVER_AI } from "@barista/shared/aiConfig";
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatStreamEvent } from "@barista/shared/jobs";
import { aiChatMessages, serverSettings, workspaceAiConfigs } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { chatQueue } from "../src/queue.js";
import { addMember, newUser, newWorkspace, type TestUser } from "./helpers.js";

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
    expect((await chatQueue.getJob(`chat-${reply}`))?.data).toEqual({ messageId: reply });
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

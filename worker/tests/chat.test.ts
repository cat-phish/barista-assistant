import { randomUUID } from "node:crypto";
import { aiChatMessages, aiChats, beans, brewLogs, users, workspaces } from "@barista/shared/schema";
import type { ChatStreamEvent } from "@barista/shared/jobs";
import { UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient } from "../src/ai/client.js";
import { resolveAi } from "../src/ai/resolve.js";
import { attachedIn, chatTurns, loadAttachments, processChatReply, type ChatPublisher } from "../src/chat.js";
import { db } from "../src/db.js";
import { buildChatRequest, streamReply } from "../src/llm.js";
import { CHAT_SYSTEM } from "../src/prompt.js";

// Real database, fake LLM.
vi.mock("../src/llm.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/llm.js")>()), streamReply: vi.fn() }));
vi.mock("../src/ai/resolve.js", () => ({ resolveAi: vi.fn() }));
const stream = vi.mocked(streamReply);
vi.mocked(resolveAi).mockResolvedValue({ provider: "openai", apiKey: "k", models: { main: "m", vision: "m", web: "m" } } as unknown as AiClient);

const turn = (position: number, role: "user" | "assistant", status = "done") => ({ position, role, status, content: `m${position}` });

describe("chatTurns", () => {
  it("leaves out failed replies and this reply", () => {
    expect(chatTurns([turn(1, "user"), turn(2, "assistant", "failed"), turn(3, "user"), turn(4, "assistant", "pending")], 4)).toEqual([
      { role: "user", content: "m1" },
      { role: "user", content: "m3" },
    ]);
  });
  it("starts on one of the person's", () => {
    const long = Array.from({ length: 51 }, (_, i) => turn(i + 1, i % 2 ? "assistant" : "user"));
    const turns = chatTurns(long, 52);
    expect(turns[0]).toEqual({ role: "user", content: "m13" });
    expect(turns).toHaveLength(39);
  });
});

describe("chatTurns with photos", () => {
  it("puts each photo on the message it came on", () => {
    const messages = [{ ...turn(1, "user"), id: "a" }, { ...turn(2, "assistant"), id: "b" }, { ...turn(3, "user"), id: "c" }];
    const turns = chatTurns(messages, 4, [{ messageId: "c", base64: "AAA" }]);
    expect(turns[0]).toEqual({ role: "user", content: "m1" });
    expect(turns[2]).toEqual({ role: "user", content: [{ type: "text", text: "m3" }, { type: "image_url", image_url: { url: "data:image/webp;base64,AAA" } }] });
  });
});

describe("attachedIn", () => {
  it("takes each item once, from the turns sent, the latest 20", () => {
    const a = (i: number) => ({ kind: "bean" as const, id: `b${i}`, label: `B${i}` });
    const messages = [
      { ...turn(1, "user"), attachments: Array.from({ length: 25 }, (_, i) => a(i)) },
      { ...turn(2, "assistant", "failed") },
      { ...turn(3, "user"), attachments: [a(24)] },
    ];
    const sent = attachedIn(messages, 4);
    expect(sent).toHaveLength(20);
    expect(sent.at(-1)!.id).toBe("b24");
    expect(sent.filter((x) => x.id === "b24")).toHaveLength(1);
    expect(attachedIn(messages, 1)).toEqual([]);
  });
});

describe("loadAttachments", () => {
  let workspaceId: string;
  let beanId: string;
  let brewId: string;
  const attach = (kind: "bean" | "brew" | "recipe", id: string) => ({ kind, id, label: "L" });

  beforeEach(async () => {
    workspaceId = randomUUID();
    beanId = randomUUID();
    brewId = randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: workspaceId });
    await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji", country: "Ethiopia", altitudeMasl: 2100 });
    await db.insert(brewLogs).values({ id: brewId, workspaceId, beanId, timestamp: new Date("2026-10-02T08:00:00Z"), actualDoseGrams: 15, actualTimeSec: 180, actualTempC: 94, rating: null });
  });

  it("sends a bean and a brew in full, whatever the workspace hides from analyses", async () => {
    await db.update(workspaces).set({ settings: { aiHidden: ["origin", "temp", "analyzeUnrated", "unratedHistory"] } }).where(eq(workspaces.id, workspaceId));
    const [bean, brew] = await loadAttachments([attach("bean", beanId), attach("brew", brewId)], workspaceId);
    expect(bean).toMatchObject({ kind: "bean", data: { beanName: "Guji", country: "Ethiopia", altitudeMasl: 2100 } });
    expect(brew).toMatchObject({ kind: "brew", data: { bean: { country: "Ethiopia" }, brew: { actualDoseGrams: 15, actualTempC: 94 } } });
  });

  it("marks what's gone or from another workspace as unavailable", async () => {
    const other = randomUUID();
    await db.insert(workspaces).values({ id: other, name: "O", slug: other });
    const seen = await loadAttachments([attach("bean", beanId), attach("recipe", randomUUID())], other);
    expect(seen).toEqual([{ kind: "bean", label: "L", unavailable: true }, { kind: "recipe", label: "L", unavailable: true }]);
  });
});

describe("buildChatRequest", () => {
  it("is the conversation, with no schema, and the person's instructions", () => {
    const request = buildChatRequest("m", [{ role: "user", content: "Hi" }], { prompt: { instructions: "Be brief.", labelInstructions: null, overrides: {} }, note: null });
    expect(request.response_format).toBeUndefined();
    expect(request.messages[0]).toEqual({ role: "system", content: `${CHAT_SYSTEM} The barista's own instructions: Be brief.` });
    expect(request.messages[1]).toEqual({ role: "user", content: "Hi" });
  });
  it("puts attachments in the system prompt", () => {
    const request = buildChatRequest("m", [{ role: "user", content: "Hi" }], undefined, [{ kind: "bean", label: "Guji", data: { beanName: "Guji" } }]);
    expect(String(request.messages[0]!.content)).toContain('[{"kind":"bean","label":"Guji","data":{"beanName":"Guji"}}]');
  });
});

describe("processChatReply", () => {
  let chatId: string;
  let replyId: string;
  let events: ChatStreamEvent[];
  const publisher: ChatPublisher = { publish: async (_id, event) => void events.push(event) };
  const saved = async () => (await db.select().from(aiChatMessages).where(eq(aiChatMessages.id, replyId)))[0]!;
  const text = () => events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");

  beforeEach(async () => {
    stream.mockReset();
    events = [];
    const userId = randomUUID();
    const workspaceId = randomUUID();
    chatId = randomUUID();
    replyId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x" });
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: workspaceId });
    await db.insert(aiChats).values({ id: chatId, workspaceId, userId, title: "T" });
    await db.insert(aiChatMessages).values([
      { id: randomUUID(), chatId, position: 1, role: "user", content: "Why sour?", status: "done" },
      { id: replyId, chatId, position: 2, role: "assistant", content: "", status: "pending" },
    ]);
  });

  it("publishes the reply as it's written and saves it, then ends", async () => {
    stream.mockImplementation(async (_ai, _request, onText) => {
      onText("Grind ");
      onText("finer.");
      return { refusal: null, usage: { promptTokens: 5, completionTokens: 2 } };
    });
    expect(await processChatReply({ messageId: replyId, photos: [] }, publisher)).toEqual({ status: "saved" });
    expect(text()).toBe("Grind finer.");
    expect(events.at(-1)).toEqual({ type: "end" });
    expect(await saved()).toMatchObject({ content: "Grind finer.", status: "done", model: "m", promptTokens: 5, completionTokens: 2 });
    expect(stream.mock.calls[0]![1].messages[1]).toEqual({ role: "user", content: "Why sour?" });
  });

  it("uses the vision model when photos are sent", async () => {
    vi.mocked(resolveAi).mockResolvedValueOnce({ provider: "openai", apiKey: "k", models: { main: "m", vision: "v", web: "m" } } as unknown as AiClient);
    stream.mockImplementation(async (_ai, _request, onText) => {
      onText("A puck");
      return { refusal: null, usage: null };
    });
    const [first] = await db.select({ id: aiChatMessages.id }).from(aiChatMessages).where(and(eq(aiChatMessages.chatId, chatId), eq(aiChatMessages.position, 1)));
    await processChatReply({ messageId: replyId, photos: [{ messageId: first!.id, base64: "AAA" }] }, publisher);
    expect(stream.mock.calls[0]![1].model).toBe("v");
    expect(await saved()).toMatchObject({ model: "v" });
  });

  it("keeps what was written when the AI fails part way, and still ends", async () => {
    stream.mockImplementation(async (_ai, _request, onText) => {
      onText("Grind");
      throw new UnrecoverableError("OpenAI rejected the request (400): nope");
    });
    expect(await processChatReply({ messageId: replyId, photos: [] }, publisher)).toEqual({ status: "failed" });
    expect(await saved()).toMatchObject({ content: "Grind", status: "failed", error: "The AI service refused the request" });
    expect(events.at(-1)).toEqual({ type: "end" });
  });

  it("treats a refusal or an empty reply as failed", async () => {
    stream.mockResolvedValueOnce({ refusal: null, usage: null });
    expect(await processChatReply({ messageId: replyId, photos: [] }, publisher)).toEqual({ status: "failed" });
    await db.update(aiChatMessages).set({ status: "pending", error: null }).where(eq(aiChatMessages.id, replyId));
    stream.mockResolvedValueOnce({ refusal: "No", usage: null });
    expect(await processChatReply({ messageId: replyId, photos: [] }, publisher)).toEqual({ status: "failed" });
  });

  it("skips a chat that's gone or a reply already finished", async () => {
    await db.update(aiChatMessages).set({ status: "done" }).where(eq(aiChatMessages.id, replyId));
    expect((await processChatReply({ messageId: replyId, photos: [] }, publisher)).status).toBe("skipped");
    await db.delete(aiChats).where(eq(aiChats.id, chatId));
    expect((await processChatReply({ messageId: replyId, photos: [] }, publisher)).status).toBe("skipped");
    expect(stream).not.toHaveBeenCalled();
  });
});

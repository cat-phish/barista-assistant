import { randomUUID } from "node:crypto";
import { aiChatMessages, aiChats, users, workspaces } from "@barista/shared/schema";
import type { ChatStreamEvent } from "@barista/shared/jobs";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient } from "../src/ai/client.js";
import { resolveAi } from "../src/ai/resolve.js";
import { chatTurns, processChatReply, type ChatPublisher } from "../src/chat.js";
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

describe("buildChatRequest", () => {
  it("is the conversation, with no schema, and the person's instructions", () => {
    const request = buildChatRequest("m", [{ role: "user", content: "Hi" }], { prompt: { instructions: "Be brief.", labelInstructions: null, overrides: {} }, note: null });
    expect(request.response_format).toBeUndefined();
    expect(request.messages[0]).toEqual({ role: "system", content: `${CHAT_SYSTEM} The barista's own instructions: Be brief.` });
    expect(request.messages[1]).toEqual({ role: "user", content: "Hi" });
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
    expect(await processChatReply({ messageId: replyId }, publisher)).toEqual({ status: "saved" });
    expect(text()).toBe("Grind finer.");
    expect(events.at(-1)).toEqual({ type: "end" });
    expect(await saved()).toMatchObject({ content: "Grind finer.", status: "done", model: "m", promptTokens: 5, completionTokens: 2 });
    expect(stream.mock.calls[0]![1].messages[1]).toEqual({ role: "user", content: "Why sour?" });
  });

  it("keeps what was written when the AI fails part way, and still ends", async () => {
    stream.mockImplementation(async (_ai, _request, onText) => {
      onText("Grind");
      throw new UnrecoverableError("OpenAI rejected the request (400): nope");
    });
    expect(await processChatReply({ messageId: replyId }, publisher)).toEqual({ status: "failed" });
    expect(await saved()).toMatchObject({ content: "Grind", status: "failed", error: "The AI service refused the request" });
    expect(events.at(-1)).toEqual({ type: "end" });
  });

  it("treats a refusal or an empty reply as failed", async () => {
    stream.mockResolvedValueOnce({ refusal: null, usage: null });
    expect(await processChatReply({ messageId: replyId }, publisher)).toEqual({ status: "failed" });
    await db.update(aiChatMessages).set({ status: "pending", error: null }).where(eq(aiChatMessages.id, replyId));
    stream.mockResolvedValueOnce({ refusal: "No", usage: null });
    expect(await processChatReply({ messageId: replyId }, publisher)).toEqual({ status: "failed" });
  });

  it("skips a chat that's gone or a reply already finished", async () => {
    await db.update(aiChatMessages).set({ status: "done" }).where(eq(aiChatMessages.id, replyId));
    expect((await processChatReply({ messageId: replyId }, publisher)).status).toBe("skipped");
    await db.delete(aiChats).where(eq(aiChats.id, chatId));
    expect((await processChatReply({ messageId: replyId }, publisher)).status).toBe("skipped");
    expect(stream).not.toHaveBeenCalled();
  });
});

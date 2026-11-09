import { randomUUID } from "node:crypto";
import { aiChatMessages, aiChats, users, workspaces } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient } from "../src/ai/client.js";
import { resolveAi } from "../src/ai/resolve.js";
import { chatTurns } from "../src/chat.js";
import { KEEP_RECENT, processChatSummary } from "../src/chatSummary.js";
import { db } from "../src/db.js";
import { buildChatRequest, complete } from "../src/llm.js";
import { CHAT_SUMMARY_SYSTEM } from "../src/prompt.js";

// Summarize and continue (docs/api/chat.md §12, "Long chats"): real database, fake LLM.
vi.mock("../src/llm.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/llm.js")>()), complete: vi.fn() }));
vi.mock("../src/ai/resolve.js", () => ({ resolveAi: vi.fn() }));
const llm = vi.mocked(complete);
vi.mocked(resolveAi).mockResolvedValue({ provider: "openai", apiKey: "k", models: { main: "m", vision: "m", web: "m" } } as unknown as AiClient);
const answer = (content: string) => llm.mockResolvedValueOnce({ message: { content } as never, usage: null });

const turn = (position: number, role: "user" | "assistant") => ({ position, role, status: "done", content: `m${position}` });

describe("chatTurns after a summary", () => {
  it("leaves out what the summary covers", () => {
    const messages = Array.from({ length: 30 }, (_, i) => turn(i + 1, i % 2 ? "assistant" : "user"));
    const turns = chatTurns(messages, 31, [], 20);
    expect(turns[0]).toEqual({ role: "user", content: "m21" });
    expect(turns).toHaveLength(10);
  });
  it("puts the summary in the system prompt", () => {
    const request = buildChatRequest("m", [{ role: "user", content: "Hi" }], undefined, [], "They dialed in a Guji at 18 clicks.");
    expect(request.messages[0]!.content).toContain("summary of it, written then: They dialed in a Guji at 18 clicks.");
    expect(buildChatRequest("m", [{ role: "user", content: "Hi" }]).messages[0]!.content).not.toContain("summary of it");
  });
});

describe("processChatSummary", () => {
  let chatId: string;
  beforeEach(async () => {
    llm.mockReset();
    const userId = randomUUID();
    const workspaceId = randomUUID();
    chatId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x" });
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: workspaceId });
    await db.insert(aiChats).values({ id: chatId, workspaceId, userId, title: "T", summaryStatus: "pending" });
    await db.insert(aiChatMessages).values(
      Array.from({ length: 24 }, (_, i) => ({
        id: randomUUID(),
        chatId,
        position: i + 1,
        role: i % 2 ? ("assistant" as const) : ("user" as const),
        content: `m${i + 1}`,
        status: "done" as const,
        attachments: i === 0 ? [{ kind: "period" as const, id: randomUUID(), label: "Brews, last 7 days" }] : null,
      })),
    );
  });
  const chat = async () => (await db.select().from(aiChats).where(eq(aiChats.id, chatId)))[0]!;

  it("covers all but the newest messages, with what was attached", async () => {
    answer("A summary.");
    expect(await processChatSummary({ chatId })).toEqual({ status: "saved" });
    expect(await chat()).toMatchObject({ summary: "A summary.", summaryThrough: 24 - KEEP_RECENT, summaryStatus: null });
    const [, request] = llm.mock.calls[0]!;
    expect(request.messages[0]!.content).toBe(CHAT_SUMMARY_SYSTEM);
    const sent = JSON.parse(request.messages[1]!.content as string) as { messages: Array<{ content: string; attached?: string[] }> };
    expect(sent.messages).toHaveLength(24 - KEEP_RECENT);
    expect(sent.messages[0]).toEqual({ role: "user", content: "m1", attached: ["period: Brews, last 7 days"] });
  });

  it("folds in the earlier summary and only covers what's new", async () => {
    await db.update(aiChats).set({ summary: "Earlier.", summaryThrough: 10 }).where(eq(aiChats.id, chatId));
    answer("Both.");
    await processChatSummary({ chatId });
    const sent = JSON.parse(llm.mock.calls[0]![1].messages[1]!.content as string) as { earlierSummary: string; messages: Array<{ content: string }> };
    expect(sent.earlierSummary).toBe("Earlier.");
    expect(sent.messages.map((m) => m.content)).toEqual(["m11", "m12", "m13", "m14"]);
    expect(await chat()).toMatchObject({ summary: "Both.", summaryThrough: 14 });
  });

  it("keeps the old summary when it fails", async () => {
    await db.update(aiChats).set({ summary: "Earlier.", summaryThrough: 4 }).where(eq(aiChats.id, chatId));
    llm.mockRejectedValueOnce(new Error("down"));
    expect(await processChatSummary({ chatId })).toEqual({ status: "failed" });
    expect(await chat()).toMatchObject({ summary: "Earlier.", summaryThrough: 4, summaryStatus: "failed" });
  });

  it("does nothing unless asked", async () => {
    await db.update(aiChats).set({ summaryStatus: null }).where(eq(aiChats.id, chatId));
    expect((await processChatSummary({ chatId })).status).toBe("skipped");
    expect(llm).not.toHaveBeenCalled();
  });
});

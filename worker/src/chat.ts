// Chat replies (docs/api/llm-contract.md §9e): the worker calls the model and
// publishes the reply to a Redis stream as it's written, for the backend to
// pass on (docs/api/chat.md §12), then saves it on the message.
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatJobData, type ChatStreamEvent } from "@barista/shared/jobs";
import { aiChatMessages, aiChats } from "@barista/shared/schema";
import { UnrecoverableError } from "bullmq";
import { asc, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { db } from "./db.js";
import { resolveAi } from "./ai/resolve.js";
import { buildChatRequest, streamReply, type ChatTurn } from "./llm.js";
import { failureMessage, promptFor } from "./processor.js";

const HISTORY_MESSAGES = 40;
const FLUSH_MS = 50;
const STREAM_TTL_SECONDS = 300;

export interface ChatPublisher {
  publish(messageId: string, event: ChatStreamEvent): Promise<void>;
}
export function redisPublisher(redis: Redis): ChatPublisher {
  return {
    async publish(messageId, event) {
      const key = chatReplyKey(messageId);
      await redis.xadd(key, "*", CHAT_EVENT_FIELD, JSON.stringify(event));
      await redis.expire(key, STREAM_TTL_SECONDS);
    },
  };
}

// What the AI is sent: the finished messages before this reply, starting on
// one of the person's.
export function chatTurns(messages: ReadonlyArray<{ role: ChatTurn["role"]; content: string; status: string; position: number }>, before: number): ChatTurn[] {
  const recent = messages.filter((m) => m.position < before && m.status === "done").slice(-HISTORY_MESSAGES);
  const first = recent.findIndex((m) => m.role === "user");
  return first < 0 ? [] : recent.slice(first).map(({ role, content }) => ({ role, content }));
}

// Collects pieces and publishes them about every FLUSH_MS, so a fast model
// doesn't mean a Redis write per token.
function batched(messageId: string, publisher: ChatPublisher): { add(text: string): void; flush(): Promise<void> } {
  let waiting = "";
  let last = 0;
  let sending: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    const text = waiting;
    waiting = "";
    last = Date.now();
    if (text) sending = sending.then(() => publisher.publish(messageId, { type: "text", text }));
    return sending;
  };
  return {
    add(text) {
      waiting += text;
      if (Date.now() - last >= FLUSH_MS) void flush().catch(() => undefined);
    },
    flush,
  };
}

export type ChatResult = { status: "saved" | "failed" } | { status: "skipped"; reason: string };

// Never throws for a failed reply: it's saved as failed, with one attempt.
export async function processChatReply({ messageId }: ChatJobData, publisher: ChatPublisher): Promise<ChatResult> {
  const [row] = await db.select({ message: aiChatMessages, chat: aiChats }).from(aiChatMessages).innerJoin(aiChats, eq(aiChatMessages.chatId, aiChats.id)).where(eq(aiChatMessages.id, messageId));
  if (!row) return { status: "skipped", reason: "chat no longer exists" };
  if (row.message.status !== "pending") return { status: "skipped", reason: `already ${row.message.status}` };

  const pieces = batched(messageId, publisher);
  let written = "";
  let result: ChatResult = { status: "saved" };
  try {
    const messages = await db.select().from(aiChatMessages).where(eq(aiChatMessages.chatId, row.chat.id)).orderBy(asc(aiChatMessages.position));
    const ai = await resolveAi(row.chat.workspaceId);
    const custom = await promptFor(row.chat.userId, null);
    const request = buildChatRequest(ai.models.main, chatTurns(messages, row.message.position), custom);
    const reply = await streamReply(ai, request, (text) => {
      written += text;
      pieces.add(text);
    });
    await pieces.flush();
    if (reply.refusal) throw new UnrecoverableError(reply.refusal);
    if (!written) throw new Error("The AI returned an empty reply");
    await db
      .update(aiChatMessages)
      .set({ content: written, status: "done", model: ai.models.main, promptTokens: reply.usage?.promptTokens ?? null, completionTokens: reply.usage?.completionTokens ?? null })
      .where(eq(aiChatMessages.id, messageId));
  } catch (err) {
    console.error(`Chat reply ${messageId} failed: ${err instanceof Error ? err.message : String(err)}`);
    result = { status: "failed" };
    await db
      .update(aiChatMessages)
      .set({ content: written, status: "failed", error: failureMessage(err instanceof UnrecoverableError) })
      .where(eq(aiChatMessages.id, messageId));
  }
  await pieces.flush().catch(() => undefined);
  await publisher.publish(messageId, { type: "end" });
  return result;
}

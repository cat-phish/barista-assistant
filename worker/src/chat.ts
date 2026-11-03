// Chat replies (docs/api/llm-contract.md §9e): the worker calls the model and
// publishes the reply to a Redis stream as it's written, for the backend to
// pass on (docs/api/chat.md §12), then saves it on the message.
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatJobData, type ChatJobPhoto, type ChatStreamEvent } from "@barista/shared/jobs";
import { aiChatMessages, aiChats, beans, brewLogs, DEFAULT_WORKSPACE_SETTINGS, recipes, withDefaults, workspaces, type ChatAttachment } from "@barista/shared/schema";
import { UnrecoverableError } from "bullmq";
import { and, asc, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { loadBean, loadBrewContext, loadRecipe } from "./context.js";
import { db } from "./db.js";
import { resolveAi } from "./ai/resolve.js";
import { buildChatRequest, streamReply, type ChatTurn } from "./llm.js";
import { failureMessage, promptFor } from "./processor.js";
import { beanInput, compact, recipeInput, toLlmInput, type LlmInput } from "./prompt.js";

const HISTORY_MESSAGES = 40;
const NOTHING_HIDDEN = new Set<never>();
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
interface StoredTurn {
  id?: string;
  role: ChatTurn["role"];
  content: string;
  status: string;
  position: number;
  attachments?: ChatAttachment[] | null;
}
function recentTurns<T extends StoredTurn>(messages: readonly T[], before: number): T[] {
  const recent = messages.filter((m) => m.position < before && m.status === "done").slice(-HISTORY_MESSAGES);
  const first = recent.findIndex((m) => m.role === "user");
  return first < 0 ? [] : recent.slice(first);
}
export function chatTurns(messages: readonly StoredTurn[], before: number, photos: readonly ChatJobPhoto[] = []): ChatTurn[] {
  return recentTurns(messages, before).map(({ id, role, content }): ChatTurn => {
    if (role === "assistant") return { role, content };
    const images = photos.filter((p) => p.messageId === id);
    if (!images.length) return { role, content };
    return {
      role,
      content: [{ type: "text", text: content }, ...images.map((p) => ({ type: "image_url" as const, image_url: { url: `data:image/webp;base64,${p.base64}` } }))],
    };
  });
}
// What those turns attached: each item once, the latest `max` (the
// workspace's chatMaxAttachments, docs/api/chat.md §12).
export function attachedIn(messages: readonly StoredTurn[], before: number, max: number): ChatAttachment[] {
  const all = recentTurns(messages, before).flatMap((m) => m.attachments ?? []);
  const unique = [...new Map(all.map((a) => [`${a.kind}:${a.id}`, a])).values()];
  return unique.slice(-max);
}
async function attachmentLimit(workspaceId: string): Promise<number> {
  const [row] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return withDefaults(DEFAULT_WORKSPACE_SETTINGS, row?.settings ?? null).chatMaxAttachments;
}

// One attachment as the AI sees it, read now and only from this workspace, in
// full: Settings → AI tunes the analysis and suggestions, not chat. null: it's gone.
async function attachmentInput(a: ChatAttachment, workspaceId: string): Promise<Record<string, unknown> | null> {
  if (a.kind === "brew") {
    const [own] = await db.select({ id: brewLogs.id }).from(brewLogs).where(and(eq(brewLogs.id, a.id), eq(brewLogs.workspaceId, workspaceId)));
    const context = own ? await loadBrewContext(a.id) : null;
    return context && toLlmInput(context);
  }
  if (a.kind === "bean") {
    const [own] = await db.select({ id: beans.id }).from(beans).where(and(eq(beans.id, a.id), eq(beans.workspaceId, workspaceId)));
    const bean = own ? await loadBean(a.id) : null;
    return bean && beanInput(bean.info, NOTHING_HIDDEN);
  }
  const [own] = await db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.id, a.id), eq(recipes.workspaceId, workspaceId)));
  const recipe = own ? await loadRecipe(a.id) : null;
  return recipe && recipeInput(recipe, NOTHING_HIDDEN);
}

export async function loadAttachments(attachments: ChatAttachment[], workspaceId: string): Promise<LlmInput[]> {
  return Promise.all(
    attachments.map(async (a) => {
      const data = await attachmentInput(a, workspaceId);
      return (compact({ kind: a.kind, label: a.label, ...(data ? { data } : { unavailable: true }) }) ?? {}) as LlmInput;
    }),
  );
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
export async function processChatReply({ messageId, photos }: ChatJobData, publisher: ChatPublisher): Promise<ChatResult> {
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
    const attached = await loadAttachments(attachedIn(messages, row.message.position, await attachmentLimit(row.chat.workspaceId)), row.chat.workspaceId);
    const turns = chatTurns(messages, row.message.position, photos);
    const model = turns.some((t) => typeof t.content !== "string") ? ai.models.vision : ai.models.main;
    const request = buildChatRequest(model, turns, custom, attached);
    const reply = await streamReply(ai, request, (text) => {
      written += text;
      pieces.add(text);
    });
    await pieces.flush();
    if (reply.refusal) throw new UnrecoverableError(reply.refusal);
    if (!written) throw new Error("The AI returned an empty reply");
    await db
      .update(aiChatMessages)
      .set({ content: written, status: "done", model, promptTokens: reply.usage?.promptTokens ?? null, completionTokens: reply.usage?.completionTokens ?? null })
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

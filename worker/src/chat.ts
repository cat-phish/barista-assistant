// Chat replies (docs/api/llm-contract.md §9e): the worker calls the model and
// publishes the reply to a Redis stream as it's written, for the backend to
// pass on (docs/api/chat.md §12), then saves it on the message.
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatJobData, type ChatJobPhoto, type ChatStreamEvent } from "@barista/shared/jobs";
import { aiChatMessages, aiChats, beans, brewLogs, DEFAULT_WORKSPACE_SETTINGS, recipes, users, withDefaults, workspaces, type ChatAttachment, type ChatProposal } from "@barista/shared/schema";
import { UnrecoverableError } from "bullmq";
import { and, asc, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { loadBean, loadBrewContext, loadRecipe } from "./context.js";
import { periodInput, type PeriodOwner } from "./chatPeriodInput.js";
import { checkProposals, proposalFilter, refOf, refTable, splitProposals } from "./chatProposals.js";
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
  proposals?: ChatProposal[] | null;
}
// after: the last position a summary covers (docs/api/chat.md §12, "Long
// chats"); those go as the summary instead.
function recentTurns<T extends StoredTurn>(messages: readonly T[], before: number, after = 0): T[] {
  const recent = messages.filter((m) => m.position > after && m.position < before && m.status === "done").slice(-HISTORY_MESSAGES);
  const first = recent.findIndex((m) => m.role === "user");
  return first < 0 ? [] : recent.slice(first);
}
export function chatTurns(messages: readonly StoredTurn[], before: number, photos: readonly ChatJobPhoto[] = [], after = 0): ChatTurn[] {
  return recentTurns(messages, before, after).map(({ id, role, content, proposals }): ChatTurn => {
    if (role === "assistant") return { role, content: withProposals(content, proposals) };
    const images = photos.filter((p) => p.messageId === id);
    if (!images.length) return { role, content };
    return {
      role,
      content: [{ type: "text", text: content }, ...images.map((p) => ({ type: "image_url" as const, image_url: { url: `data:image/webp;base64,${p.base64}` } }))],
    };
  });
}
// A reply's proposals were taken out of its text, so the AI is told what it
// proposed and whether the person dismissed it.
export function withProposals(content: string, proposals: readonly ChatProposal[] | null | undefined): string {
  if (!proposals?.length) return content;
  const shown = proposals.map(({ state, ...p }) => ({ ...p, dismissed: state === "dismissed" }));
  return `${content}\n\n[Shown as proposal cards with this reply: ${JSON.stringify(shown)}]`;
}

// What the chat attached before this reply, however far back (an item
// attached early still counts once the message itself is out of the window):
// each item once, the latest `max` (the workspace's chatMaxAttachments,
// docs/api/chat.md §12).
export function attachedIn(messages: readonly StoredTurn[], before: number, max: number): ChatAttachment[] {
  const all = messages.filter((m) => m.position < before && m.status === "done").flatMap((m) => m.attachments ?? []);
  const unique = [...new Map(all.map((a) => [`${a.kind}:${a.id}`, a])).values()];
  return unique.slice(-max);
}
async function attachmentLimit(workspaceId: string): Promise<number> {
  const [row] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return withDefaults(DEFAULT_WORKSPACE_SETTINGS, row?.settings ?? null).chatMaxAttachments;
}

// One attachment as the AI sees it, read now and only from this workspace, in
// full: Settings → AI tunes the analysis and suggestions, not chat. null: it's gone.
async function attachmentInput(a: ChatAttachment, workspaceId: string, owner: PeriodOwner): Promise<Record<string, unknown> | null> {
  // A period is its filters, run again now (docs/api/chat.md §12, "Periods").
  if (a.kind === "period") return a.period ? periodInput(a.period, workspaceId, owner) : null;
  // A chart is its snapshot, as the person saw it (docs/api/chat.md §12).
  if (a.kind === "chart") {
    if (!a.chart) return null;
    const { tab, note, filters, head, rows, cut } = a.chart;
    return { insightsTab: tab, note, covers: filters, columns: head, rows, ...(cut ? { rowsLeftOut: cut } : {}) };
  }
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

export async function loadAttachments(attachments: ChatAttachment[], workspaceId: string, owner: PeriodOwner = { userId: null }): Promise<LlmInput[]> {
  return Promise.all(
    attachments.map(async (a, i) => {
      const data = await attachmentInput(a, workspaceId, owner);
      return (compact({ ref: refOf(i), kind: a.kind, label: a.label, ...(data ? { data } : { unavailable: true }) }) ?? {}) as LlmInput;
    }),
  );
}

// The chat's owner, for a period's Only mine, with their own cap on its brews.
async function periodOwner(userId: string): Promise<PeriodOwner> {
  const [row] = await db.select({ limits: users.chatLimits }).from(users).where(eq(users.id, userId));
  return { userId, periodMaxBrews: row?.limits?.periodMaxBrews ?? null };
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
    const attachments = attachedIn(messages, row.message.position, await attachmentLimit(row.chat.workspaceId));
    const attached = await loadAttachments(attachments, row.chat.workspaceId, await periodOwner(row.chat.userId));
    const turns = chatTurns(messages, row.message.position, photos, row.chat.summary ? (row.chat.summaryThrough ?? 0) : 0);
    const model = turns.some((t) => typeof t.content !== "string") ? ai.models.vision : ai.models.main;
    const request = buildChatRequest(model, turns, custom, attached, row.chat.summary);
    const shown = proposalFilter((text) => pieces.add(text));
    const reply = await streamReply(ai, request, (text) => {
      written += text;
      shown.add(text);
    });
    shown.end();
    await pieces.flush();
    if (reply.refusal) throw new UnrecoverableError(reply.refusal);
    const { text, blocks } = splitProposals(written);
    const proposals = checkProposals(blocks, blocks.length ? await refTable(attachments, row.chat.workspaceId) : new Map());
    if (!text && !proposals.length) throw new Error("The AI returned an empty reply");
    await db
      .update(aiChatMessages)
      .set({ content: text, proposals: proposals.length ? proposals : null, status: "done", model, promptTokens: reply.usage?.promptTokens ?? null, completionTokens: reply.usage?.completionTokens ?? null })
      .where(eq(aiChatMessages.id, messageId));
  } catch (err) {
    console.error(`Chat reply ${messageId} failed: ${err instanceof Error ? err.message : String(err)}`);
    result = { status: "failed" };
    await db
      .update(aiChatMessages)
      .set({ content: splitProposals(written).text, status: "failed", error: failureMessage(err instanceof UnrecoverableError) })
      .where(eq(aiChatMessages.id, messageId));
  }
  await pieces.flush().catch(() => undefined);
  await publisher.publish(messageId, { type: "end" });
  return result;
}

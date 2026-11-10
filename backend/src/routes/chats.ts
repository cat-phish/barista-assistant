// AI chat (docs/api/chat.md §12): a person's own conversations. Every query
// is scoped to the caller, so someone else's chat is a 404.
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatJobPhoto, type ChatStreamEvent } from "@barista/shared/jobs";
import { effectiveChatLimits, NO_CHAT_LIMITS, type ChatLimits, type OwnChatLimits, type ServerChatLimits } from "@barista/shared/aiConfig";
import { aiChatMessages, aiChatPhotos, aiChats, beans, brewLogs, CHAT_ATTACHMENT_KINDS, DEFAULT_WORKSPACE_SETTINGS, MAX_CHAT_ATTACHMENTS, recipes, users, withDefaults, workspaceMembers, workspaces, type AiChat, type AiChatMessage, type ChatAttachment, CHAT_PROPOSAL_STATES, type ChatProposal } from "@barista/shared/schema";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import express, { Router, type Request, type Response } from "express";
import { Redis } from "ioredis";
import { z } from "zod";
import { chartSnapshotSchema } from "../chatChart.js";
import { labelPeriod, periodSpecSchema } from "../chatPeriod.js";
import { requireAi } from "../aiConfig.js";
import { buildChatsZip, importChats } from "../chatExport.js";
import { deleteAllChatsOf, ownChatLimitsSchema, deleteChats, pinnedChatsOf, pruneChatsOf, userChatBytes, wouldDelete } from "../chatData.js";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { chatPhotoPath, PHOTO_MAX_UPLOAD_BYTES, processPhoto, writeChatPhotoFile } from "../photos.js";
import { enqueueChatReply, enqueueChatSummary, QueueUnavailableError } from "../queue.js";
import { getChatLimits } from "../serverSettings.js";

export const CHAT_MESSAGE_MAX = 4000;
const CHAT_PHOTOS_MAX = 4;
// What a reply is sent, for the model and for the job's size.
const PHOTOS_SENT = 6;
const TITLE_MAX = 60;
// Longer than any reply takes: the worker died.
const STALE_MS = 10 * 60_000;
const STREAM_BLOCK_MS = 10_000;

export interface ChatPhoto {
  id: string;
  width: number;
  height: number;
}
type ChatMessage = Omit<AiChatMessage, "chatId" | "promptTokens" | "completionTokens" | "attachments" | "proposals"> & { attachments: ChatAttachment[]; proposals: ChatProposal[]; photos: ChatPhoto[] };
export interface ChatPair {
  chat: AiChat;
  messages: ChatMessage[];
}

const MESSAGE_COLUMNS = {
  id: aiChatMessages.id,
  position: aiChatMessages.position,
  role: aiChatMessages.role,
  content: aiChatMessages.content,
  attachments: aiChatMessages.attachments,
  proposals: aiChatMessages.proposals,
  status: aiChatMessages.status,
  error: aiChatMessages.error,
  model: aiChatMessages.model,
  createdAt: aiChatMessages.createdAt,
};

// A brew, bean or recipe by reference; a chart with its snapshot; a period
// with its filters.
const attachmentSchema = z.union([
  z.object({ kind: z.enum(CHAT_ATTACHMENT_KINDS.filter((k) => k !== "chart" && k !== "period") as ["brew", "bean", "recipe"]), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("chart"), id: z.string().uuid(), chart: chartSnapshotSchema }).strict(),
  z.object({ kind: z.literal("period"), id: z.string().uuid(), period: periodSpecSchema }).strict(),
]);
type AttachmentRef = z.infer<typeof attachmentSchema>;
const sendSchema = z.object({ content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX), attachments: z.array(attachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional(), photoIds: z.array(z.string().uuid()).max(CHAT_PHOTOS_MAX).optional() }).strict();
const titleOf = (content: string): string => {
  const line = content.split("\n")[0]!.trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
};

// Whether this person can send here: the workspace's switch and their own.
async function chatOn(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ settings: workspaces.settings, enabled: workspaceMembers.chatEnabled })
    .from(workspaces)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(eq(workspaces.id, workspaceId));
  return !!row && row.enabled && withDefaults(DEFAULT_WORKSPACE_SETTINGS, row.settings).aiChat;
}
// The workspace's own limit on a message's attachments, up to MAX_CHAT_ATTACHMENTS.
async function underAttachmentLimit(res: Response, workspaceId: string, attachments: readonly AttachmentRef[] = []): Promise<boolean> {
  const [row] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const max = withDefaults(DEFAULT_WORKSPACE_SETTINGS, row?.settings ?? null).chatMaxAttachments;
  if (attachments.length <= max) return true;
  sendError(res, 400, `A message can attach up to ${max} items here`);
  return false;
}
async function requireChatOn(res: Response, userId: string, workspaceId: string): Promise<boolean> {
  if (await chatOn(userId, workspaceId)) return true;
  sendError(res, 403, "Chat is turned off here", { code: "chat_off" });
  return false;
}

async function requireUnderDailyLimit(res: Response, userId: string, limits: ServerChatLimits): Promise<boolean> {
  if (limits.dailyMessages === null) return true;
  const [row] = await db
    .select({ n: count() })
    .from(aiChatMessages)
    .innerJoin(aiChats, eq(aiChatMessages.chatId, aiChats.id))
    .where(and(eq(aiChats.userId, userId), eq(aiChatMessages.role, "user"), gte(aiChatMessages.createdAt, new Date(Date.now() - 24 * 3600_000))));
  if ((row?.n ?? 0) < limits.dailyMessages) return true;
  sendError(res, 429, "You've reached the daily limit for chat messages. Try again later.", { code: "chat_limit" });
  return false;
}

type Params = { workspaceId: string };
type ChatParams = Params & { chatId: string };
type StreamParams = ChatParams & { messageId: string };

async function ownChat(res: Response, userId: string, workspaceId: string, chatId: string): Promise<AiChat | null> {
  const [chat] = await db
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.id, chatId), eq(aiChats.workspaceId, workspaceId), eq(aiChats.userId, userId)));
  if (!chat) sendError(res, 404, "Chat not found");
  return chat ?? null;
}

const STALE_ERROR = "The reply stopped before it finished";
// A reply or a summary still pending after STALE_MS: the worker died, so it's
// marked failed and the chat can be used again (docs/api/chat.md §12).
function settleStale(chatId: string): Promise<unknown> {
  const cutoff = new Date(Date.now() - STALE_MS);
  return Promise.all([
    db
      .update(aiChatMessages)
      .set({ status: "failed", error: STALE_ERROR })
      .where(and(eq(aiChatMessages.chatId, chatId), eq(aiChatMessages.status, "pending"), lt(aiChatMessages.createdAt, cutoff))),
    db
      .update(aiChats)
      .set({ summaryStatus: "failed" })
      .where(and(eq(aiChats.id, chatId), eq(aiChats.summaryStatus, "pending"), lt(aiChats.summaryRequestedAt, cutoff))),
  ]);
}

type MessageRow = Omit<ChatMessage, "attachments" | "proposals" | "photos"> & { attachments: ChatAttachment[] | null; proposals: ChatProposal[] | null };
async function shown(rows: MessageRow[]): Promise<ChatMessage[]> {
  const ids = rows.map((m) => m.id);
  const photos = ids.length
    ? await db.select({ id: aiChatPhotos.id, width: aiChatPhotos.width, height: aiChatPhotos.height, messageId: aiChatPhotos.messageId }).from(aiChatPhotos).where(inArray(aiChatPhotos.messageId, ids)).orderBy(asc(aiChatPhotos.createdAt))
    : [];
  return rows.map((m) => ({ ...m, attachments: m.attachments ?? [], proposals: m.proposals ?? [], photos: photos.filter((p) => p.messageId === m.id).map(({ id, width, height }) => ({ id, width, height })) }));
}
const messagesOf = async (chatId: string): Promise<ChatMessage[]> =>
  shown(await db.select(MESSAGE_COLUMNS).from(aiChatMessages).where(eq(aiChatMessages.chatId, chatId)).orderBy(asc(aiChatMessages.position)));

// The photos named are the caller's, in this workspace, and not yet sent.
async function photosFree(userId: string, workspaceId: string, photoIds: string[]): Promise<boolean> {
  if (!photoIds.length) return true;
  const unique = new Set(photoIds);
  const rows = await db
    .select({ id: aiChatPhotos.id })
    .from(aiChatPhotos)
    .where(and(inArray(aiChatPhotos.id, [...unique]), eq(aiChatPhotos.userId, userId), eq(aiChatPhotos.workspaceId, workspaceId), isNull(aiChatPhotos.messageId)));
  return rows.length === unique.size;
}

// What the job carries: the chat's latest photos, oldest first. A file that's
// gone is skipped; the reply goes without it.
async function photosToSend(chatId: string, workspaceId: string): Promise<ChatJobPhoto[]> {
  const rows = await db
    .select({ id: aiChatPhotos.id, messageId: aiChatPhotos.messageId })
    .from(aiChatPhotos)
    .innerJoin(aiChatMessages, eq(aiChatPhotos.messageId, aiChatMessages.id))
    .where(eq(aiChatMessages.chatId, chatId))
    .orderBy(desc(aiChatMessages.position), desc(aiChatPhotos.createdAt))
    .limit(PHOTOS_SENT);
  const read = await Promise.all(rows.reverse().map(async (r) => ({ messageId: r.messageId!, base64: await readFile(chatPhotoPath(workspaceId, r.id), "base64").catch(() => null) })));
  return read.flatMap((p) => (p.base64 === null ? [] : [{ messageId: p.messageId, base64: p.base64 }]));
}

// The items named, with their labels, or null if any isn't in this workspace.
async function labelled(workspaceId: string, refs: AttachmentRef[]): Promise<ChatAttachment[] | null> {
  const ids = (kind: AttachmentRef["kind"]) => refs.filter((r) => r.kind === kind).map((r) => r.id);
  const some = async <T>(list: string[], load: () => Promise<T[]>): Promise<T[]> => (list.length ? load() : []);
  const [brewRows, beanRows, recipeRows] = await Promise.all([
    some(ids("brew"), () =>
      db
        .select({ id: brewLogs.id, timestamp: brewLogs.timestamp, beanName: beans.beanName })
        .from(brewLogs)
        .innerJoin(beans, eq(brewLogs.beanId, beans.id))
        .where(and(eq(brewLogs.workspaceId, workspaceId), inArray(brewLogs.id, ids("brew")))),
    ),
    some(ids("bean"), () =>
      db
        .select({ id: beans.id, roasterName: beans.roasterName, beanName: beans.beanName })
        .from(beans)
        .where(and(eq(beans.workspaceId, workspaceId), inArray(beans.id, ids("bean")))),
    ),
    some(ids("recipe"), () =>
      db
        .select({ id: recipes.id, name: recipes.name })
        .from(recipes)
        .where(and(eq(recipes.workspaceId, workspaceId), inArray(recipes.id, ids("recipe")))),
    ),
  ]);
  const labels = new Map<string, string>([
    ...brewRows.map((b): [string, string] => [`brew:${b.id}`, `${b.beanName}, ${b.timestamp.toISOString().slice(0, 10)}`]),
    ...beanRows.map((b): [string, string] => [`bean:${b.id}`, `${b.roasterName} ${b.beanName}`]),
    ...recipeRows.map((r): [string, string] => [`recipe:${r.id}`, r.name]),
  ]);
  const unique = [...new Map(refs.map((r) => [`${r.kind}:${r.id}`, r])).values()];
  const periodLabels = new Map(
    await Promise.all(unique.flatMap((r) => (r.kind === "period" ? [labelPeriod(workspaceId, r.period).then((label): [string, string | null] => [r.id, label])] : []))),
  );
  const found = unique.flatMap((r): ChatAttachment[] => {
    if (r.kind === "chart") return [{ kind: r.kind, id: r.id, label: r.chart.title, chart: r.chart }];
    if (r.kind === "period") {
      const label = periodLabels.get(r.id);
      return label ? [{ kind: r.kind, id: r.id, label, period: r.period }] : [];
    }
    const label = labels.get(`${r.kind}:${r.id}`);
    return label ? [{ ...r, label: label.slice(0, 200) }] : [];
  });
  return found.length === unique.length ? found : null;
}

// Saves the message and its pending reply, then queues the reply. The row
// lock keeps two sends to one chat from taking the same position.
async function addTurn(chatId: string, content: string, attachments: ChatAttachment[], photoIds: string[]): Promise<{ ids: [string, string] } | "busy"> {
  const ids: [string, string] = [randomUUID(), randomUUID()];
  const added = await db.transaction(async (tx) => {
    const [chat] = await tx.select({ summaryStatus: aiChats.summaryStatus }).from(aiChats).where(eq(aiChats.id, chatId)).for("update");
    if (chat?.summaryStatus === "pending") return false;
    const [last] = await tx
      .select({ position: aiChatMessages.position, status: aiChatMessages.status })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.chatId, chatId))
      .orderBy(desc(aiChatMessages.position))
      .limit(1);
    if (last?.status === "pending") return false;
    const position = last?.position ?? 0;
    await tx.insert(aiChatMessages).values([
      { id: ids[0], chatId, position: position + 1, role: "user", content, attachments: attachments.length ? attachments : null, status: "done" },
      { id: ids[1], chatId, position: position + 2, role: "assistant", content: "", status: "pending" },
    ]);
    if (photoIds.length) await tx.update(aiChatPhotos).set({ messageId: ids[0] }).where(inArray(aiChatPhotos.id, photoIds));
    await tx.update(aiChats).set({ updatedAt: sql`NOW()` }).where(eq(aiChats.id, chatId));
    return true;
  });
  return added ? { ids } : "busy";
}

function sendUnavailable(res: Response, err: unknown): void {
  if (!(err instanceof QueueUnavailableError)) throw err;
  console.error("Could not queue a chat reply:", err.message);
  sendError(res, 503, "Chat is temporarily unavailable. Try again shortly.");
}

async function theTwo(chat: AiChat, ids: [string, string]): Promise<ChatPair> {
  const [fresh] = await db.select().from(aiChats).where(eq(aiChats.id, chat.id));
  return { chat: fresh ?? chat, messages: (await messagesOf(chat.id)).filter((m) => ids.includes(m.id)) };
}

export const chatsRouter = Router({ mergeParams: true });
chatsRouter.use(requireAuth);

// Summarize and continue (docs/api/chat.md §12, "Long chats"): the worker
// folds all but the newest 10 finished messages into the chat's summary.
const SUMMARY_MIN_MESSAGES = 12;
chatsRouter.post("/:chatId/summary", async (req: Request<ChatParams>, res: Response<{ chat: AiChat }>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  if (!(await requireChatOn(res, userId, workspaceId))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  if (!(await requireAi(res, workspaceId))) return;
  if (!(await requireUnderDailyLimit(res, userId, await getChatLimits()))) return;
  await settleStale(chatId);
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx.select({ summaryStatus: aiChats.summaryStatus }).from(aiChats).where(eq(aiChats.id, chatId)).for("update");
    const messages = await tx.select({ position: aiChatMessages.position, status: aiChatMessages.status }).from(aiChatMessages).where(eq(aiChatMessages.chatId, chatId)).orderBy(asc(aiChatMessages.position));
    if (row?.summaryStatus === "pending" || messages.some((m) => m.status === "pending")) return "busy" as const;
    if (messages.filter((m) => m.status === "done").length < SUMMARY_MIN_MESSAGES) return "short" as const;
    await tx.update(aiChats).set({ summaryStatus: "pending", summaryRequestedAt: sql`NOW()` }).where(eq(aiChats.id, chatId));
    return messages.at(-1)!.position;
  });
  if (claimed === "busy") {
    sendError(res, 409, "A reply or a summary is still being written");
    return;
  }
  if (claimed === "short") {
    sendError(res, 400, `A chat needs at least ${SUMMARY_MIN_MESSAGES} messages to summarize`);
    return;
  }
  try {
    await enqueueChatSummary(chatId, claimed);
  } catch (err) {
    await db.update(aiChats).set({ summaryStatus: chat.summaryStatus === "failed" ? "failed" : null }).where(eq(aiChats.id, chatId));
    sendUnavailable(res, err);
    return;
  }
  const [fresh] = await db.select().from(aiChats).where(eq(aiChats.id, chatId));
  res.status(202).json({ chat: fresh ?? chat });
});

// Fixing or dropping it (docs/api/chat.md §12, "Long chats"): an edited
// summary is what later replies and the next summary build on; a cleared one
// puts the older messages back in the window.
const SUMMARY_MAX = 6000;
const summaryEditSchema = z.object({ summary: z.string().trim().min(1).max(SUMMARY_MAX) }).strict();
async function changeSummary(req: Request<ChatParams>, res: Response<{ chat: AiChat }>, set: (chat: AiChat) => Partial<typeof aiChats.$inferInsert> | null): Promise<void> {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  await settleStale(chatId);
  const [now] = await db.select().from(aiChats).where(eq(aiChats.id, chatId));
  if (!now) return;
  if (now.summaryStatus === "pending") {
    sendError(res, 409, "A summary is still being written");
    return;
  }
  const values = set(now);
  if (!values) return;
  await db.update(aiChats).set(values).where(eq(aiChats.id, chatId));
  const [fresh] = await db.select().from(aiChats).where(eq(aiChats.id, chatId));
  res.json({ chat: fresh ?? now });
}
chatsRouter.put("/:chatId/summary", (req: Request<ChatParams>, res: Response<{ chat: AiChat }>) =>
  changeSummary(req, res, (chat) => {
    if (!chat.summary) {
      sendError(res, 404, "This chat has no summary to edit");
      return null;
    }
    const body = parseBody(summaryEditSchema, req, res);
    return body ? { summary: body.summary, summaryStatus: null } : null;
  }),
);
chatsRouter.delete("/:chatId/summary", (req: Request<ChatParams>, res: Response<{ chat: AiChat }>) =>
  changeSummary(req, res, () => ({ summary: null, summaryThrough: null, summaryStatus: null })),
);

chatsRouter.get("/", async (req: Request<Params>, res: Response<{ chats: AiChat[]; canSend: boolean }>) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const chats = await db
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.workspaceId, workspaceId), eq(aiChats.userId, userId)))
    // Pinned first, the latest pinned on top; then the latest used.
    .orderBy(sql`${aiChats.pinnedAt} IS NULL`, desc(aiChats.pinnedAt), desc(aiChats.updatedAt), desc(aiChats.createdAt));
  res.json({ chats, canSend: await chatOn(userId, workspaceId) });
});

// Pinning (docs/api/chat.md §12): any member, on their own chat; it only
// orders their list and keeps the chat from the limits (chatData.ts).
// unpin: one of your pinned chats, in any workspace, to unpin in its place
// when you're at the pin limit (docs/api/chat.md §12, "Pinned chats").
const pinSchema = z.object({ pinned: z.boolean(), unpin: z.uuid().optional() }).strict();
interface PinLimitBody {
  error: string;
  code: "pin_limit";
  maxPinned: number;
  pinnedCount: number;
  pinned: Array<{ id: string; title: string; workspaceId: string; workspaceName: string; pinnedAt: string }>;
}
chatsRouter.put("/:chatId/pin", async (req: Request<ChatParams>, res: Response<{ chat: AiChat } | PinLimitBody>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  const body = parseBody(pinSchema, req, res);
  if (!body) return;
  if (body.pinned && chat.pinnedAt === null) {
    const pinned = await pinnedChatsOf(userId);
    if (body.unpin !== undefined) {
      // A swap: the count doesn't rise, so it's allowed even over the limit.
      if (!pinned.some((p) => p.id === body.unpin)) {
        sendError(res, 404, "That chat isn't one of your pinned chats");
        return;
      }
      await db.transaction(async (tx) => {
        await tx.update(aiChats).set({ pinnedAt: null }).where(and(eq(aiChats.id, body.unpin!), eq(aiChats.userId, userId)));
        await tx.update(aiChats).set({ pinnedAt: sql`NOW()` }).where(eq(aiChats.id, chatId));
      });
    } else {
      const { maxPinned } = await getChatLimits();
      if (maxPinned !== null && pinned.length >= maxPinned) {
        res.status(409).json({
          error: `You can pin up to ${maxPinned} chats`,
          code: "pin_limit",
          maxPinned,
          pinnedCount: pinned.length,
          pinned: pinned.map((p) => ({ ...p, pinnedAt: p.pinnedAt.toISOString() })),
        });
        return;
      }
      await db.update(aiChats).set({ pinnedAt: sql`NOW()` }).where(eq(aiChats.id, chatId));
    }
  } else if (!body.pinned && chat.pinnedAt !== null) {
    await db.update(aiChats).set({ pinnedAt: null }).where(eq(aiChats.id, chatId));
  }
  const [fresh] = await db.select().from(aiChats).where(eq(aiChats.id, chatId));
  res.json({ chat: fresh ?? chat });
});

chatsRouter.post("/", async (req: Request<Params>, res: Response<ChatPair>) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  if (!(await requireChatOn(res, userId, workspaceId))) return;
  const body = parseBody(sendSchema, req, res);
  if (!body) return;
  if (!(await underAttachmentLimit(res, workspaceId, body.attachments))) return;
  const attachments = await labelled(workspaceId, body.attachments ?? []);
  if (!attachments) {
    sendError(res, 400, "An attachment isn't in this workspace");
    return;
  }
  const photoIds = body.photoIds ?? [];
  if (!(await photosFree(userId, workspaceId, photoIds))) {
    sendError(res, 400, "A photo can't be sent with this message");
    return;
  }
  if (!(await requireAi(res, workspaceId))) return;
  if (!(await requireUnderDailyLimit(res, userId, await getChatLimits()))) return;

  const id = randomUUID();
  await db.insert(aiChats).values({ id, workspaceId, userId, title: titleOf(body.content) });
  const [chat] = await db.select().from(aiChats).where(eq(aiChats.id, id));
  const turn = await addTurn(id, body.content, attachments, photoIds);
  if (turn === "busy") throw new Error("A new chat can't have a reply pending");
  try {
    await enqueueChatReply(turn.ids[1], await photosToSend(id, workspaceId));
  } catch (err) {
    await db.update(aiChatPhotos).set({ messageId: null }).where(eq(aiChatPhotos.messageId, turn.ids[0]));
    await db.delete(aiChats).where(eq(aiChats.id, id));
    sendUnavailable(res, err);
    return;
  }
  await pruneChatsOf(userId, id);
  res.status(202).json(await theTwo(chat!, turn.ids));
});

chatsRouter.get("/export", async (req: Request<Params>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const zip = await buildChatsZip(workspaceId, userId);
  res.setHeader("Content-Disposition", `attachment; filename="chats-${new Date().toISOString().slice(0, 10)}.zip"`);
  res.type("application/zip").send(Buffer.from(zip));
});

// One chat, in the same zip, so Import brings it back.
chatsRouter.get("/:chatId/export", async (req: Request<ChatParams>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  if (!(await ownChat(res, userId, workspaceId, chatId))) return;
  const zip = await buildChatsZip(workspaceId, userId, chatId);
  res.setHeader("Content-Disposition", `attachment; filename="chat-${new Date().toISOString().slice(0, 10)}.zip"`);
  res.type("application/zip").send(Buffer.from(zip));
});

const zipBody = express.raw({ type: ["application/zip", "application/x-zip-compressed"], limit: "250mb" });
chatsRouter.post("/import", zipBody, async (req: Request<Params>, res: Response<{ imported: number; skipped: number; unpinned: number }>) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  if (!(await requireChatOn(res, userId, workspaceId))) return;
  if (!Buffer.isBuffer(req.body)) {
    sendError(res, 400, "Send the .zip as the body");
    return;
  }
  const result = await importChats(req.body, workspaceId, userId);
  if (!result.ok) {
    sendError(res, result.status, result.error);
    return;
  }
  res.json({ imported: result.imported, skipped: result.skipped, unpinned: result.unpinned });
});

// The image itself, whatever its type: sharp decides whether it is one.
chatsRouter.post("/photos", express.raw({ type: () => true, limit: PHOTO_MAX_UPLOAD_BYTES }), async (req: Request<Params>, res: Response<{ photo: ChatPhoto }>) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  if (!(await requireChatOn(res, userId, workspaceId))) return;
  const photo = Buffer.isBuffer(req.body) && req.body.length > 0 ? await processPhoto(req.body) : null;
  if (!photo) {
    sendError(res, 400, "Not an image that can be read (JPEG, PNG, WebP, GIF, AVIF or TIFF)");
    return;
  }
  // The file goes first: a row never points at a missing file.
  const id = randomUUID();
  await writeChatPhotoFile(workspaceId, id, photo.data);
  await db.insert(aiChatPhotos).values({ id, workspaceId, userId, width: photo.width, height: photo.height, sizeBytes: photo.data.length });
  res.status(201).json({ photo: { id, width: photo.width, height: photo.height } });
});

chatsRouter.get("/photos/:photoId", async (req: Request<Params & { photoId: string }>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId, photoId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const [row] = await db
    .select({ id: aiChatPhotos.id })
    .from(aiChatPhotos)
    .where(and(eq(aiChatPhotos.id, photoId), eq(aiChatPhotos.workspaceId, workspaceId), eq(aiChatPhotos.userId, userId)));
  const path = row ? chatPhotoPath(workspaceId, row.id) : null;
  if (!path || !(await access(path).then(() => true, () => false))) {
    sendError(res, 404, "Photo not found");
    return;
  }
  res.set("Cache-Control", "private, max-age=86400").type("image/webp").sendFile(path);
});

chatsRouter.get("/:chatId", async (req: Request<ChatParams>, res: Response<ChatPair>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  await settleStale(chatId);
  // Read again: settling may have marked its summary failed.
  const [fresh] = await db.select().from(aiChats).where(eq(aiChats.id, chatId));
  res.json({ chat: fresh ?? chat, messages: await messagesOf(chatId) });
});

chatsRouter.delete("/:chatId", async (req: Request<ChatParams>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  if (!(await ownChat(res, userId, workspaceId, chatId))) return;
  await deleteChats([chatId]);
  res.status(204).end();
});

chatsRouter.post("/:chatId/messages", async (req: Request<ChatParams>, res: Response<ChatPair>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  if (!(await requireChatOn(res, userId, workspaceId))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  const body = parseBody(sendSchema, req, res);
  if (!body) return;
  if (!(await underAttachmentLimit(res, workspaceId, body.attachments))) return;
  const attachments = await labelled(workspaceId, body.attachments ?? []);
  if (!attachments) {
    sendError(res, 400, "An attachment isn't in this workspace");
    return;
  }
  const photoIds = body.photoIds ?? [];
  if (!(await photosFree(userId, workspaceId, photoIds))) {
    sendError(res, 400, "A photo can't be sent with this message");
    return;
  }
  if (!(await requireAi(res, workspaceId))) return;
  if (!(await requireUnderDailyLimit(res, userId, await getChatLimits()))) return;

  await settleStale(chatId);
  const turn = await addTurn(chatId, body.content, attachments, photoIds);
  if (turn === "busy") {
    sendError(res, 409, "The last reply or a summary is still being written");
    return;
  }
  try {
    await enqueueChatReply(turn.ids[1], await photosToSend(chatId, workspaceId));
  } catch (err) {
    await db.update(aiChatPhotos).set({ messageId: null }).where(eq(aiChatPhotos.messageId, turn.ids[0]));
    await db.delete(aiChatMessages).where(sql`${aiChatMessages.id} IN (${turn.ids[0]}, ${turn.ids[1]})`);
    sendUnavailable(res, err);
    return;
  }
  await pruneChatsOf(userId, chatId);
  res.status(202).json(await theTwo(chat, turn.ids));
});

const finished = async (chatId: string, messageId: string): Promise<ChatMessage | null> => {
  const [row] = await db
    .select(MESSAGE_COLUMNS)
    .from(aiChatMessages)
    .where(and(eq(aiChatMessages.id, messageId), eq(aiChatMessages.chatId, chatId)));
  return row ? (await shown([row]))[0]! : null;
};

// The reply as server-sent events: see "The reply stream" in chat.md §12.
// Each stream blocks on Redis, so each has a connection of its own.
// Dismissing a proposal card, or bringing it back (docs/api/chat.md §12,
// "Proposals"). Changes nothing else, so any member can on their own chat.
const proposalStateSchema = z.object({ state: z.enum(CHAT_PROPOSAL_STATES) }).strict();
chatsRouter.put("/:chatId/messages/:messageId/proposals/:index", async (req: Request<StreamParams & { index: string }>, res: Response<{ proposals: ChatProposal[] }>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId, messageId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  if (!(await ownChat(res, userId, workspaceId, chatId))) return;
  const body = parseBody(proposalStateSchema, req, res);
  if (!body) return;
  const [row] = await db.select({ proposals: aiChatMessages.proposals }).from(aiChatMessages).where(and(eq(aiChatMessages.id, messageId), eq(aiChatMessages.chatId, chatId)));
  const index = /^\d+$/.test(req.params.index) ? Number(req.params.index) : -1;
  const proposals = row?.proposals ?? [];
  if (index < 0 || index >= proposals.length) {
    sendError(res, 404, "Proposal not found");
    return;
  }
  const next = proposals.map((p, i) => (i === index ? { ...p, state: body.state } : p));
  await db.update(aiChatMessages).set({ proposals: next }).where(eq(aiChatMessages.id, messageId));
  res.json({ proposals: next });
});

chatsRouter.get("/:chatId/messages/:messageId/stream", async (req: Request<StreamParams>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId, messageId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  if (!(await ownChat(res, userId, workspaceId, chatId))) return;
  await settleStale(chatId);
  const message = await finished(chatId, messageId);
  if (!message || message.role !== "assistant") {
    sendError(res, 404, "Message not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform: compressing proxies would otherwise hold the pieces back.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const sendDone = (done: ChatMessage): void => {
    res.write(`event: done\ndata: ${JSON.stringify(done)}\n\n`);
    res.end();
  };
  if (message.status !== "pending") {
    sendDone(message);
    return;
  }

  const redis = new Redis(config.redis.url, { maxRetriesPerRequest: null, ...(config.redis.password ? { password: config.redis.password } : {}) });
  redis.on("error", (err: Error) => console.error("Chat stream Redis error:", err.message));
  let open = true;
  req.on("close", () => {
    open = false;
    redis.disconnect();
  });

  const key = chatReplyKey(messageId);
  let lastId = req.header("last-event-id") ?? "0";
  try {
    while (open) {
      const read = await redis.xread("BLOCK", STREAM_BLOCK_MS, "STREAMS", key, lastId);
      if (!open) return;
      if (!read) {
        // Quiet: keep the connection alive, and don't outlive a dead worker.
        res.write(": still writing\n\n");
        await settleStale(chatId);
        const now = await finished(chatId, messageId);
        if (now?.status !== "pending") {
          if (now) sendDone(now);
          else res.end();
          break;
        }
        continue;
      }
      for (const [id, fields] of read[0]![1]) {
        lastId = id;
        const event = JSON.parse(fields[fields.indexOf(CHAT_EVENT_FIELD) + 1]!) as ChatStreamEvent;
        if (event.type === "text") {
          res.write(`id: ${id}\nevent: text\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
          continue;
        }
        const now = await finished(chatId, messageId);
        if (now) sendDone(now);
        else res.end();
        return;
      }
    }
  } catch (err) {
    if (open) {
      console.error("Chat stream failed:", err instanceof Error ? err.message : err);
      res.end(); // the browser reconnects, and carries on from its last event
    }
  } finally {
    redis.disconnect();
  }
});

// Your limits and purging (docs/api/chat.md §12). Mounted at /api/auth/me.
export const myChatsRouter = Router();
myChatsRouter.use("/chat-settings", requireAuth);
myChatsRouter.use("/chats", requireAuth);

interface ChatSettings {
  own: Required<OwnChatLimits>;
  server: ServerChatLimits;
  effective: ChatLimits;
  usedBytes: number;
  pinnedCount: number; // in every workspace, against server.maxPinned
}
async function settingsOf(userId: string): Promise<ChatSettings> {
  const [row] = await db.select({ chatLimits: users.chatLimits }).from(users).where(eq(users.id, userId));
  const own = { ...NO_CHAT_LIMITS, periodMaxBrews: null, ...row?.chatLimits };
  const server = await getChatLimits();
  return { own, server, effective: effectiveChatLimits(server, own), usedBytes: await userChatBytes(userId), pinnedCount: (await pinnedChatsOf(userId)).length };
}

myChatsRouter.get("/chat-settings", async (req: Request, res: Response<ChatSettings>) => {
  res.json(await settingsOf(authedUserId(req)));
});

const over = (own: number | null, server: number | null): boolean => server !== null && (own === null ? false : own > server);
// What saving these limits would delete of your chats, so the page can ask
// first (docs/api/chat.md §12, "Saving limits"). Deletes nothing.
myChatsRouter.post("/chat-settings/preview", async (req: Request, res: Response<{ chats: number; pinned: number }>) => {
  const body = parseBody(ownChatLimitsSchema, req, res);
  if (!body) return;
  const server = await getChatLimits();
  if (over(body.maxBytes, server.maxBytes) || over(body.maxDays, server.maxDays)) {
    sendError(res, 400, "That's more than this server allows");
    return;
  }
  const gone = await wouldDelete(authedUserId(req), { maxBytes: body.maxBytes, maxDays: body.maxDays }, server, null);
  res.json({ chats: gone.ids.length, pinned: gone.pinned });
});

myChatsRouter.put("/chat-settings", async (req: Request, res: Response<ChatSettings>) => {
  const userId = authedUserId(req);
  const body = parseBody(ownChatLimitsSchema, req, res);
  if (!body) return;
  const server = await getChatLimits();
  if (over(body.maxBytes, server.maxBytes) || over(body.maxDays, server.maxDays)) {
    sendError(res, 400, "That's more than this server allows");
    return;
  }
  const [row] = await db.select({ chatLimits: users.chatLimits }).from(users).where(eq(users.id, userId));
  const periodMaxBrews = body.periodMaxBrews === undefined ? (row?.chatLimits?.periodMaxBrews ?? null) : body.periodMaxBrews;
  await db.update(users).set({ chatLimits: { maxBytes: body.maxBytes, maxDays: body.maxDays, periodMaxBrews } }).where(eq(users.id, userId));
  await pruneChatsOf(userId, null);
  res.json(await settingsOf(userId));
});

myChatsRouter.delete("/chats", async (req: Request, res: Response) => {
  await deleteAllChatsOf(authedUserId(req));
  res.status(204).end();
});

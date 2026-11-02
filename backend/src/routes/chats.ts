// AI chat (docs/api/chat.md §12): a person's own conversations. Every query
// is scoped to the caller, so someone else's chat is a 404.
import { randomUUID } from "node:crypto";
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatStreamEvent } from "@barista/shared/jobs";
import { aiChatMessages, aiChats, beans, brewLogs, CHAT_ATTACHMENT_KINDS, recipes, type AiChat, type AiChatMessage, type ChatAttachment } from "@barista/shared/schema";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { Redis } from "ioredis";
import { z } from "zod";
import { requireAi } from "../aiConfig.js";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { enqueueChatReply, QueueUnavailableError } from "../queue.js";

export const CHAT_MESSAGE_MAX = 4000;
const CHAT_ATTACHMENTS_MAX = 10;
const TITLE_MAX = 60;
// Longer than any reply takes: the worker died.
const STALE_MS = 10 * 60_000;
const STREAM_BLOCK_MS = 10_000;

type ChatMessage = Omit<AiChatMessage, "chatId" | "promptTokens" | "completionTokens" | "attachments"> & { attachments: ChatAttachment[] };
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
  status: aiChatMessages.status,
  error: aiChatMessages.error,
  model: aiChatMessages.model,
  createdAt: aiChatMessages.createdAt,
};

const attachmentSchema = z.object({ kind: z.enum(CHAT_ATTACHMENT_KINDS), id: z.string().uuid() }).strict();
type AttachmentRef = z.infer<typeof attachmentSchema>;
const sendSchema = z.object({ content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX), attachments: z.array(attachmentSchema).max(CHAT_ATTACHMENTS_MAX).optional() }).strict();
const titleOf = (content: string): string => {
  const line = content.split("\n")[0]!.trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
};

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
function settleStale(chatId: string): Promise<unknown> {
  return db
    .update(aiChatMessages)
    .set({ status: "failed", error: STALE_ERROR })
    .where(and(eq(aiChatMessages.chatId, chatId), eq(aiChatMessages.status, "pending"), lt(aiChatMessages.createdAt, new Date(Date.now() - STALE_MS))));
}

const shown = <T extends { attachments: ChatAttachment[] | null }>(m: T): T & { attachments: ChatAttachment[] } => ({ ...m, attachments: m.attachments ?? [] });
const messagesOf = async (chatId: string): Promise<ChatMessage[]> =>
  (await db.select(MESSAGE_COLUMNS).from(aiChatMessages).where(eq(aiChatMessages.chatId, chatId)).orderBy(asc(aiChatMessages.position))).map(shown);

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
  const found = unique.flatMap((r) => {
    const label = labels.get(`${r.kind}:${r.id}`);
    return label ? [{ ...r, label: label.slice(0, 200) }] : [];
  });
  return found.length === unique.length ? found : null;
}

// Saves the message and its pending reply, then queues the reply. The row
// lock keeps two sends to one chat from taking the same position.
async function addTurn(chatId: string, content: string, attachments: ChatAttachment[]): Promise<{ ids: [string, string] } | "busy"> {
  const ids: [string, string] = [randomUUID(), randomUUID()];
  const added = await db.transaction(async (tx) => {
    await tx.select({ id: aiChats.id }).from(aiChats).where(eq(aiChats.id, chatId)).for("update");
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

chatsRouter.get("/", async (req: Request<Params>, res: Response<{ chats: AiChat[] }>) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const chats = await db
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.workspaceId, workspaceId), eq(aiChats.userId, userId)))
    .orderBy(desc(aiChats.updatedAt), desc(aiChats.createdAt));
  res.json({ chats });
});

chatsRouter.post("/", async (req: Request<Params>, res: Response<ChatPair>) => {
  const userId = authedUserId(req);
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const body = parseBody(sendSchema, req, res);
  if (!body) return;
  const attachments = await labelled(workspaceId, body.attachments ?? []);
  if (!attachments) {
    sendError(res, 400, "An attachment isn't in this workspace");
    return;
  }
  if (!(await requireAi(res, workspaceId))) return;

  const id = randomUUID();
  await db.insert(aiChats).values({ id, workspaceId, userId, title: titleOf(body.content) });
  const [chat] = await db.select().from(aiChats).where(eq(aiChats.id, id));
  const turn = await addTurn(id, body.content, attachments);
  if (turn === "busy") throw new Error("A new chat can't have a reply pending");
  try {
    await enqueueChatReply(turn.ids[1]);
  } catch (err) {
    await db.delete(aiChats).where(eq(aiChats.id, id));
    sendUnavailable(res, err);
    return;
  }
  res.status(202).json(await theTwo(chat!, turn.ids));
});

chatsRouter.get("/:chatId", async (req: Request<ChatParams>, res: Response<ChatPair>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  await settleStale(chatId);
  res.json({ chat, messages: await messagesOf(chatId) });
});

chatsRouter.delete("/:chatId", async (req: Request<ChatParams>, res: Response) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId))) return;
  if (!(await ownChat(res, userId, workspaceId, chatId))) return;
  await db.delete(aiChats).where(eq(aiChats.id, chatId));
  res.status(204).end();
});

chatsRouter.post("/:chatId/messages", async (req: Request<ChatParams>, res: Response<ChatPair>) => {
  const userId = authedUserId(req);
  const { workspaceId, chatId } = req.params;
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const chat = await ownChat(res, userId, workspaceId, chatId);
  if (!chat) return;
  const body = parseBody(sendSchema, req, res);
  if (!body) return;
  const attachments = await labelled(workspaceId, body.attachments ?? []);
  if (!attachments) {
    sendError(res, 400, "An attachment isn't in this workspace");
    return;
  }
  if (!(await requireAi(res, workspaceId))) return;

  await settleStale(chatId);
  const turn = await addTurn(chatId, body.content, attachments);
  if (turn === "busy") {
    sendError(res, 409, "The last reply is still being written");
    return;
  }
  try {
    await enqueueChatReply(turn.ids[1]);
  } catch (err) {
    await db.delete(aiChatMessages).where(sql`${aiChatMessages.id} IN (${turn.ids[0]}, ${turn.ids[1]})`);
    sendUnavailable(res, err);
    return;
  }
  res.status(202).json(await theTwo(chat, turn.ids));
});

const finished = async (chatId: string, messageId: string): Promise<ChatMessage | null> => {
  const [row] = await db
    .select(MESSAGE_COLUMNS)
    .from(aiChatMessages)
    .where(and(eq(aiChatMessages.id, messageId), eq(aiChatMessages.chatId, chatId)));
  return row ? shown(row) : null;
};

// The reply as server-sent events: see "The reply stream" in chat.md §12.
// Each stream blocks on Redis, so each has a connection of its own.
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

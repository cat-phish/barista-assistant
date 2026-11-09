// A person's chats as one .zip (docs/api/chat.md §12): chats.json and
// photos/<id>.webp. Their own data, unlike a workspace backup (§2b).
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { effectiveChatLimits } from "@barista/shared/aiConfig";
import { aiChatMessages, aiChatPhotos, aiChats, CHAT_ATTACHMENT_KINDS, users } from "@barista/shared/schema";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { chartSnapshotSchema } from "./chatChart.js";
import { periodSpecSchema } from "./chatPeriod.js";
import { pruneChatsOf, userChatBytes } from "./chatData.js";
import { proposalsSchema } from "./chatProposal.js";
import { db } from "./db.js";
import { chatPhotoPath, checkStoredPhoto, removeChatPhotoFiles, writeChatPhotoFile } from "./photos.js";
import { getChatLimits } from "./serverSettings.js";

const CHATS_JSON = "chats.json";
const PHOTO_ENTRY = /^photos\/([0-9a-f-]{36})\.webp$/;
const MAX_JSON_BYTES = 200 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const date = z.iso.datetime();
const fileSchema = z.object({
  version: z.literal(1),
  exportedAt: date,
  chats: z.array(
    z.object({
      id: z.uuid(),
      title: z.string().min(1).max(120),
      createdAt: date,
      updatedAt: date,
      // Summarize and continue; older files have neither.
      summary: z.string().max(100_000).nullable().optional(),
      summaryThrough: z.number().int().nullable().optional(),
      pinnedAt: date.nullable().optional(), // since pinning
      messages: z.array(
        z.object({
          position: z.number().int(),
          role: z.enum(["user", "assistant"]),
          content: z.string().max(16_000_000),
          attachments: z.array(z.object({ kind: z.enum(CHAT_ATTACHMENT_KINDS), id: z.string().max(36), label: z.string().max(200), chart: chartSnapshotSchema.optional(), period: periodSpecSchema.optional() })).nullable(),
          proposals: proposalsSchema.nullable().optional(), // since proposals; older files have none
          status: z.enum(["done", "failed"]),
          error: z.string().max(200).nullable(),
          model: z.string().max(100).nullable(),
          createdAt: date,
          photos: z.array(z.object({ id: z.uuid() })),
        }),
      ),
    }),
  ),
});
type ChatsFile = z.infer<typeof fileSchema>;

// chatId: only that chat (the chat page's Export), else all of them.
export async function buildChatsZip(workspaceId: string, userId: string, chatId?: string): Promise<Uint8Array> {
  const chats = await db
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.workspaceId, workspaceId), eq(aiChats.userId, userId), chatId ? eq(aiChats.id, chatId) : undefined))
    .orderBy(asc(aiChats.createdAt));
  const ids = chats.map((c) => c.id);
  const messages = ids.length
    ? await db
        .select()
        .from(aiChatMessages)
        .where(and(inArray(aiChatMessages.chatId, ids), ne(aiChatMessages.status, "pending")))
        .orderBy(asc(aiChatMessages.position))
    : [];
  const messageIds = messages.map((m) => m.id);
  const photos = messageIds.length ? await db.select().from(aiChatPhotos).where(inArray(aiChatPhotos.messageId, messageIds)) : [];

  const entries: Zippable = {};
  const present = new Set<string>();
  for (const photo of photos) {
    const data = await readFile(chatPhotoPath(workspaceId, photo.id)).catch(() => null);
    if (!data) continue;
    present.add(photo.id);
    entries[`photos/${photo.id}.webp`] = [data, { level: 0 }]; // WebP is compressed already
  }
  const file = {
    version: 1,
    exportedAt: new Date().toISOString(),
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      ...(c.summary ? { summary: c.summary, summaryThrough: c.summaryThrough } : {}),
      ...(c.pinnedAt ? { pinnedAt: c.pinnedAt.toISOString() } : {}),
      messages: messages
        .filter((m) => m.chatId === c.id)
        .map((m) => ({
          position: m.position,
          role: m.role,
          content: m.content,
          attachments: m.attachments,
          proposals: m.proposals,
          status: m.status,
          error: m.error,
          model: m.model,
          createdAt: m.createdAt.toISOString(),
          photos: photos.filter((p) => p.messageId === m.id && present.has(p.id)).map((p) => ({ id: p.id, width: p.width, height: p.height })),
        })),
    })),
  };
  entries[CHATS_JSON] = new TextEncoder().encode(JSON.stringify(file));
  return zipSync(entries);
}

type ReadChats = { ok: true; file: ChatsFile; photos: Map<string, Buffer> } | { ok: false; error: string };

// Only chats.json and photos/<id>.webp are read; anything else, or larger
// than they can be, is skipped before it's unpacked.
function readChatsZip(data: Buffer): ReadChats {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => (f.name === CHATS_JSON && f.originalSize <= MAX_JSON_BYTES) || (PHOTO_ENTRY.test(f.name) && f.originalSize <= MAX_PHOTO_BYTES) });
  } catch {
    return { ok: false, error: "Not a zip file that can be read" };
  }
  const json = files[CHATS_JSON];
  if (!json) return { ok: false, error: `The zip has no ${CHATS_JSON}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return { ok: false, error: `${CHATS_JSON} isn't valid JSON` };
  }
  const file = fileSchema.safeParse(parsed);
  if (!file.success) return { ok: false, error: `${CHATS_JSON} isn't a chat export` };
  const photos = new Map<string, Buffer>();
  for (const [name, bytes] of Object.entries(files)) {
    const id = PHOTO_ENTRY.exec(name)?.[1];
    if (id) photos.set(id, Buffer.from(bytes));
  }
  return { ok: true, file: file.data, photos };
}

export type ImportResult = { ok: true; imported: number; skipped: number } | { ok: false; status: 400 | 409; error: string };

const encoder = new TextEncoder();
const jsonBytes = (value: unknown): number => (value ? encoder.encode(JSON.stringify(value)).length : 0);
const textBytes = (m: ChatsFile["chats"][number]["messages"][number]): number => encoder.encode(m.content).length + jsonBytes(m.attachments) + jsonBytes(m.proposals);

export async function importChats(data: Buffer, workspaceId: string, userId: string): Promise<ImportResult> {
  const read = readChatsZip(data);
  if (!read.ok) return { ok: false, status: 400, error: read.error };

  const taken = read.file.chats.length ? await db.select({ id: aiChats.id, userId: aiChats.userId, workspaceId: aiChats.workspaceId }).from(aiChats).where(inArray(aiChats.id, read.file.chats.map((c) => c.id))) : [];
  const fresh = read.file.chats.filter((c) => !taken.some((t) => t.id === c.id && t.userId === userId && t.workspaceId === workspaceId));

  // Photos that can be read, new ids, and what it all takes.
  const photos = new Map<string, { id: string; data: Buffer; width: number; height: number }>();
  for (const message of fresh.flatMap((c) => c.messages)) {
    for (const { id } of message.photos) {
      const bytes = read.photos.get(id);
      const size = bytes ? await checkStoredPhoto(bytes) : null;
      if (bytes && size) photos.set(id, { id: randomUUID(), data: bytes, ...size });
    }
  }
  const adding = fresh.flatMap((c) => c.messages).reduce((n, m) => n + textBytes(m), 0) + fresh.reduce((n, c) => n + (c.summary ? encoder.encode(c.summary).length : 0), 0) + [...photos.values()].reduce((n, p) => n + p.data.length, 0);
  const [row] = await db.select({ chatLimits: users.chatLimits }).from(users).where(eq(users.id, userId));
  const { maxBytes } = effectiveChatLimits(await getChatLimits(), row?.chatLimits ?? null);
  if (maxBytes !== null && (await userChatBytes(userId)) + adding > maxBytes) {
    return { ok: false, status: 409, error: "These chats would take you past your size limit" };
  }

  // The files go first: a row never points at a missing file.
  const written = [...photos.values()];
  await Promise.all(written.map((p) => writeChatPhotoFile(workspaceId, p.id, p.data)));
  try {
    await db.transaction(async (tx) => {
      for (const chat of fresh) {
        const chatId = taken.some((t) => t.id === chat.id) ? randomUUID() : chat.id;
        const ordered = [...chat.messages].sort((a, b) => a.position - b.position);
        // Positions are numbered afresh, so the summary's end is too.
        const summary = chat.summary && chat.summaryThrough != null ? { summary: chat.summary, summaryThrough: ordered.filter((m) => m.position <= chat.summaryThrough!).length } : {};
        await tx.insert(aiChats).values({ id: chatId, workspaceId, userId, title: chat.title, ...summary, pinnedAt: chat.pinnedAt ? new Date(chat.pinnedAt) : null, createdAt: new Date(chat.createdAt), updatedAt: new Date(chat.updatedAt) });
        for (const [i, message] of ordered.entries()) {
          const id = randomUUID();
          const { photos: _photos, createdAt, proposals, ...fields } = message;
          await tx.insert(aiChatMessages).values({ ...fields, proposals: proposals?.length ? proposals : null, id, chatId, position: i + 1, createdAt: new Date(createdAt) });
          for (const photo of message.photos) {
            const stored = photos.get(photo.id);
            if (stored) await tx.insert(aiChatPhotos).values({ id: stored.id, workspaceId, userId, messageId: id, width: stored.width, height: stored.height, sizeBytes: stored.data.length });
          }
        }
      }
    });
  } catch (err) {
    await removeChatPhotoFiles(workspaceId, written.map((p) => p.id));
    throw err;
  }
  await pruneChatsOf(userId, null);
  return { ok: true, imported: fresh.length, skipped: read.file.chats.length - fresh.length };
}

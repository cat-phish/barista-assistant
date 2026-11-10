// What AI chats keep, and removing it (docs/api/chat.md §12). A chat's rows
// cascade, but its photo files don't, so every delete goes through here.
import { CHAT_PERIOD_BREWS_MAX, CHAT_PERIOD_BREWS_MIN } from "@barista/shared/chatPeriod";
import { effectiveChatLimits, type ChatLimits } from "@barista/shared/aiConfig";
import { aiChatMessages, aiChatPhotos, aiChats, users, workspaces } from "@barista/shared/schema";
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.js";
import { removeChatPhotoFiles } from "./photos.js";
import { getChatLimits } from "./serverSettings.js";

export const chatLimitsSchema = z
  .object({
    maxBytes: z.number().int().min(1024).max(1024 ** 5).nullable(),
    maxDays: z.number().int().min(1).max(36500).nullable(),
  })
  .strict();

// A person's own (docs/api/chat.md §12): the size and age limits, and how
// many brews a live Period sends in detail at most (absent: unchanged).
export const ownChatLimitsSchema = chatLimitsSchema.extend({
  periodMaxBrews: z.number().int().min(CHAT_PERIOD_BREWS_MIN).max(CHAT_PERIOD_BREWS_MAX).nullable().optional(),
});

interface ChatSize {
  id: string;
  userId: string;
  updatedAt: Date;
  bytes: number;
  pinned?: boolean;
}

// Each chat with what it takes: its messages, their attachment references,
// proposals and photos, and its summary.
async function chatSizes(where?: SQL): Promise<ChatSize[]> {
  const chats = await db.select({ id: aiChats.id, userId: aiChats.userId, updatedAt: aiChats.updatedAt, pinnedAt: aiChats.pinnedAt, summaryBytes: sql<string | null>`OCTET_LENGTH(${aiChats.summary})` }).from(aiChats).where(where);
  if (!chats.length) return [];
  const ids = chats.map((c) => c.id);
  const [text, photos] = await Promise.all([
    db
      .select({ chatId: aiChatMessages.chatId, bytes: sql<string>`SUM(OCTET_LENGTH(${aiChatMessages.content}) + COALESCE(OCTET_LENGTH(${aiChatMessages.attachments}), 0) + COALESCE(OCTET_LENGTH(${aiChatMessages.proposals}), 0))` })
      .from(aiChatMessages)
      .where(inArray(aiChatMessages.chatId, ids))
      .groupBy(aiChatMessages.chatId),
    db
      .select({ chatId: aiChatMessages.chatId, bytes: sql<string>`SUM(${aiChatPhotos.sizeBytes})` })
      .from(aiChatPhotos)
      .innerJoin(aiChatMessages, eq(aiChatPhotos.messageId, aiChatMessages.id))
      .where(inArray(aiChatMessages.chatId, ids))
      .groupBy(aiChatMessages.chatId),
  ]);
  const sizes = new Map<string, number>();
  for (const row of [...text, ...photos]) sizes.set(row.chatId, (sizes.get(row.chatId) ?? 0) + Number(row.bytes));
  return chats.map(({ summaryBytes, pinnedAt, ...c }) => ({ ...c, pinned: pinnedAt !== null, bytes: (sizes.get(c.id) ?? 0) + Number(summaryBytes ?? 0) }));
}

const sumBytes = (chats: ChatSize[]): number => chats.reduce((n, c) => n + c.bytes, 0);
// A person's pinned chats in every workspace, longest pinned first, for the
// pin limit (docs/api/chat.md §12, "Pinned chats").
export interface PinnedChat {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  pinnedAt: Date;
}
export async function pinnedChatsOf(userId: string): Promise<PinnedChat[]> {
  const rows = await db
    .select({ id: aiChats.id, title: aiChats.title, workspaceId: aiChats.workspaceId, workspaceName: workspaces.name, pinnedAt: aiChats.pinnedAt })
    .from(aiChats)
    .innerJoin(workspaces, eq(aiChats.workspaceId, workspaces.id))
    .where(and(eq(aiChats.userId, userId), isNotNull(aiChats.pinnedAt)))
    .orderBy(asc(aiChats.pinnedAt), asc(aiChats.createdAt));
  return rows.flatMap((r) => (r.pinnedAt ? [{ ...r, pinnedAt: r.pinnedAt }] : []));
}

export const userChatBytes = async (userId: string): Promise<number> => sumBytes(await chatSizes(eq(aiChats.userId, userId)));
export const totalChatBytes = async (): Promise<number> => sumBytes(await chatSizes());

export async function deleteChats(chatIds: string[]): Promise<void> {
  if (!chatIds.length) return;
  const photos = await db
    .select({ id: aiChatPhotos.id, workspaceId: aiChatPhotos.workspaceId })
    .from(aiChatPhotos)
    .innerJoin(aiChatMessages, eq(aiChatPhotos.messageId, aiChatMessages.id))
    .where(inArray(aiChatMessages.chatId, chatIds));
  await db.delete(aiChats).where(inArray(aiChats.id, chatIds));
  await removePhotos(photos);
}

async function removePhotos(photos: Array<{ id: string; workspaceId: string }>): Promise<void> {
  for (const workspaceId of new Set(photos.map((p) => p.workspaceId))) {
    await removeChatPhotoFiles(workspaceId, photos.filter((p) => p.workspaceId === workspaceId).map((p) => p.id));
  }
}

// Chats, then photos uploaded but never sent.
async function deleteWhere(chats: SQL | undefined, photos: SQL | undefined): Promise<void> {
  await deleteChats((await db.select({ id: aiChats.id }).from(aiChats).where(chats)).map((c) => c.id));
  const unsent = await db.select({ id: aiChatPhotos.id, workspaceId: aiChatPhotos.workspaceId }).from(aiChatPhotos).where(photos);
  if (unsent.length) await db.delete(aiChatPhotos).where(inArray(aiChatPhotos.id, unsent.map((p) => p.id)));
  await removePhotos(unsent);
}
export const deleteAllChats = (): Promise<void> => deleteWhere(undefined, undefined);
export const deleteAllChatsOf = (userId: string): Promise<void> => deleteWhere(eq(aiChats.userId, userId), eq(aiChatPhotos.userId, userId));
export const deleteMemberChats = (workspaceId: string, userId: string): Promise<void> =>
  deleteWhere(and(eq(aiChats.workspaceId, workspaceId), eq(aiChats.userId, userId)), and(eq(aiChatPhotos.workspaceId, workspaceId), eq(aiChatPhotos.userId, userId)));

// Which chats are over the limits, oldest first until the rest fit. Pure, so
// tests can check it. keep: never removed for size. A pinned chat expires
// only at the server's age limit (a person's own skips it), and goes for size
// only once every unpinned one has (docs/api/chat.md §12, "Pinned chats").
export function overLimits(chats: readonly ChatSize[], limits: ChatLimits, serverMaxDays: number | null, keep: string | null, now = new Date()): string[] {
  const cutoffOf = (days: number | null): number | null => (days === null ? null : now.getTime() - days * 24 * 3600_000);
  const cutoff = cutoffOf(limits.maxDays);
  const pinnedCutoff = cutoffOf(serverMaxDays);
  const tooOld = (c: ChatSize): boolean => {
    const at = c.pinned ? pinnedCutoff : cutoff;
    return at !== null && c.updatedAt.getTime() < at;
  };
  const expired = new Set(chats.filter((c) => tooOld(c) && c.id !== keep).map((c) => c.id));
  if (limits.maxBytes === null) return [...expired];
  let total = sumBytes(chats.filter((c) => !expired.has(c.id)));
  const oldest = chats
    .filter((c) => !expired.has(c.id) && c.id !== keep)
    .sort((a, b) => Number(!!a.pinned) - Number(!!b.pinned) || a.updatedAt.getTime() - b.updatedAt.getTime());
  for (const chat of oldest) {
    if (total <= limits.maxBytes) break;
    expired.add(chat.id);
    total -= chat.bytes;
  }
  return [...expired];
}

export async function pruneChatsOf(userId: string, keep: string | null): Promise<void> {
  const [row] = await db.select({ chatLimits: users.chatLimits }).from(users).where(eq(users.id, userId));
  const server = await getChatLimits();
  await deleteChats(overLimits(await chatSizes(eq(aiChats.userId, userId)), effectiveChatLimits(server, row?.chatLimits ?? null), server.maxDays, keep));
}

export async function pruneAllChats(): Promise<void> {
  const server = await getChatLimits();
  const people = await db.selectDistinct({ id: aiChats.userId, chatLimits: users.chatLimits }).from(aiChats).innerJoin(users, eq(aiChats.userId, users.id));
  for (const person of people) {
    await deleteChats(overLimits(await chatSizes(eq(aiChats.userId, person.id)), effectiveChatLimits(server, person.chatLimits), server.maxDays, null));
  }
}

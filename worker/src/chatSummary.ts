// Summarize and continue (docs/api/chat.md §12, "Long chats";
// llm-contract.md §9e): the chat's finished messages, all but the newest
// KEEP_RECENT, folded with any earlier summary into one the replies send
// ahead of the messages after it.
import type { ChatSummaryJobData } from "@barista/shared/jobs";
import { aiChatMessages, aiChats } from "@barista/shared/schema";
import { asc, eq } from "drizzle-orm";
import { resolveAi } from "./ai/resolve.js";
import { withProposals } from "./chat.js";
import { db } from "./db.js";
import { complete } from "./llm.js";
import { CHAT_SUMMARY_SYSTEM } from "./prompt.js";

// Left as they are, so the reply after a summary still has the thread's end.
export const KEEP_RECENT = 10;
const SUMMARY_MAX = 6000; // characters

export type ChatSummaryResult = { status: "saved" | "failed" } | { status: "skipped"; reason: string };

// Never throws: a failed summary is marked failed and the old one stays.
export async function processChatSummary({ chatId }: ChatSummaryJobData): Promise<ChatSummaryResult> {
  const [chat] = await db.select().from(aiChats).where(eq(aiChats.id, chatId));
  if (!chat) return { status: "skipped", reason: "chat no longer exists" };
  if (chat.summaryStatus !== "pending") return { status: "skipped", reason: "no summary asked for" };
  try {
    const done = (await db.select().from(aiChatMessages).where(eq(aiChatMessages.chatId, chatId)).orderBy(asc(aiChatMessages.position))).filter((m) => m.status === "done");
    const after = chat.summary ? (chat.summaryThrough ?? 0) : 0;
    const covered = done.slice(0, Math.max(0, done.length - KEEP_RECENT)).filter((m) => m.position > after);
    if (!covered.length) {
      await db.update(aiChats).set({ summaryStatus: null }).where(eq(aiChats.id, chatId));
      return { status: "skipped", reason: "nothing new to summarize" };
    }
    const input = {
      earlierSummary: chat.summary ?? undefined,
      messages: covered.map((m) => ({
        role: m.role,
        content: m.role === "assistant" ? withProposals(m.content, m.proposals) : m.content,
        attached: m.attachments?.length ? m.attachments.map((a) => `${a.kind}: ${a.label}`) : undefined,
      })),
    };
    const ai = await resolveAi(chat.workspaceId);
    const { message } = await complete(ai, {
      model: ai.models.main,
      messages: [
        { role: "system", content: CHAT_SUMMARY_SYSTEM },
        { role: "user", content: JSON.stringify(input) },
      ],
    });
    const text = (message?.content ?? "").trim().slice(0, SUMMARY_MAX);
    if (!text) throw new Error("The AI returned an empty summary");
    await db.update(aiChats).set({ summary: text, summaryThrough: covered.at(-1)!.position, summaryStatus: null }).where(eq(aiChats.id, chatId));
    return { status: "saved" };
  } catch (err) {
    console.error(`Chat summary ${chatId} failed: ${err instanceof Error ? err.message : String(err)}`);
    await db.update(aiChats).set({ summaryStatus: "failed" }).where(eq(aiChats.id, chatId));
    return { status: "failed" };
  }
}

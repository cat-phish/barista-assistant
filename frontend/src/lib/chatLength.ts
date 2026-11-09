// Long chats (docs/api/chat.md §12, "Long chats"): each reply is sent the
// last HISTORY_SENT finished messages after the chat's summary, with the
// summary ahead of them (the worker's chatTurns). This says what that is,
// roughly how many tokens it comes to, and when to offer "Summarize and
// continue".
import type { Chat, ChatMessage } from '../api/chats';

export const HISTORY_SENT = 40;
export const NOTICE_AT = 30; // messages not yet summarized
export const NOTICE_TOKENS = 60_000; // the history and attachments together
export const SUMMARY_MIN = 12; // finished messages the server needs to summarize

type Summary = Pick<Chat, 'summary' | 'summaryThrough'>;
type Message = Pick<ChatMessage, 'position' | 'status' | 'content'>;

const after = (chat: Summary | null) => (chat?.summary ? (chat.summaryThrough ?? 0) : 0);

// The finished messages the summary doesn't cover.
export function unsummarized<T extends Message>(messages: readonly T[], chat: Summary | null): T[] {
  return messages.filter((m) => m.status === 'done' && m.position > after(chat));
}

// About 4 characters a token: the summary and the messages a reply is sent.
export function historyTokens(messages: readonly Message[], chat: Summary | null): number {
  const sent = unsummarized(messages, chat).slice(-HISTORY_SENT);
  return Math.round((sent.reduce((n, m) => n + m.content.length, 0) + (chat?.summary?.length ?? 0)) / 4);
}

// ok; soon: older messages are about to stop being sent; dropping: they have.
export type ChatLength = 'ok' | 'soon' | 'dropping';
export function chatLength(messages: readonly Message[], chat: Summary | null, attachmentTokens: number): ChatLength {
  const open = unsummarized(messages, chat).length;
  if (open > HISTORY_SENT) return 'dropping';
  if (open >= NOTICE_AT || historyTokens(messages, chat) + attachmentTokens >= NOTICE_TOKENS) return 'soon';
  return 'ok';
}

export const canSummarize = (messages: readonly Message[]): boolean => messages.filter((m) => m.status === 'done').length >= SUMMARY_MIN;

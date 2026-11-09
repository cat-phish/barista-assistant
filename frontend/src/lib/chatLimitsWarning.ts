// The yellow note at the bottom of the chat page (docs/api/chat.md §12,
// "Keeping and purging"): before the size limit deletes your oldest
// unpinned chats, and before the age limit deletes this one.
import type { Chat, ChatSettings } from '../api/chats';
import { formatBytes } from './chatSize';

export const SIZE_WARN_AT = 0.8; // of the limit
export const AGE_WARN_DAYS = 7; // before a chat expires
const DAY = 86_400_000;

export function chatLimitsWarning(settings: Pick<ChatSettings, 'usedBytes' | 'effective'> | null, chat: Pick<Chat, 'updatedAt' | 'pinnedAt'> | null, now = new Date()): string[] {
  if (!settings) return [];
  const notes: string[] = [];
  const { maxBytes, maxDays } = settings.effective;
  if (maxBytes !== null && settings.usedBytes >= maxBytes * SIZE_WARN_AT) {
    notes.push(`Your chats use ${formatBytes(settings.usedBytes)} of ${formatBytes(maxBytes)}. Past it, your oldest unpinned chats are deleted: pin or export the ones to keep.`);
  }
  if (maxDays !== null && chat && !chat.pinnedAt) {
    const expires = new Date(new Date(chat.updatedAt).getTime() + maxDays * DAY);
    if (expires.getTime() - now.getTime() <= AGE_WARN_DAYS * DAY) {
      notes.push(`This chat will be deleted on ${expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} unless you add to it or pin it.`);
    }
  }
  return notes;
}

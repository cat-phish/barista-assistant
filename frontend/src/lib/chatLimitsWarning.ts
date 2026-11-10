// The yellow note at the bottom of the chat page (docs/api/chat.md §12,
// "Keeping and purging"): before the size limit deletes your oldest
// unpinned chats, and before an age limit deletes this one: yours or the
// server's for an unpinned chat, only the server's for a pinned one.
import type { Chat, ChatSettings } from '../api/chats';
import { formatBytes } from './chatSize';

export const SIZE_WARN_AT = 0.8; // of the limit
export const AGE_WARN_DAYS = 7; // before a chat expires
export const PIN_GRACE_DAYS = 7; // after the server's age limit is set (shared/src/aiConfig.ts)
const DAY = 86_400_000;

export function chatLimitsWarning(settings: (Pick<ChatSettings, 'usedBytes' | 'effective'> & { server: Pick<ChatSettings['server'], 'maxDays' | 'maxDaysSetAt'> }) | null, chat: Pick<Chat, 'updatedAt' | 'pinnedAt'> | null, now = new Date()): string[] {
  if (!settings) return [];
  const notes: string[] = [];
  const { maxBytes, maxDays } = settings.effective;
  if (maxBytes !== null && settings.usedBytes >= maxBytes * SIZE_WARN_AT) {
    notes.push(`Your chats use ${formatBytes(settings.usedBytes)} of ${formatBytes(maxBytes)}. Past it, your oldest unpinned chats are deleted: pin or export the ones to keep.`);
  }
  const days = chat?.pinnedAt ? settings.server.maxDays : maxDays;
  if (days !== null && chat) {
    // A pinned chat a new server limit catches is kept a week from then.
    const setAt = chat.pinnedAt && settings.server.maxDaysSetAt ? Date.parse(settings.server.maxDaysSetAt) + PIN_GRACE_DAYS * DAY : 0;
    const expires = new Date(Math.max(new Date(chat.updatedAt).getTime() + days * DAY, setAt));
    if (expires.getTime() - now.getTime() <= AGE_WARN_DAYS * DAY) {
      const on = expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      notes.push(
        chat.pinnedAt
          ? `This pinned chat will be deleted on ${on}: the server keeps chats for ${days} days. Export it to keep a copy, or add to it.`
          : `This chat will be deleted on ${on} unless you add to it or pin it.`,
      );
    }
  }
  return notes;
}

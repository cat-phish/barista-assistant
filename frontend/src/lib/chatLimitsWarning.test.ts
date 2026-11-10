import { describe, expect, it } from 'vitest';
import { chatLimitsWarning } from './chatLimitsWarning';

const GB = 1024 ** 3;
const settings = (usedBytes: number, maxBytes: number | null, maxDays: number | null = null, serverDays: number | null = null, maxDaysSetAt: string | null = null) => ({
  usedBytes,
  effective: { maxBytes, maxDays },
  server: { maxDays: serverDays, maxDaysSetAt },
});
const now = new Date('2026-11-09T12:00:00Z');

describe('chatLimitsWarning', () => {
  it('warns from 80% of the size limit', () => {
    expect(chatLimitsWarning(settings(0.79 * GB, GB), null, now)).toEqual([]);
    expect(chatLimitsWarning(settings(0.8 * GB, GB), null, now)[0]).toMatch(/^Your chats use 819\.2 MB of 1 GB\. Past it, your oldest unpinned chats are deleted/);
    expect(chatLimitsWarning(settings(5 * GB, null), null, now)).toEqual([]);
  });
  it("warns a pinned chat only of the server's age limit", () => {
    const old = { updatedAt: '2026-08-14T12:00:00Z', pinnedAt: '2026-08-14T12:00:00Z' };
    expect(chatLimitsWarning(settings(0, null, 90, null), old, now)).toEqual([]); // your own limit
    expect(chatLimitsWarning(settings(0, null, 90, 90), old, now)).toEqual(['This pinned chat will be deleted on 12 Nov: the server keeps chats for 90 days. Export it to keep a copy, or add to it.']);
    // Caught by a limit set today (30 days): the week's grace gives 16 Nov.
    expect(chatLimitsWarning(settings(0, null, 30, 30, '2026-11-09T12:00:00Z'), old, now)).toEqual(['This pinned chat will be deleted on 16 Nov: the server keeps chats for 30 days. Export it to keep a copy, or add to it.']);
  });
  it('warns a week before this chat expires, unless it is pinned', () => {
    const old = { updatedAt: '2026-08-14T12:00:00Z', pinnedAt: null }; // 90 days: deleted 12 Nov
    expect(chatLimitsWarning(settings(0, null, 90), old, now)).toEqual(['This chat will be deleted on 12 Nov unless you add to it or pin it.']);
    expect(chatLimitsWarning(settings(0, null, 90), { ...old, pinnedAt: '2026-11-01T00:00:00Z' }, now)).toEqual([]);
    expect(chatLimitsWarning(settings(0, null, 90), { ...old, updatedAt: '2026-10-01T00:00:00Z' }, now)).toEqual([]);
  });
});

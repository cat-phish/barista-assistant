import { describe, expect, it } from 'vitest';
import { canSummarize, chatLength, historyTokens, NOTICE_TOKENS, unsummarized } from './chatLength';

const msgs = (n: number, content = 'abcd') => Array.from({ length: n }, (_, i) => ({ position: i + 1, status: 'done' as const, content }));
const none = { summary: null, summaryThrough: null };

describe('chatLength', () => {
  it('is fine until 30 messages, then soon, then dropping past 40', () => {
    expect(chatLength(msgs(29), none, 0)).toBe('ok');
    expect(chatLength(msgs(30), none, 0)).toBe('soon');
    expect(chatLength(msgs(41), none, 0)).toBe('dropping');
  });
  it('counts only what the summary leaves', () => {
    const chat = { summary: 'Earlier.', summaryThrough: 30 };
    expect(unsummarized(msgs(41), chat)).toHaveLength(11);
    expect(chatLength(msgs(41), chat, 0)).toBe('ok');
  });
  it('warns early on tokens: long messages or big attachments', () => {
    expect(chatLength(msgs(4, 'x'.repeat(80_000)), none, 0)).toBe('soon');
    expect(chatLength(msgs(4), none, NOTICE_TOKENS)).toBe('soon');
  });
  it('estimates the history sent: the last 40 and the summary', () => {
    expect(historyTokens(msgs(50, 'abcd'), none)).toBe(40);
    expect(historyTokens(msgs(2, 'abcd'), { summary: 'x'.repeat(400), summaryThrough: 1 })).toBe(101);
  });
  it('needs 12 finished messages to summarize', () => {
    expect(canSummarize(msgs(11))).toBe(false);
    expect(canSummarize(msgs(12))).toBe(true);
  });
});

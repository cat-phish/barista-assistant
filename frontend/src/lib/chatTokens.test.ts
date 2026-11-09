import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../api/chats';
import { estimateTokens, TOKEN_WARNING, TOKENS, tokenWarning } from './chatTokens';

const item = (kind: ChatAttachment['kind'], id: string = kind): ChatAttachment => ({ kind, id, label: id });

describe('estimateTokens', () => {
  it('adds up each kind', () => {
    expect(estimateTokens([item('brew'), item('bean'), item('recipe')], new Map(), 60)).toBe(TOKENS.brew + TOKENS.bean + TOKENS.recipe);
    const chart = { ...item('chart'), chart: { tab: 't', title: 'c', note: null, filters: '', head: ['a'], rows: [['x'], ['y']], cut: 0 } };
    expect(estimateTokens([chart], new Map(), 60)).toBe(TOKENS.chartBase + 2 * TOKENS.chartRow);
  });
  it('counts a period at its brews, up to the cap, or at the cap when unknown', () => {
    expect(estimateTokens([item('period', 'p')], new Map([['p', 10]]), 60)).toBe(TOKENS.periodBase + 10 * TOKENS.periodBrew);
    expect(estimateTokens([item('period', 'p')], new Map([['p', 500]]), 60)).toBe(TOKENS.periodBase + 60 * TOKENS.periodBrew);
    expect(estimateTokens([item('period', 'p')], new Map(), 100)).toBe(TOKENS.periodBase + 100 * TOKENS.periodBrew);
  });
});

describe('tokenWarning', () => {
  it('shows only past the threshold', () => {
    expect(tokenWarning(TOKEN_WARNING - 1)).toBeNull();
    expect(tokenWarning(40_400)).toMatch(/^≈ 40k tokens, sent again with every reply/);
  });
});

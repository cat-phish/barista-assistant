import { describe, expect, it } from 'vitest';
import { AI_DETAIL_LIST } from './aiDetails';

// The shared list, read as text: the frontend doesn't import @barista/shared.
const shared = Object.values(import.meta.glob('../../../shared/src/aiDetails.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const sharedKeys = [...shared.slice(shared.indexOf('AI_DETAILS = ['), shared.indexOf('] as const')).matchAll(/^\s+"(\w+)"/gm)].map((m) => m[1]);

describe('AI details (Settings → AI)', () => {
  it('lists every key the worker knows, once, in the same order', () => {
    expect(sharedKeys.length).toBeGreaterThan(20);
    expect(AI_DETAIL_LIST.map((x) => x.key)).toEqual(sharedKeys);
  });
});

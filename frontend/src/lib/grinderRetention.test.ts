import { describe, expect, it } from 'vitest';
import { grinderRetention, grinderRetentionText } from './grinderRetention';

describe('grinder retention', () => {
  it('is beans in minus grounds out, in grams and % of what went in', () => {
    expect(grinderRetention(18.2, 17.9)).toEqual({ grams: 0.3, percent: 1.6 });
    expect(grinderRetention(18, 18)).toEqual({ grams: 0, percent: 0 });
    expect(grinderRetentionText(18.2, 17.9)).toBe('Grinder retention 0.3 g (1.6%)');
  });
  it('needs both weights, and out no more than in', () => {
    expect(grinderRetention(18, null)).toBeNull();
    expect(grinderRetention(null, 18)).toBeNull();
    expect(grinderRetention(18, 18.1)).toBeNull();
    expect(grinderRetentionText(18, null)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { startDelayFor } from './startDelay';

describe('per-method start delays', () => {
  it('selects each method independently, a brew without a type using other', () => {
    const prefs = { startDelays: { filter: 5 as const, espresso: 0 as const, stovetop: 3 as const, other: 5 as const } };
    expect(startDelayFor(prefs, 'filter')).toBe(5);
    expect(startDelayFor(prefs, 'espresso')).toBe(0);
    expect(startDelayFor(prefs, 'stovetop')).toBe(3);
    expect(startDelayFor(prefs, 'other')).toBe(5);
    expect(startDelayFor(prefs, null)).toBe(5);
  });
  it('defaults to no delay for a method without one', () => {
    expect(startDelayFor({ startDelays: {} }, 'filter')).toBe(0);
    expect(startDelayFor({ startDelays: { espresso: 3 } }, 'filter')).toBe(0);
  });
});

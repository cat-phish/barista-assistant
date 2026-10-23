import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN, slugify } from './slug';

describe('slugify', () => {
  it('drops accents and apostrophes and joins words with hyphens', () => {
    expect(slugify("Jordan's Café")).toBe('jordans-cafe');
    expect(slugify('  The   Bar!! ')).toBe('the-bar');
  });
  it('stays within 64 characters', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(64);
  });
});

describe('SLUG_PATTERN', () => {
  it('matches the API rule', () => {
    expect(SLUG_PATTERN.test('my-bar')).toBe(true);
    expect(SLUG_PATTERN.test('ab')).toBe(false);
    expect(SLUG_PATTERN.test('My Bar')).toBe(false);
  });
});

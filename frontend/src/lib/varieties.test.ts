import { describe, expect, it } from 'vitest';
import { COMMON_VARIETIES, canonicalVariety } from './varieties';

describe('canonicalVariety', () => {
  it('rewrites known spellings to the suggested one', () => {
    expect(canonicalVariety('SL-28')).toBe('SL28');
    expect(canonicalVariety('ruiru-11')).toBe('Ruiru 11');
    expect(canonicalVariety('Anacafe 14')).toBe('Anacafé 14');
    expect(canonicalVariety('Catuaí')).toBe('Catuai');
  });
  it('keeps unknown names and both Geisha spellings', () => {
    expect(canonicalVariety('My Farm Lot')).toBe('My Farm Lot');
    expect(canonicalVariety('Geisha')).toBe('Geisha');
    expect(canonicalVariety('Gesha')).toBe('Gesha');
  });
  it('has no two suggestions that collide', () => {
    expect(canonicalVariety('Pop3303/21')).toBe('Pop3303/21');
    expect(COMMON_VARIETIES.every((v) => canonicalVariety(v) === v)).toBe(true);
  });
});

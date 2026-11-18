import { describe, expect, it } from 'vitest';
import { countFrame, easeOut, splitNumber } from './countUp';

describe('count-up on the year slides (backlog 65)', () => {
  it('finds a leading number, and keeps what is around it', () => {
    expect(splitNumber('1,234 brews')).toEqual({ before: '', token: '1,234', after: ' brews' });
    expect(splitNumber('≈ 30.5 l')).toEqual({ before: '≈ ', token: '30.5', after: ' l' });
    expect(splitNumber('4.5 ★ Kenya')).toEqual({ before: '', token: '4.5', after: ' ★ Kenya' });
    expect(splitNumber('7 brews')).toEqual({ before: '', token: '7', after: ' brews' });
    expect(splitNumber('Saturdays, 7 am')).toBeNull();
    expect(splitNumber('March')).toBeNull();
  });

  it('counts with the separators kept, and lands on the value', () => {
    expect(countFrame('1,234', 0)).toBe('0');
    expect(countFrame('1,234', 1)).toBe('1,234');
    expect(countFrame('4.5', 0)).toBe('0.0');
    expect(countFrame('30.5', 1)).toBe('30.5');
    const mid = countFrame('1,234', 0.5);
    expect(mid).toMatch(/^1,0\d\d$/); // 1234 × 0.875 ≈ 1080
    expect(countFrame('12,345', 0.01)).toMatch(/^\d{1,3}(,\d{3})?$/);
  });

  it('eases out and stays in 0–1', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

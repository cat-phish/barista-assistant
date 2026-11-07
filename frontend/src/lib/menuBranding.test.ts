import { describe, expect, it } from 'vitest';
import { contrastOnWhite, tooLight } from './menuBranding';

describe('accent colour contrast', () => {
  it('measures against white', () => {
    expect(contrastOnWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastOnWhite('#ffffff')).toBeCloseTo(1, 5);
  });

  it('flags colours too light for headings', () => {
    expect(tooLight('#3e2723')).toBe(false); // the app's brown
    expect(tooLight('#8a4b2a')).toBe(false);
    expect(tooLight('#f5d76e')).toBe(true); // pale yellow
    expect(tooLight('not a colour')).toBe(false);
  });
});

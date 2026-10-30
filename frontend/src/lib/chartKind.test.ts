import { describe, expect, it } from 'vitest';
import { parseChartKind } from './chartKind';

describe('parseChartKind', () => {
  it('is a bar chart unless a line was remembered', () => {
    expect(parseChartKind('line')).toBe('line');
    expect(parseChartKind('bar')).toBe('bar');
    expect(parseChartKind(null)).toBe('bar');
    expect(parseChartKind('pie')).toBe('bar');
  });
});

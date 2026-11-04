import { describe, expect, it } from 'vitest';
import { OTHER } from '../../lib/stats';
import { usedAndLeftOf, type UsageRow } from './charts';

const row = (label: string, used: number, left: number, archived = false): UsageRow => ({ label, used, left, archived });

describe('usedAndLeftOf', () => {
  it('draws used and left side by side, an archived bean with nothing left', () => {
    const c = usedAndLeftOf([row('A', 300, 200), row('B', 120, 500, true)]);
    expect(c.labels).toEqual(['A', 'B']);
    expect(c.series).toEqual([
      { label: 'Used', data: [300, 120] },
      { label: 'Left', data: [200, 0] },
    ]);
    expect(c.table.head).toEqual(['Bean', 'Used (g)', 'Left (g)']);
    expect(c.table.rows).toEqual([
      ['A', 300, 200],
      ['B (archived)', 120, '–'],
    ]);
  });

  it('folds the rest into Other in the chart, the table keeps every bean', () => {
    const rows = Array.from({ length: 13 }, (_, i) => row(`Bean ${i}`, 100 - i, 10, i === 12));
    const c = usedAndLeftOf(rows, 10);
    expect(c.labels).toHaveLength(11);
    expect(c.labels[10]).toBe(OTHER);
    expect(c.series[0]!.data[10]).toBe(90 + 89 + 88);
    expect(c.series[1]!.data[10]).toBe(10 + 10); // the archived one counts 0
    expect(c.table.rows).toHaveLength(13);
  });

  it('keeps a single extra bean rather than an Other of one', () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`Bean ${i}`, 50, 5));
    expect(usedAndLeftOf(rows, 10).labels).not.toContain(OTHER);
  });
});

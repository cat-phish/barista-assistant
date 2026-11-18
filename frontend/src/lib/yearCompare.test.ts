import { describe, expect, it } from 'vitest';
import { compareChips, deltaChip, newToYou } from './yearCompare';
import type { YearFigures } from './yearInCoffee';

describe('Your Year in Coffee compared with earlier years (backlog 65)', () => {
  it('words a change: percent, about the same, a multiple, days, stars', () => {
    expect(deltaChip('percent', 105, 100, '2025')).toEqual({ dir: 'up', text: '+5% on 2025' });
    expect(deltaChip('percent', 80, 100, '2025')).toEqual({ dir: 'down', text: '−20% on 2025' });
    expect(deltaChip('percent', 101.5, 100, '2025')).toEqual({ dir: 'same', text: 'About the same as 2025' });
    expect(deltaChip('percent', 240, 100, '2025')).toEqual({ dir: 'up', text: '2.4× 2025' });
    expect(deltaChip('percent', 200, 100, '2025').text).toBe('2× 2025');
    expect(deltaChip('days', 13, 9, '2025')).toEqual({ dir: 'up', text: '+4 days on 2025' });
    expect(deltaChip('days', 8, 9, '2025').text).toBe('−1 day on 2025');
    expect(deltaChip('stars', 4.3, 4.0, '2025')).toEqual({ dir: 'up', text: '+0.3 ★ on 2025' });
    expect(deltaChip('stars', 4.04, 4.0, '2025')).toEqual({ dir: 'same', text: 'About the same as 2025' });
  });

  it('needs 5 brews in an earlier year, and 2 years for an average or record', () => {
    const e = (year: number, value: number, brews = 50) => ({ year, value, brews });
    expect(compareChips(2026, 10, [e(2025, 8, 4)], 'percent')).toEqual([]); // too few brews
    expect(compareChips(2026, 10, [e(2025, 0)], 'percent')).toEqual([]); // nothing then
    expect(compareChips(2026, null, [e(2025, 8)], 'percent')).toEqual([]); // nothing now
    expect(compareChips(2026, 10, [e(2024, 8)], 'percent')).toEqual([]); // no last year, one year: nothing
    expect(compareChips(2026, 10, [e(2025, 8), e(2024, 9)], 'percent', { record: 'Best' }).map((c) => c.text)).toEqual(['+25% on 2025', 'Best']);
    expect(compareChips(2026, 10, [e(2025, 8), e(2024, 12)], 'percent', { record: 'Best' }).map((c) => c.text)).toEqual(['+25% on 2025', 'About the same as an average year']);
    expect(compareChips(2026, 10, [e(2025, 8), e(2024, 12)], 'percent', { average: false })).toHaveLength(1);
    expect(compareChips(2026, 10, [e(2025, 8)], 'percent', { soFar: true })[0]!.text).toBe('+25% on 2025 by this date');
  });

  it('finds names never brewed before, ignoring case', () => {
    const h = [{ originNames: ['kenya'] }, { originNames: ['Peru'] }] as unknown as YearFigures[];
    expect(newToYou(['Kenya', 'Peru', 'Laos'], h, (y) => y.originNames)).toEqual(['Laos']);
  });
});

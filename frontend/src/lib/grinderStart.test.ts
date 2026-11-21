import { describe, expect, it } from 'vitest';
import type { Grinder } from '../api/types';
import { grinderCanDo, grinderChoices, grinderStartingPoint, START_TARGETS, startPointLabel, startTarget } from './grinderStart';

const start = { startingSetting: 20, startingPoints: [{ method: 'espresso' as const, style: null, setting: 8 }, { method: 'filter' as const, style: 'cold_brew' as const, setting: 30 }] };

describe('grinder starting points (docs/api/grinders.md §3b)', () => {
  it("the style's row, else the method's, else the general one", () => {
    expect(grinderStartingPoint(start, 'filter', 'cold_brew')?.setting).toBe(30);
    expect(grinderStartingPoint(start, 'filter', 'pour_over')).toEqual({ setting: 20, point: null });
    expect(grinderStartingPoint(start, 'espresso', 'soup')?.setting).toBe(8);
    expect(grinderStartingPoint(start, null, null)?.setting).toBe(20);
    expect(grinderStartingPoint({ ...start, startingSetting: null }, 'stovetop', 'moka')).toBeNull();
    expect(grinderStartingPoint({ startingSetting: null, startingPoints: null }, 'filter', null)).toBeNull();
  });

  it('labels what a point is for', () => {
    expect(startPointLabel(grinderStartingPoint(start, 'filter', 'cold_brew')?.point ?? null)).toBe('cold brew');
    expect(startPointLabel(grinderStartingPoint(start, 'espresso', null)?.point ?? null)).toBe('espresso');
    expect(startPointLabel(null)).toBe('every method');
  });

  it('targets: each method, and its styles but "other"', () => {
    const keys = START_TARGETS.flatMap((m) => m.targets.map((t) => t.key));
    expect(keys).toContain('espresso');
    expect(keys).toContain('filter/cold_brew');
    expect(keys.some((k) => k.endsWith('/other'))).toBe(false);
    expect(startTarget('stovetop/moka')).toMatchObject({ method: 'stovetop', style: 'moka', label: 'Stovetop · Moka' });
  });

});

describe('methods a grinder cannot do', () => {
  const g = (id: string, unavailableMethods: Grinder['unavailableMethods'], archivedAt: string | null = null) => ({ id, unavailableMethods, archivedAt });
  const list = [g('both', null), g('filterOnly', ['espresso']), g('old', null, '2026-01-01')];
  it('hides grinders that cannot do the method, but keeps the chosen one', () => {
    expect(grinderCanDo(list[1]!, 'espresso')).toBe(false);
    expect(grinderCanDo(list[1]!, null)).toBe(true);
    expect(grinderChoices(list, 'espresso').map((x) => x.id)).toEqual(['both']);
    expect(grinderChoices(list, 'filter').map((x) => x.id)).toEqual(['both', 'filterOnly']);
    expect(grinderChoices(list, 'espresso', 'filterOnly').map((x) => x.id)).toEqual(['both', 'filterOnly']);
    expect(grinderChoices(list, 'espresso', 'old').map((x) => x.id)).toEqual(['both', 'old']);
  });
});

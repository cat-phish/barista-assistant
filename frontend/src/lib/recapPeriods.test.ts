import { describe, expect, it } from 'vitest';
import * as mine from './recapPeriods';
// The worker's copy (@barista/shared/recapPeriods): it has no imports, so the
// test loads it as it is and holds both to the same cases. A glob, not an
// import, so the frontend image (no shared/) still type-checks.
const shared = Object.values(import.meta.glob<typeof mine>('../../../shared/src/recapPeriods.ts', { eager: true }))[0]!;

describe.each([
  ['frontend', mine],
  ['shared', shared],
] as const)('recap periods (%s)', (_name, p) => {
  it('weeks start on the chosen day', () => {
    // Sunday 8 Nov 2026.
    expect(p.periodOf('weekly', '2026-11-08', 1)).toEqual({ start: '2026-11-02', end: '2026-11-08' }); // Monday weeks
    expect(p.periodOf('weekly', '2026-11-08', 0)).toEqual({ start: '2026-11-08', end: '2026-11-14' }); // Sunday weeks
    expect(p.periodOf('weekly', '2026-11-09', 1)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(p.periodOf('weekly', '2026-11-04', 6)).toEqual({ start: '2026-10-31', end: '2026-11-06' }); // Saturday weeks
    expect(p.periodOf('weekly', '2026-12-31', 1)).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('months run to their last day, leap years included', () => {
    expect(p.periodOf('monthly', '2026-11-08', 1)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(p.periodOf('monthly', '2028-02-10', 1)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(p.periodOf('monthly', '2027-02-10', 1)).toEqual({ start: '2027-02-01', end: '2027-02-28' });
    expect(p.periodOf('monthly', '2026-12-31', 1)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('steps back and forward, and finds the one just ended', () => {
    const week = p.periodOf('weekly', '2026-11-09', 1);
    expect(p.previousPeriod('weekly', week, 1)).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(p.nextPeriod('weekly', week, 1)).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(p.previousPeriod('monthly', p.periodOf('monthly', '2027-01-15', 1), 1)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(p.justEnded('weekly', '2026-11-09', 1)).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(p.justEnded('monthly', '2026-11-09', 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(p.daysAfter({ start: '2026-11-02', end: '2026-11-08' }, '2026-11-09')).toBe(1);
    expect(p.daysAfter({ start: '2026-10-01', end: '2026-10-31' }, '2026-11-03')).toBe(3);
  });

  it('labels a period', () => {
    expect(p.periodLabel('weekly', { start: '2026-11-02', end: '2026-11-08' })).toBe('2–8 Nov');
    expect(p.periodLabel('weekly', { start: '2026-10-26', end: '2026-11-01' })).toBe('26 Oct – 1 Nov');
    expect(p.periodLabel('weekly', { start: '2026-12-28', end: '2027-01-03' })).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(p.periodLabel('monthly', { start: '2026-11-01', end: '2026-11-30' })).toBe('November 2026');
  });
});

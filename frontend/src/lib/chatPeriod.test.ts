import { describe, expect, it } from 'vitest';
import * as mine from './chatPeriod';
// The shared copy (@barista/shared/chatPeriod): it has no imports, so the
// test loads it as it is and holds both to the same cases. A glob, not an
// import, so the frontend image (no shared/) still type-checks.
const shared = Object.values(import.meta.glob<typeof mine>('../../../shared/src/chatPeriod.ts', { eager: true }))[0]!;

const spec = (fields: Partial<mine.ChatPeriodSpec> = {}): mine.ChatPeriodSpec => ({ range: '7d', from: null, to: null, beanId: null, recipeId: null, brewerId: null, mine: false, ...fields });

describe.each([
  ['frontend', mine],
  ['shared', shared],
] as const)('chat periods (%s)', (_name, p) => {
  it('counts a rolling range back from today, and the days before it', () => {
    expect(p.resolveChatPeriod(spec(), '2026-11-09')).toEqual({ period: { start: '2026-11-03', end: '2026-11-09' }, previous: { start: '2026-10-27', end: '2026-11-02' } });
    expect(p.resolveChatPeriod(spec({ range: 'all' }), '2026-11-09')).toEqual({ period: { start: null, end: '2026-11-09' }, previous: null });
    expect(p.resolveChatPeriod(spec({ range: 'month', from: '2026-03-01', to: '2026-03-31' }), '2026-11-09').previous).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('fixes the calendar weeks and months on the week start', () => {
    expect(p.calendarDates('lastWeek', '2026-11-09', 1)).toEqual({ range: 'week', from: '2026-11-02', to: '2026-11-08' });
    expect(p.calendarDates('thisWeek', '2026-11-09', 0)).toEqual({ range: 'week', from: '2026-11-08', to: '2026-11-14' });
    expect(p.calendarDates('lastMonth', '2026-03-31', 1)).toEqual({ range: 'month', from: '2026-02-01', to: '2026-02-28' });
  });
  it('labels it as the server does', () => {
    expect(p.periodLabel(spec({ range: '90d', mine: true }), { recipe: 'House' })).toBe('Brews, last 90 days · House · Only mine');
    expect(p.periodLabel(spec({ range: 'custom', from: '2026-12-28', to: '2027-01-03' }), {})).toBe('Brews, 28 Dec 2026 – 3 Jan 2027');
    expect(p.periodLabel(spec({ range: 'custom', from: '2026-11-03', to: '2026-11-09' }), {})).toBe('Brews, 3–9 Nov');
    expect(p.periodLabel(spec({ range: 'month', from: '2026-11-01', to: '2026-11-30' }), {})).toBe('Brews, November 2026');
  });
});

describe('the picker\'s choices', () => {
  const filters = { beanId: 'b', recipeId: null, brewerId: null, mine: true };
  it('keeps rolling ones rolling and fixes the rest', () => {
    expect(mine.choiceSpec('30d', { from: '', to: '' }, '2026-11-09', 1, filters)).toEqual({ range: '30d', from: null, to: null, ...filters });
    expect(mine.choiceSpec('lastWeek', { from: '', to: '' }, '2026-11-09', 1, filters)).toEqual({ range: 'week', from: '2026-11-02', to: '2026-11-08', ...filters });
    expect(mine.choiceSpec('custom', { from: '2026-11-05', to: '2026-11-01' }, '2026-11-09', 1, filters)).toEqual({ range: 'custom', from: '2026-11-01', to: '2026-11-05', ...filters });
    expect(mine.choiceSpec('custom', { from: '2026-11-05', to: '' }, '2026-11-09', 1, filters)).toBeNull();
  });
  it('gives the days for the brew list', () => {
    expect(mine.choiceDays('7d', { from: '', to: '' }, '2026-11-09', 1)).toEqual({ from: '2026-11-03', to: '2026-11-09' });
    expect(mine.choiceDays('thisMonth', { from: '', to: '' }, '2026-11-09', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(mine.choiceDays('all', { from: '', to: '' }, '2026-11-09', 1)).toEqual({ from: null, to: null });
  });
});

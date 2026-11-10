import { describe, expect, it } from 'vitest';
import { hasFilters, journalSummary, NO_FILTERS, parseJournalQuery, toApiQuery, toJournalQuery } from './journalFilters';

describe('journal filters in the URL', () => {
  it('round-trips, leaving defaults out', () => {
    const f = { ...NO_FILTERS, style: 's1', brewer: 'b1', range: 'custom' as const, from: '2026-10-01', to: '2026-10-31', mine: true, status: 'unrated' as const };
    const q = toJournalQuery(f);
    expect(q).toEqual({ style: 's1', brewer: 'b1', range: 'custom', from: '2026-10-01', to: '2026-10-31', mine: '1', status: 'unrated' });
    expect(parseJournalQuery(q as never)).toEqual(f);
    expect(toJournalQuery(NO_FILTERS)).toEqual({});
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });
  it("keeps old ?bean= links, and ignores what it doesn't know", () => {
    expect(parseJournalQuery({ bean: 'kenya' })).toEqual({ ...NO_FILTERS, bean: 'kenya' });
    expect(parseJournalQuery({ range: 'forever', status: 'done', mine: 'yes' })).toEqual(NO_FILTERS);
  });
  it('drops custom dates for a preset period', () => {
    expect(toJournalQuery({ ...NO_FILTERS, range: '30d', from: '2026-10-01' })).toEqual({ range: '30d' });
  });
});

describe('toApiQuery', () => {
  it('turns the period into from/to and empty filters into nothing', () => {
    expect(toApiQuery({ ...NO_FILTERS, style: 's1', range: '30d' }, '2026-11-09')).toEqual({
      beanId: undefined, styleId: 's1', brewerId: undefined, recipeId: undefined, status: undefined, mine: undefined, from: '2026-10-11', to: '2026-11-09',
    });
    expect(toApiQuery(NO_FILTERS, '2026-11-09')).toMatchObject({ from: undefined, to: undefined });
  });
});

describe('journalSummary', () => {
  const names: Record<string, string> = { s1: 'Cold brew', b1: 'V60' };
  const name = (id: string) => names[id];
  const day = (d: string) => d.slice(5);
  it('says what is applied', () => {
    expect(journalSummary(NO_FILTERS, name, day)).toBe('All brews');
    expect(journalSummary({ ...NO_FILTERS, style: 's1', brewer: 'b1', range: '30d', mine: true }, name, day)).toBe('Cold brew · V60 · Last 30 days · Mine');
    expect(journalSummary({ ...NO_FILTERS, range: 'custom', from: '2026-10-01', status: 'steeping' }, name, day)).toBe('10-01 – today · Steeping');
  });
});

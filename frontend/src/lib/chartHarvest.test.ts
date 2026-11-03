import { describe, expect, it } from 'vitest';
import { chartAttachId, chartSnapshot, CHART_ROWS_MAX, filtersText } from './chartHarvest';

describe('chartSnapshot', () => {
  it('keeps the table, title, note and filters', () => {
    expect(chartSnapshot('beans', 'Beans by country', null, 'All time', { head: ['Country', 'Beans'], rows: [['Kenya', 2]] })).toEqual({
      tab: 'beans',
      title: 'Beans by country',
      note: null,
      filters: 'All time',
      head: ['Country', 'Beans'],
      rows: [['Kenya', 2]],
      cut: 0,
    });
  });

  it('sends the first rows and counts the rest', () => {
    const rows = Array.from({ length: CHART_ROWS_MAX + 37 }, (_, i) => [i, i * 2]);
    const s = chartSnapshot('explore', 'Rating against dose', 'r = 0.4', 'All time', { head: ['Dose', 'Rating'], rows });
    expect(s.rows).toHaveLength(CHART_ROWS_MAX);
    expect(s.rows[0]).toEqual([0, 0]);
    expect(s.cut).toBe(37);
  });

  it('keeps numbers the server can read', () => {
    expect(chartSnapshot('t', 'T', null, '', { head: ['a', 'b'], rows: [[NaN, Infinity]] }).rows).toEqual([['NaN', 'Infinity']]);
  });
});

describe('filtersText', () => {
  it('names what the numbers cover', () => {
    expect(filtersText({ period: 'Last 30 days', bean: 'Onyx – Guji', recipe: null, brewer: 'V60', mine: true, by: 'Week', unit: 'ml' })).toBe(
      'Last 30 days · Bean: Onyx – Guji · Brewer: V60 · Only mine · By week · Volumes in ml',
    );
    expect(filtersText({ period: 'All time', bean: null, recipe: null, brewer: null, mine: false, by: null, unit: 'fl oz' })).toBe("All time · Everyone's brews · Volumes in fl oz");
  });
});

describe('chartAttachId', () => {
  it('is the same for the same chart and filters, and a UUID', () => {
    const a = chartAttachId('brews.rating', 'All time');
    expect(a).toBe(chartAttachId('brews.rating', 'All time'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs for another chart or other filters', () => {
    const a = chartAttachId('brews.rating', 'All time');
    expect(chartAttachId('brews.rating', 'Last 30 days')).not.toBe(a);
    expect(chartAttachId('brews.dose', 'All time')).not.toBe(a);
  });
});

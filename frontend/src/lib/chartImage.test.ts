import { describe, expect, it } from 'vitest';
import { chartFileName, tableText, titledLayout } from './chartImage';

describe('tableText', () => {
  it('is the head and rows, tab-separated', () => {
    expect(tableText({ head: ['Country', 'Beans'], rows: [['Ethiopia', 4], ['Kenya', 2]] })).toBe(
      'Country\tBeans\nEthiopia\t4\nKenya\t2',
    );
  });

  it('keeps a tab or line break inside a cell from splitting the row', () => {
    expect(tableText({ head: ['Name'], rows: [['a\tb'], ['c\r\nd']] })).toBe('Name\na b\nc d');
  });
});

describe('chartFileName', () => {
  it('is the title as a slug', () => {
    expect(chartFileName('Beans by country')).toBe('beans-by-country.png');
    expect(chartFileName('Rating (1–5), café brews!')).toBe('rating-1-5-cafe-brews.png');
  });

  it('falls back when nothing is left', () => {
    expect(chartFileName('')).toBe('chart.png');
    expect(chartFileName('—')).toBe('chart.png');
  });
});

describe('titledLayout', () => {
  it('puts the chart below a title, with padding all round', () => {
    const box = titledLayout(600, 240, 1);
    expect(box.pad).toBe(16);
    expect(box.chartTop).toBe(16 + 20 + 8);
    expect(box.width).toBe(632);
    expect(box.height).toBe(box.chartTop + 240 + 16);
  });

  it('scales with the canvas pixel ratio', () => {
    const box = titledLayout(1200, 480, 2);
    expect(box.pad).toBe(32);
    expect(box.fontPx).toBe(32);
    expect(box.width).toBe(1264);
  });

  it('treats a missing ratio as 1', () => {
    expect(titledLayout(100, 100, 0).pad).toBe(16);
  });
});

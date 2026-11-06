import { describe, expect, it } from 'vitest';
import { clampWidth, colsTemplate, isResized, MAX_COLUMN_PX, MIN_COLUMN_PX } from './columnWidths';

const tracks = ['minmax(0, 2fr)', 'minmax(0, 1fr)', '5.5rem'];

describe('column widths', () => {
  it('uses the default tracks until a column is resized', () => {
    expect(colsTemplate(tracks, [null, null, null])).toBe('minmax(0, 2fr) minmax(0, 1fr) 5.5rem');
    expect(isResized([null, null, null])).toBe(false);
  });

  it('gives a resized column its width, and the flexible ones a floor', () => {
    expect(colsTemplate(tracks, [300, null, null])).toBe(`minmax(${MIN_COLUMN_PX}px, 300px) minmax(${MIN_COLUMN_PX}px, 1fr) 5.5rem`);
    expect(colsTemplate(tracks, [null, null, 120])).toBe(`minmax(${MIN_COLUMN_PX}px, 2fr) minmax(${MIN_COLUMN_PX}px, 1fr) minmax(${MIN_COLUMN_PX}px, 120px)`);
  });

  it('keeps widths within bounds, in whole pixels', () => {
    expect(clampWidth(3)).toBe(MIN_COLUMN_PX);
    expect(clampWidth(5000)).toBe(MAX_COLUMN_PX);
    expect(clampWidth(150.6)).toBe(151);
  });
});

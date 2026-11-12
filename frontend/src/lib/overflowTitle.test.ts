import { describe, expect, it } from 'vitest';
import { clippedText, hideTitle, showTitle, type CellLike } from './overflowTitle';

function cell(text: string, scrollWidth: number, clientWidth = 100, attrs: Record<string, string> = {}): CellLike & { attrs: Record<string, string> } {
  const a = { ...attrs };
  return {
    attrs: a,
    scrollWidth,
    clientWidth,
    textContent: text,
    hasAttribute: (n) => n in a,
    getAttribute: (n) => a[n] ?? null,
    setAttribute: (n, v) => void (a[n] = v),
    removeAttribute: (n) => void delete a[n],
  };
}

describe('clippedText', () => {
  it('gives the full text only when clipped', () => {
    expect(clippedText(cell('  Ethiopia\n  Guji  ', 180))).toBe('Ethiopia Guji');
    expect(clippedText(cell('Guji', 100))).toBeNull();
    expect(clippedText(cell('   ', 180))).toBeNull();
  });
});

describe('showTitle / hideTitle', () => {
  it('titles a clipped cell and takes it off again', () => {
    const c = cell('A very long origin', 180);
    showTitle(c);
    expect(c.attrs.title).toBe('A very long origin');
    hideTitle(c);
    expect(c.attrs.title).toBeUndefined();
  });
  it('leaves a cell that fits alone', () => {
    const c = cell('Short', 50);
    showTitle(c);
    expect(c.attrs.title).toBeUndefined();
  });
  it("never replaces or removes a cell's own title", () => {
    const c = cell('☕', 180, 100, { title: 'Decaf' });
    showTitle(c);
    expect(c.attrs.title).toBe('Decaf');
    hideTitle(c);
    expect(c.attrs.title).toBe('Decaf');
  });
  it('drops its title once the cell fits (after a resize)', () => {
    const c = cell('A very long origin', 180);
    showTitle(c);
    c.clientWidth = 200;
    showTitle(c);
    expect(c.attrs.title).toBeUndefined();
  });
});

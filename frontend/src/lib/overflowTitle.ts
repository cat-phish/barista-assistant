// List table cells (.data-td) clip to one line with an ellipsis. On hover, a
// clipped one gets its full text as a tooltip (the browser's own, via title);
// one that fits gets none, and a cell's own title is left alone. On phones
// there's no hover: an open row wraps its cells instead (base.css).

export const CELL = '.data-td';
const MARK = 'data-overflow-title';

// What a cell needs; an HTMLElement has it all.
export interface CellLike {
  scrollWidth: number;
  clientWidth: number;
  textContent: string | null;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

// The full text when it's cut off, else null.
export function clippedText(el: Pick<CellLike, 'scrollWidth' | 'clientWidth' | 'textContent'>): string | null {
  if (el.scrollWidth <= el.clientWidth) return null;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

// Pointer entered a cell: title it if it's clipped and has no title of its own.
export function showTitle(el: CellLike): void {
  if (el.hasAttribute('title') && !el.hasAttribute(MARK)) return;
  const text = clippedText(el);
  if (text) {
    el.setAttribute('title', text);
    el.setAttribute(MARK, '');
  } else hideTitle(el);
}

// Pointer left: drop a title this added (a resize may have made it fit).
export function hideTitle(el: CellLike): void {
  if (!el.hasAttribute(MARK)) return;
  el.removeAttribute('title');
  el.removeAttribute(MARK);
}

function cellOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(CELL) : null;
}

// Once, for the whole app.
export function installOverflowTitles(doc: Document = document): void {
  doc.addEventListener('mouseover', (e) => {
    const cell = cellOf(e.target);
    if (cell) showTitle(cell);
  });
  doc.addEventListener('mouseout', (e) => {
    const cell = cellOf(e.target);
    // Moving between children of the same cell isn't leaving it.
    if (cell && !(e.relatedTarget instanceof Node && cell.contains(e.relatedTarget))) hideTitle(cell);
  });
}

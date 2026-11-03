import { describe, expect, it } from 'vitest';
import { droppedImages, pastedImages, type TransferItem } from './pastedImages';

const file = (name: string, type: string) => new File(['x'], name, { type });
const item = (kind: string, type: string, f: File | null): TransferItem => ({ kind, type, getAsFile: () => f });

describe('pastedImages', () => {
  it('takes the pasted images and leaves text alone', () => {
    const png = file('image.png', 'image/png');
    expect(pastedImages([item('string', 'text/plain', null), item('file', 'image/png', png)])).toEqual([png]);
  });

  it('skips files that are not images, and items with no file', () => {
    expect(pastedImages([item('file', 'application/pdf', file('a.pdf', 'application/pdf')), item('file', 'image/jpeg', null)])).toEqual([]);
  });

  it('is empty for a text-only paste', () => {
    expect(pastedImages([item('string', 'text/html', null)])).toEqual([]);
  });
});

describe('droppedImages', () => {
  it('keeps only the images', () => {
    const jpg = file('puck.jpg', 'image/jpeg');
    const webp = file('bag.webp', 'image/webp');
    expect(droppedImages([jpg, file('notes.txt', 'text/plain'), webp])).toEqual([jpg, webp]);
  });
});

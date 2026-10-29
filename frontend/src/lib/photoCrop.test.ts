import { describe, expect, it } from 'vitest';
import { croppedFile, replaceFile } from './photoCrop';

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('replaceFile', () => {
  it('swaps one file in place and hands back the old URL', () => {
    const list = [
      { key: 'a', file: file('a.jpg'), url: 'blob:a' },
      { key: 'b', file: file('b.jpg'), url: 'blob:b' },
    ];
    const next = file('b2.jpg');
    const { list: out, revoke } = replaceFile(list, 'b', next, () => 'blob:b2');
    expect(out.map((p) => [p.key, p.url])).toEqual([['a', 'blob:a'], ['b', 'blob:b2']]);
    expect(out[1]!.file).toBe(next);
    expect(revoke).toBe('blob:b');
    expect(list[1]!.url).toBe('blob:b'); // the original isn't changed
  });
  it('leaves the list alone for a key that has gone', () => {
    const list = [{ key: 1, file: file('a.jpg'), url: 'blob:a' }];
    let made = 0;
    expect(replaceFile(list, 2, file('x.jpg'), () => `blob:${++made}`)).toEqual({ list, revoke: null });
    expect(made).toBe(0);
  });
});

describe('croppedFile', () => {
  it('keeps the name with a .jpg ending', () => {
    expect(croppedFile(new Blob(['x'], { type: 'image/jpeg' }), 'IMG_2041.HEIC.png').name).toBe('IMG_2041.HEIC.jpg');
    expect(croppedFile(new Blob(['x'], { type: 'image/jpeg' }), 'bag').name).toBe('bag.jpg');
    expect(croppedFile(new Blob(['x']), '').name).toBe('photo.jpg');
    expect(croppedFile(new Blob(['x']), 'a.png').type).toBe('image/jpeg');
  });
});

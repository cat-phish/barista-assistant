import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelReadResult } from '../api/types';

// The API and the browser's image work stood in: what's tested is how the
// store keeps a read going and hands its answer to the right form, once.
const readLabel = vi.fn();
vi.mock('../api/beans', () => ({ beansApi: { readLabel: (...args: unknown[]) => readLabel(...args) } }));
vi.mock('../lib/photoResize', () => ({ photoBase64: async () => 'b64' }));
const { labelReadKey, useLabelReadStore } = await import('./labelRead');

const answer = (beanName: string): LabelReadResult => ({ fields: { beanName } as LabelReadResult['fields'], web: null, webError: null });
const photo = new Blob(['x']);

beforeEach(() => {
  setActivePinia(createPinia());
  readLabel.mockReset();
});

describe('label reads (stores/labelRead.ts)', () => {
  it('keeps the answer for its form, handed over once', async () => {
    readLabel.mockResolvedValue(answer('Elida Estate'));
    const reads = useLabelReadStore();
    const key = labelReadKey('b1');
    const going = reads.start(key, 'Proud Mary Elida Estate', 'ws', [photo, async () => photo], { web: true, website: null });
    expect(reads.current).toMatchObject({ key: 'bean:b1', status: 'reading', web: true });
    await going;
    expect(readLabel).toHaveBeenCalledWith('ws', ['b64', 'b64'], { web: true, website: null });
    expect(reads.take(labelReadKey(null))).toBeNull(); // another form's
    expect(reads.take(key)?.fields.beanName).toBe('Elida Estate');
    expect(reads.take(key)).toBeNull();
    expect(reads.current).toBeNull();
  });

  it('ignores a late answer from an older read', async () => {
    let finishFirst: (r: LabelReadResult) => void = () => undefined;
    readLabel.mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve))).mockResolvedValueOnce(answer('Second'));
    const reads = useLabelReadStore();
    const first = reads.start('new', 'a', 'ws', [photo]);
    await reads.start('new', 'a', 'ws', [photo]);
    finishFirst(answer('First'));
    await first;
    expect(reads.take('new')?.fields.beanName).toBe('Second');
  });

  it('says when it failed', async () => {
    readLabel.mockRejectedValue(new Error('offline'));
    const reads = useLabelReadStore();
    await reads.start('new', 'a', 'ws', [photo]);
    expect(reads.current).toMatchObject({ status: 'failed' });
    expect(reads.take('new')).toBeNull();
    reads.dismiss();
    expect(reads.current).toBeNull();
  });
});

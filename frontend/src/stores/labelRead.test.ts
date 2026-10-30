import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelReadResult } from '../api/types';

// The API and the browser's image work stood in: what's tested is how the
// store keeps a read going and hands its answer to the right form, once.
const readLabel = vi.fn();
const lookUpBean = vi.fn();
vi.mock('../api/beans', () => ({
  beansApi: { readLabel: (...args: unknown[]) => readLabel(...args), lookUpBean: (...args: unknown[]) => lookUpBean(...args) },
}));
vi.mock('../lib/photoResize', () => ({ photoBase64: async () => 'b64' }));
const { labelReadKey, useLabelReadStore } = await import('./labelRead');

const answer = (beanName: string): LabelReadResult => ({ fields: { beanName } as LabelReadResult['fields'], web: null, webSources: [], webError: null });
const photo = new Blob(['x']);

beforeEach(() => {
  setActivePinia(createPinia());
  readLabel.mockReset();
  lookUpBean.mockReset();
});

describe('label reads (stores/labelRead.ts)', () => {
  it('keeps the answer for its form, handed over once', async () => {
    readLabel.mockResolvedValue(answer('Elida Estate'));
    const reads = useLabelReadStore();
    const key = labelReadKey('b1');
    const going = reads.start(key, 'Proud Mary Elida Estate', 'ws', [photo, async () => photo]);
    expect(reads.current).toMatchObject({ key: 'bean:b1', status: 'reading', photos: true, web: false });
    await going;
    expect(readLabel).toHaveBeenCalledWith('ws', ['b64', 'b64']);
    expect(lookUpBean).not.toHaveBeenCalled();
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

  it('reads the photos, then looks it up on the web as its own request', async () => {
    readLabel.mockResolvedValue({ ...answer('Elida Estate'), fields: { ...answer('').fields, roasterName: 'Proud Mary', roastDate: '2026-10-01' } });
    let found: (r: unknown) => void = () => undefined;
    lookUpBean.mockReturnValue(new Promise((resolve) => (found = resolve)));
    const reads = useLabelReadStore();
    const going = reads.start('new', 'a', 'ws', [photo], { web: true, website: 'proudmarycoffee.com' });
    await vi.waitFor(() => expect(reads.current?.step).toBe('web'));
    // The label's names and the form's website; never the roast date.
    expect(lookUpBean).toHaveBeenCalledWith('ws', { roasterName: 'Proud Mary', website: 'proudmarycoffee.com' });
    found({ web: { region: { value: 'Boquete', url: 'https://p.com/e' } }, webSources: ['https://p.com/e'], webError: null });
    await going;
    expect(reads.take('new')).toMatchObject({ fromPhotos: true, fields: { roasterName: 'Proud Mary' }, webSources: ['https://p.com/e'] });
  });

  it('keeps the label when the lookup fails', async () => {
    readLabel.mockResolvedValue(answer('Elida Estate'));
    lookUpBean.mockRejectedValue(new Error('offline'));
    const reads = useLabelReadStore();
    await reads.start('new', 'a', 'ws', [photo], { web: true });
    expect(reads.take('new')).toMatchObject({ fields: { beanName: 'Elida Estate' }, web: null, webError: expect.stringMatching(/didn’t work/) });
  });

  it('looks it up on the web alone, without photos', async () => {
    lookUpBean.mockResolvedValue({ web: null, webSources: ['https://p.com'], webError: null });
    const reads = useLabelReadStore();
    const going = reads.lookUp('new', 'a', 'ws', { beanName: 'Elida' });
    expect(reads.current).toMatchObject({ photos: false, web: true, step: 'web' });
    await going;
    expect(readLabel).not.toHaveBeenCalled();
    const result = reads.take('new');
    expect(result).toMatchObject({ fromPhotos: false, webSources: ['https://p.com'] });
    expect(Object.values(result!.fields).every((v) => v === null)).toBe(true);
  });
});

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { beansApi } from '../api/beans';
import { ApiError, errorMessage } from '../api/client';
import type { LabelReadResult } from '../api/types';
import { photoBase64 } from '../lib/photoResize';

// A bean label read (docs/api/bean-label.md §4d), kept here rather than in the
// bean form so it carries on while you're elsewhere in the app (a web lookup
// can take minutes). The form it was started from takes the answer when it's
// open (now, or when you come back); AppHeader shows how it's going meanwhile.
// One at a time: a new read replaces the last, and a late answer from an
// older read is ignored.
export type LabelReadKey = string; // `bean:<id>`, or 'new' for Add bean
export const labelReadKey = (beanId: string | null | undefined): LabelReadKey => (beanId ? `bean:${beanId}` : 'new');

export interface LabelRead {
  key: LabelReadKey;
  name: string; // what it's for, e.g. "Proud Mary Elida Estate"
  web: boolean;
  status: 'reading' | 'done' | 'failed';
  result: LabelReadResult | null;
  error: string;
}

export const useLabelReadStore = defineStore('labelRead', () => {
  const current = ref<LabelRead | null>(null);
  let seq = 0;

  async function start(
    key: LabelReadKey,
    name: string,
    workspaceId: string,
    photos: Array<Blob | (() => Promise<Blob>)>,
    options: { web?: boolean; website?: string | null } = {},
  ): Promise<void> {
    const mine = ++seq;
    current.value = { key, name, web: !!options.web, status: 'reading', result: null, error: '' };
    let next: Pick<LabelRead, 'status' | 'result' | 'error'>;
    try {
      const blobs = await Promise.all(photos.map((p) => (typeof p === 'function' ? p() : p)));
      const images = await Promise.all(blobs.map(photoBase64));
      next = { status: 'done', result: await beansApi.readLabel(workspaceId, images, options), error: '' };
    } catch (err) {
      // Not the API's: a photo the browser couldn't load or decode.
      const error = err instanceof ApiError ? errorMessage(err) : 'A photo couldn’t be prepared. Try again, or with other photos.';
      next = { status: 'failed', result: null, error };
    }
    if (mine === seq && current.value) current.value = { ...current.value, ...next };
  }

  // The finished answer for this form, once: it's then cleared.
  function take(key: LabelReadKey): LabelReadResult | null {
    const read = current.value;
    if (!read || read.key !== key || read.status !== 'done') return null;
    current.value = null;
    return read.result;
  }
  function dismiss(): void {
    seq++; // an answer still on its way is dropped
    current.value = null;
  }
  return { current, start, take, dismiss };
});

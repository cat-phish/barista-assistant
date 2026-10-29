import { defineStore } from 'pinia';
import { ref } from 'vue';
import { beansApi } from '../api/beans';
import { ApiError, errorMessage } from '../api/client';
import type { LabelFields, LabelLookUp, LabelReadResult } from '../api/types';
import { canLookUp, lookUpFields } from '../lib/labelFill';
import { photoBase64 } from '../lib/photoResize';

// A bean label read (docs/api/bean-label.md §4d), kept here rather than in the
// bean form so it carries on while you're elsewhere in the app (a web lookup
// can take minutes). The form it was started from takes the answer when it's
// open (now, or when you come back); AppHeader shows how it's going meanwhile.
// One at a time: a new read replaces the last, and a late answer from an
// older read is ignored.
//
// The photos and the web lookup are separate requests, one after the other:
// a slow or failed lookup keeps the label, and the lookup can also run on
// its own (again, or from what was typed in).
export type LabelReadKey = string; // `bean:<id>`, or 'new' for Add bean
export const labelReadKey = (beanId: string | null | undefined): LabelReadKey => (beanId ? `bean:${beanId}` : 'new');

// The answer as the form takes it; fromPhotos: false for a web lookup alone
// (fields all null).
export type LabelAnswer = LabelReadResult & { fromPhotos: boolean };

export interface LabelRead {
  key: LabelReadKey;
  name: string; // what it's for, e.g. "Proud Mary Elida Estate"
  photos: boolean; // reads the label's photos
  web: boolean; // looks it up on the web (after the photos, if any)
  step: 'label' | 'web'; // what it's doing now
  status: 'reading' | 'done' | 'failed';
  result: LabelAnswer | null;
  error: string;
}

const NO_FIELDS: LabelFields = {
  roasterName: null, beanName: null, processName: null, processText: null, country: null, region: null, producer: null,
  altitudeMasl: null, flavorProfile: null, roastDate: null, detailedRoastLevel: null, roastLevel: null, roastType: null,
  blendType: null, decaf: null, bagWeightGrams: null, batchNumber: null, website: null,
};

export const useLabelReadStore = defineStore('labelRead', () => {
  const current = ref<LabelRead | null>(null);
  let seq = 0;

  // Changes the read, unless a newer one has replaced it.
  function update(mine: number, next: Partial<LabelRead>): void {
    if (mine === seq && current.value) current.value = { ...current.value, ...next };
  }

  // The web lookup; its failure is the answer's webError, not the read's.
  async function search(workspaceId: string, fields: LabelLookUp): Promise<Pick<LabelReadResult, 'web' | 'webSources' | 'webError'>> {
    try {
      return await beansApi.lookUpBean(workspaceId, fields);
    } catch (err) {
      return { web: null, webSources: [], webError: err instanceof ApiError ? errorMessage(err) : 'The web lookup didn’t work. Try again.' };
    }
  }

  async function start(
    key: LabelReadKey,
    name: string,
    workspaceId: string,
    photos: Array<Blob | (() => Promise<Blob>)>,
    options: { web?: boolean; website?: string | null } = {},
  ): Promise<void> {
    const mine = ++seq;
    const web = !!options.web;
    current.value = { key, name, photos: true, web, step: 'label', status: 'reading', result: null, error: '' };
    let label: LabelReadResult;
    try {
      const blobs = await Promise.all(photos.map((p) => (typeof p === 'function' ? p() : p)));
      const images = await Promise.all(blobs.map(photoBase64));
      label = await beansApi.readLabel(workspaceId, images);
    } catch (err) {
      // Not the API's: a photo the browser couldn't load or decode.
      const error = err instanceof ApiError ? errorMessage(err) : 'A photo couldn’t be prepared. Try again, or with other photos.';
      update(mine, { status: 'failed', error });
      return;
    }
    const fields = lookUpFields(label.fields, options.website ?? '');
    if (web && canLookUp(fields)) {
      update(mine, { step: 'web' });
      label = { ...label, ...(await search(workspaceId, fields)) };
    } else if (web) {
      label = { ...label, webError: 'The label gave no roaster or coffee name to look up on the web.' };
    }
    update(mine, { status: 'done', result: { ...label, fromPhotos: true } });
  }

  // The web lookup on its own, from what the form says.
  async function lookUp(key: LabelReadKey, name: string, workspaceId: string, fields: LabelLookUp): Promise<void> {
    const mine = ++seq;
    current.value = { key, name, photos: false, web: true, step: 'web', status: 'reading', result: null, error: '' };
    const found = await search(workspaceId, fields);
    update(mine, { status: 'done', result: { fields: NO_FIELDS, ...found, fromPhotos: false } });
  }

  // The finished answer for this form, once: it's then cleared.
  function take(key: LabelReadKey): LabelAnswer | null {
    const read = current.value;
    if (!read || read.key !== key || read.status !== 'done') return null;
    current.value = null;
    return read.result;
  }
  function dismiss(): void {
    seq++; // an answer still on its way is dropped
    current.value = null;
  }
  return { current, start, lookUp, take, dismiss };
});

// Reading a bean label (docs/api/bean-label.md §4d): shrinks each photo in
// the browser and sends them in one request (with a web lookup when asked);
// the answer goes to onRead.
import { ref } from 'vue';
import { beansApi } from '../api/beans';
import { ApiError, errorMessage } from '../api/client';
import type { LabelReadResult } from '../api/types';
import { photoBase64 } from '../lib/photoResize';

export function useLabelRead(workspaceId: () => string, onRead: (result: LabelReadResult) => void) {
  const reading = ref(false);
  const error = ref('');
  async function read(photos: Array<Blob | (() => Promise<Blob>)>, options: { web?: boolean; website?: string | null } = {}): Promise<void> {
    reading.value = true;
    error.value = '';
    try {
      const blobs = await Promise.all(photos.map((p) => (typeof p === 'function' ? p() : p)));
      const images = await Promise.all(blobs.map(photoBase64));
      onRead(await beansApi.readLabel(workspaceId(), images, options));
    } catch (err) {
      // Not the API's: a photo the browser couldn't load or decode.
      error.value = err instanceof ApiError ? errorMessage(err) : 'A photo couldn’t be prepared. Try again, or with other photos.';
    } finally {
      reading.value = false;
    }
  }
  return { reading, error, read };
}
